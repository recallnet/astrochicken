import {
	createAgentSession,
	createReadOnlyTools,
	type DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import {
	usageFromAssistantMessage,
} from "@recallnet/factory-telemetry";

import { assertModelSelectionAllowed, type EffectiveModelPolicy } from "../../factory/model-policy.js";
import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodeLLMModel, nodeLLMProvider, nodePrompt, nodeReasoningEffort, nodeTimeout } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";
import { buildModelAttemptChain, isRetryableModelFailureMessage } from "./model-routing.js";
import { buildOpenRouterTraceOptions, mergeOpenRouterTraceOptions } from "./openrouter-trace.js";
import { promptAndExtractText } from "./session-completion.js";
import { resolveSessionKey } from "./session-persistence.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";
import type { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import type { EventBus } from "@recallnet/factory-telemetry";

export interface CodergenConfig {
	modelRegistry: ModelRegistry;
	authStorage: AuthStorage;
	resourceLoader: DefaultResourceLoader;
	defaultModel: string;
	defaultProvider: string;
	modelPolicy?: EffectiveModelPolicy;
	eventBus?: EventBus;
	pipelineFile?: string;
}

const CODERGEN_PROGRESS_HEARTBEAT_MS = 15_000;

function nextAttemptIndex(cache: Map<string, number>, chainKey: string): number {
	const current = cache.get(chainKey) ?? 0;
	const next = current + 1;
	cache.set(chainKey, next);
	return next;
}

export class CodergenHandler implements Handler {
	private sessions = new Map<string, any>();
	private sessionSubscriptions = new Map<string, () => void>();
	private generationAttempts = new Map<string, number>();

	constructor(private config: CodergenConfig) {}

	async execute(
		signal: AbortSignal,
		node: Node,
		ctx: Context,
		input: string,
		controls?: { reportProgress?: () => void },
	): Promise<Outcome> {
		const reportProgress = controls?.reportProgress ?? (() => {});
		let prompt = nodePrompt(node);
		if (!prompt) prompt = input;
		else if (input) prompt = prompt + "\n\n" + input;
		prompt = expandVariables(prompt, ctx);

		if (!prompt.trim()) {
			return {
				status: StageStatus.Completed,
				output: "",
				contextUpdates: { __codergen_skip_reason: "empty_prompt_after_expansion" },
			};
		}

		const effort = nodeReasoningEffort(node);
		const timeoutMs = nodeTimeout(node, ctx.lookup());
		const explicitSessionId = expandVariables(node.attrs["session_id"] ?? "", ctx);
		const sessionKey = resolveSessionKey(explicitSessionId, node.id);
		// Session ids remain important for telemetry correlation, but Codergen
		// steps already receive explicit structured inputs. Reusing live session
		// state across completed nodes can carry stale reasoning into the next
		// step and stall long-running goal decomposition chains.
		const shouldCacheSession = false;
		const chainKey = `codergen:${sessionKey}`;
		const attemptIndex = nextAttemptIndex(this.generationAttempts, chainKey);
		const llmPathId = String(node.attrs["llm_path_id"] || "");
		const attempts = buildModelAttemptChain({
			defaultProvider: this.config.defaultProvider,
			defaultModel: this.config.defaultModel,
			policy: this.config.modelPolicy,
			nodeModelOverride: nodeLLMModel(node),
			nodeProviderOverride: nodeLLMProvider(node),
		});

		for (const attempt of attempts) {
			const provider = attempt.provider;
			const modelId = attempt.modelId;
			const selectedVia = attempt.selectedVia;
			assertModelSelectionAllowed({
				policy: this.config.modelPolicy,
				provider,
				model: modelId,
				nodeId: node.id,
				handlerType: "codergen",
				selectedVia,
			});

			const intent = resolveIntentMetadata(node.id, {
				handlerType: "codergen",
				kind: "prompt",
				data: {
					prompt,
					model: modelId,
					provider,
					reasoningEffort: effort,
					sessionId: sessionKey,
				},
			});

			const model = this.config.modelRegistry.find(provider, modelId);
			if (!model) {
				const errorMessage = `Could not resolve model ${provider}/${modelId}`;
				if (attempt !== attempts[attempts.length - 1]) continue;
				return {
					status: StageStatus.Failed,
					output: "",
					error: errorMessage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			}

			const thinkingLevel = effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
			let session: any;
			let createdSession = false;
			let unsubscribe = () => {};
			let progressUnsubscribe = () => {};

			try {
				session = shouldCacheSession ? this.sessions.get(sessionKey) : undefined;

				if (!session) {
					const traceOptions = buildOpenRouterTraceOptions(
						ctx,
						{ pipelineFile: this.config.pipelineFile },
						"codergen",
						`${sessionKey}:attempt:${attemptIndex}`,
						llmPathId,
					);
					const sessionOptions = mergeOpenRouterTraceOptions({
						model,
						thinkingLevel: thinkingLevel as any,
						tools: createReadOnlyTools(process.cwd()),
						sessionManager: SessionManager.inMemory(),
						settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 98304, keepRecentTokens: 32768 } }),
						resourceLoader: this.config.resourceLoader,
						authStorage: this.config.authStorage,
						modelRegistry: this.config.modelRegistry,
					}, traceOptions);
					const created = await createAgentSession(sessionOptions as any);
					session = created.session;
					createdSession = true;
					if (shouldCacheSession) {
						this.sessions.set(sessionKey, session);
						process.stderr.write(`    [codergen:${sessionKey}] session cached for reuse\n`);
					}
				} else {
					process.stderr.write(`    [codergen:${sessionKey}] reusing cached session\n`);
				}

				this.sessionSubscriptions.get(sessionKey)?.();
				unsubscribe = () => {};
				progressUnsubscribe = session.subscribe(() => reportProgress());
				if (shouldCacheSession) {
					this.sessionSubscriptions.set(sessionKey, () => {
						progressUnsubscribe();
						unsubscribe();
					});
				}

				const label = `codergen${sessionKey ? `:${sessionKey}` : ""}`;
				let abortCleanup: (() => void) | undefined;
				if (signal && !signal.aborted) {
					const abortHandler = () => { void session.abort(); };
					signal.addEventListener("abort", abortHandler, { once: true });
					abortCleanup = () => signal.removeEventListener("abort", abortHandler);
				} else if (signal?.aborted) {
					void session.abort();
				}

				let output: string;
				const abortRace = createAbortRace(signal, label);
				const timeoutRace = createTimeoutRace(timeoutMs, label, session);
				const progressHeartbeat = startProgressHeartbeat(reportProgress);
				try {
					output = await Promise.race([
						promptAndExtractText(session, prompt, label),
						abortRace.promise,
						timeoutRace.promise,
					]);
					reportProgress();
				} finally {
					progressHeartbeat.stop();
					abortRace.cleanup();
					timeoutRace.cleanup();
					abortCleanup?.();
				}

				const assistant = extractLastAssistantMessage(session.messages);
				const apiError = isAssistantError(assistant);
				if (apiError.isError) {
					const errorMessage = `codergen: LLM API error: ${apiError.errorMessage}`;
					if (!shouldCacheSession && session?.dispose) {
						progressUnsubscribe();
						unsubscribe();
						session.dispose();
					}
					if (attempt !== attempts[attempts.length - 1] && isRetryableModelFailureMessage(errorMessage)) {
						continue;
					}
					return {
						status: StageStatus.Failed,
						output: "",
						error: errorMessage,
						contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
						intent,
					};
				}

				const usage = usageFromAssistantMessage(assistant);

				if (!shouldCacheSession) {
					progressUnsubscribe();
					unsubscribe();
					session.dispose();
				}

				return {
					status: StageStatus.Completed,
					output,
					usage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				const aborted = isSessionAbortError(err);
				const timedOut = isSessionTimeoutError(err);
				if ((aborted || timedOut) && shouldCacheSession) {
					this.sessionSubscriptions.get(sessionKey)?.();
					this.sessionSubscriptions.delete(sessionKey);
					this.sessions.delete(sessionKey);
					if (session?.dispose) session.dispose();
					if (aborted) throw err;
					return {
						status: StageStatus.Failed,
						output: "",
						error: errorMessage,
						contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
						intent,
					};
				}
				if (!shouldCacheSession && createdSession && session?.dispose) {
					progressUnsubscribe();
					unsubscribe();
					session.dispose();
				} else if (aborted || timedOut) {
					progressUnsubscribe();
					unsubscribe();
					if (session?.dispose) session.dispose();
					if (aborted) throw err;
					return {
						status: StageStatus.Failed,
						output: "",
						error: errorMessage,
						contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
						intent,
					};
				}
				if (attempt !== attempts[attempts.length - 1] && isRetryableModelFailureMessage(errorMessage)) {
					continue;
				}
				return {
					status: StageStatus.Failed,
					output: "",
					error: errorMessage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			}
		}

		return {
			status: StageStatus.Failed,
			output: "",
			error: "Could not resolve any allowed provider/model attempt",
		};
	}
}

class SessionAbortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionAbortError";
	}
}

class SessionTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionTimeoutError";
	}
}

function createAbortRace(signal: AbortSignal | undefined, label: string): {
	promise: Promise<never>;
	cleanup: () => void;
} {
	if (!signal) {
		return {
			promise: new Promise<never>(() => {}),
			cleanup: () => {},
		};
	}

	let abortHandler: (() => void) | undefined;
	const promise = new Promise<never>((_, reject) => {
		if (signal.aborted) {
			reject(new SessionAbortError(`${label}: LLM session was aborted`));
			return;
		}
		abortHandler = () => reject(new SessionAbortError(`${label}: LLM session was aborted`));
		signal.addEventListener("abort", abortHandler, { once: true });
	});

	return {
		promise,
		cleanup: () => {
			if (abortHandler) signal.removeEventListener("abort", abortHandler);
		},
	};
}

function createTimeoutRace(timeoutMs: number, label: string, session: { abort?: () => Promise<unknown> | unknown } | undefined): {
	promise: Promise<never>;
	cleanup: () => void;
} {
	if (!(timeoutMs > 0)) {
		return {
			promise: new Promise<never>(() => {}),
			cleanup: () => {},
		};
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			void session?.abort?.();
			reject(new SessionTimeoutError(`${label}: LLM session timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	return {
		promise,
		cleanup: () => {
			if (timeoutId) clearTimeout(timeoutId);
		},
	};
}

function isSessionAbortError(err: unknown): err is SessionAbortError {
	return err instanceof SessionAbortError;
}

function isSessionTimeoutError(err: unknown): err is SessionTimeoutError {
	return err instanceof SessionTimeoutError;
}

function startProgressHeartbeat(reportProgress: () => void): { stop: () => void } {
	const intervalId = setInterval(() => reportProgress(), CODERGEN_PROGRESS_HEARTBEAT_MS);
	return {
		stop: () => clearInterval(intervalId),
	};
}

function modelPolicyContextUpdates(
	policy: EffectiveModelPolicy | undefined,
	provider: string,
	model: string,
	selectedVia: string,
): Record<string, string> {
	if (!policy) return {};
	return {
		model_policy_selected_via: selectedVia,
		model_policy_selected_provider: provider,
		model_policy_selected_model: model,
	};
}

function extractLastAssistantMessage(messages: any[]): any {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg?.role === "assistant") return msg;
	}
	return undefined;
}

function isAssistantError(message: any): { isError: boolean; errorMessage?: string } {
	if (!message) return { isError: false };
	if (message.stopReason === "error" || message.errorMessage) {
		return {
			isError: true,
			errorMessage: message.errorMessage || `LLM returned stopReason="${message.stopReason}" with empty content`,
		};
	}
	return { isError: false };
}
