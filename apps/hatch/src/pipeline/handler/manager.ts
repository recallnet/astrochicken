import {
	createAgentSession,
	createCodingTools,
	type DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import {
	usageFromAssistantMessage,
} from "@recallnet/factory-telemetry";

import { assertModelSelectionAllowed, type EffectiveModelPolicy } from "../../factory/model-policy.js";
import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodePrompt, nodeLLMModel, nodeLLMProvider, nodeWorkDir, graphWorkDir } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";
import { buildModelAttemptChain, isRetryableModelFailureMessage } from "./model-routing.js";
import { buildOpenRouterTraceOptions, mergeOpenRouterTraceOptions } from "./openrouter-trace.js";
import { promptAndExtractText } from "./session-completion.js";
import { resolvePersistentSessionDir, resolveSessionKey } from "./session-persistence.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node, Graph } from "../graph.js";
import type { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import type { EventBus } from "@recallnet/factory-telemetry";

export interface ManagerConfig {
	modelRegistry: ModelRegistry;
	authStorage: AuthStorage;
	resourceLoader: DefaultResourceLoader;
	defaultModel: string;
	defaultProvider: string;
	modelPolicy?: EffectiveModelPolicy;
	workDir: string;
	graph?: Graph;
	eventBus?: EventBus;
	pipelineFile?: string;
}

function nextAttemptIndex(cache: Map<string, number>, chainKey: string): number {
	const current = cache.get(chainKey) ?? 0;
	const next = current + 1;
	cache.set(chainKey, next);
	return next;
}

// @context:regression !critical LLM agent nodes must enforce the timeout attribute.
// Without this, merge conflict resolver agents run indefinitely (hours) burning
// execution slots. refs: example-trading #1936, #1798 push recovery loops.
function parseTimeoutMs(raw: string | undefined): number {
	if (!raw) return 0;
	const match = String(raw).trim().match(/^(\d+)\s*(ms|s|m|h)$/i);
	if (!match) return 0;
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === "ms") return value;
	if (unit === "s") return value * 1000;
	if (unit === "m") return value * 60 * 1000;
	if (unit === "h") return value * 60 * 60 * 1000;
	return 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	if (ms <= 0) return promise;
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); },
		);
	});
}

export class ManagerLoopHandler implements Handler {
	private sessions = new Map<string, any>();
	private sessionSubscriptions = new Map<string, () => void>();
	private generationAttempts = new Map<string, number>();

	constructor(private config: ManagerConfig) {}

	async execute(_signal: AbortSignal, node: Node, ctx: Context, input: string): Promise<Outcome> {
		const explicitSessionId = expandVariables(node.attrs["session_id"] ?? "", ctx);
		const sessionKey = resolveSessionKey(explicitSessionId, node.id);
		const chainKey = `stack.manager_loop:${sessionKey}`;
		const attemptIndex = nextAttemptIndex(this.generationAttempts, chainKey);
		const llmPathId = String(node.attrs["llm_path_id"] || "");

		let workDir = nodeWorkDir(node);
		if (!workDir && this.config.graph) workDir = graphWorkDir(this.config.graph);
		if (!workDir) workDir = this.config.workDir;
		if (!workDir) workDir = ".";
		workDir = expandVariables(workDir, ctx);

		let prompt = nodePrompt(node);
		if (!prompt) prompt = "Review the current state and decide what to do next.";
		if (input) prompt = prompt + "\n\nContext from previous step:\n" + input;
		prompt = expandVariables(prompt, ctx);

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
				handlerType: "stack.manager_loop",
				selectedVia,
			});

			const intent = resolveIntentMetadata(node.id, {
				handlerType: "stack.manager_loop",
				kind: "prompt",
				data: {
					prompt,
					model: modelId,
					provider,
					workDir,
					thinkingLevel: "high",
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

			let session: any;
			let unsubscribe = () => {};
			try {
				session = this.sessions.get(sessionKey);
				if (!session) {
					const persistentSessionDir = resolvePersistentSessionDir(ctx, sessionKey);
					const sessionManager = persistentSessionDir
						? SessionManager.create(workDir, persistentSessionDir)
						: SessionManager.inMemory();
					process.stderr.write(
						persistentSessionDir
							? `    [manager:${sessionKey}] session persistence enabled: ${persistentSessionDir}\n`
							: `    [manager:${sessionKey}] session persistence disabled (__run_sessions_dir missing)\n`,
					);

					const traceOptions = buildOpenRouterTraceOptions(
						ctx,
						{ pipelineFile: this.config.pipelineFile, graph: this.config.graph },
						"stack.manager_loop",
						`${sessionKey}:attempt:${attemptIndex}`,
						llmPathId,
					);
					const sessionOptions = mergeOpenRouterTraceOptions({
						cwd: workDir,
						model,
						thinkingLevel: "high" as any,
						tools: createCodingTools(workDir),
						sessionManager,
						settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 98304, keepRecentTokens: 32768 } }),
						resourceLoader: this.config.resourceLoader,
						authStorage: this.config.authStorage,
						modelRegistry: this.config.modelRegistry,
					}, traceOptions);
					const created = await createAgentSession(sessionOptions as any);
					session = created.session;
					this.sessions.set(sessionKey, session);
				} else {
					process.stderr.write(`    [manager:${sessionKey}] reusing cached session\n`);
				}

				this.sessionSubscriptions.get(sessionKey)?.();
				unsubscribe = () => {};
				this.sessionSubscriptions.set(sessionKey, unsubscribe);

				const timeoutMs = parseTimeoutMs(node.attrs["timeout"]);
				const llmPromise = promptAndExtractText(session, prompt, `manager:${node.id}`);
				const output = await withTimeout(llmPromise, timeoutMs, `manager:${node.id}`);
				const assistant = extractLastAssistantMessage(session.messages);
				const apiError = isAssistantError(assistant);
				if (apiError.isError) {
					unsubscribe();
					const errorMessage = `manager: LLM API error: ${apiError.errorMessage}`;
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
				unsubscribe();

				return {
					status: StageStatus.Completed,
					output,
					usage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				unsubscribe();
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
