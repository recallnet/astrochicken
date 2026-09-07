import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import {
	createAgentSession,
	createCodingTools,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import {
	bindLangfuseSessionTelemetry,
	computeLangfusePromptHash,
	emitLangfuseGenerationEvent,
	nextLangfuseAttemptIndex,
	recordLangfuseSessionContext,
	usageFromAssistantMessage,
} from "@recallnet/factory-telemetry";

import { assertModelSelectionAllowed, type EffectiveModelPolicy } from "../../factory/model-policy.js";
import { classifyWorktreePath } from "../../factory/worktree-path-policy.js";
import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodePrompt, nodeLLMModel, nodeLLMProvider, parseDuration } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";
import { buildOpenRouterTraceOptions, mergeOpenRouterTraceOptions } from "./openrouter-trace.js";
import { buildModelAttemptChain, isRetryableModelFailureMessage } from "./model-routing.js";
import { promptAndExtractText } from "./session-completion.js";
import { resolvePersistentSessionDir, resolveSessionKey } from "./session-persistence.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";
import type { HandlerConfig } from "./register.js";


/**
 * WorktreeAgentHandler spawns a coding agent in an isolated git worktree.
 *
 * Lifecycle:
 *   1. Create worktree + branch (or reuse existing for follow-up/recovery)
 *   2. Spawn pi agent session with coding tools in the worktree directory
 *   3. Send prompt and wait for completion
 *   4. Collect output + git state as context updates
 *   5. Optionally clean up worktree
 *
 * Attributes:
 *   repo                — absolute path to git repository (required)
 *   branch              — branch name for worktree (required, supports ${var})
 *   base                — base branch to create from (default: "main")
 *   prompt              — instruction for the agent (required)
 *   await               — block until agent completes (default: "true")
 *   timeout             — max wall-clock time (default: "4h")
 *   poll_interval       — how often to check agent status (default: "5s")
 *   cleanup_on_success  — remove worktree after completion (default: "false")
 *   agent_model         — override model for the spawned agent
 *   agent_provider      — override provider
 */
export class WorktreeAgentHandler implements Handler {
	private sessions = new Map<string, any>();
	private sessionCwds = new Map<string, string>();
	private sessionSubscriptions = new Map<string, () => void>();
	private generationAttempts = new Map<string, number>();

	constructor(private config: HandlerConfig) {}

	async execute(
		signal: AbortSignal,
		node: Node,
		ctx: Context,
		input: string,
		controls?: { reportProgress?: () => void },
	): Promise<Outcome> {
		const reportProgress = controls?.reportProgress ?? (() => {});
		// --- Resolve attributes ---
		const repo = expandVariables(node.attrs["repo"] ?? "", ctx);
		if (!repo) throw new Error(`agent.worktree: node "${node.id}" missing required "repo" attribute`);

		let branch = expandVariables(node.attrs["branch"] ?? "", ctx);
		if (!branch) throw new Error(`agent.worktree: node "${node.id}" missing required "branch" attribute`);

		const base = expandVariables(node.attrs["base"] ?? "main", ctx);
		const shouldCleanup = node.attrs["cleanup_on_success"] === "true";

		const timeoutStr = node.attrs["timeout"] ?? "4h";
		const timeoutMs = parseDuration(timeoutStr);
		const skipPromptIfCommitsExist = (node.attrs["skip_prompt_if_commits_exist"] ?? "true") === "true";
		const explicitSessionId = expandVariables(node.attrs["session_id"] ?? "", ctx);
		const sessionKey = resolveSessionKey(explicitSessionId, `worktree:${branch}`);
		const chainKey = `agent.worktree:${sessionKey}`;
		const pendingAttemptIndex = (this.generationAttempts.get(chainKey) ?? 0) + 1;
		const skillId = node.attrs["skill_id"] || node.attrs["skill"] || node.attrs["skill_name"] || "agent.worktree";
		const llmPathId = String(node.attrs["llm_path_id"] || "");
		const preflightPrompt = expandVariables(nodePrompt(node) || input || "", ctx);
		// Record node-scoped session metadata immediately after session resolution.
		// This guarantees recovery/no-op short-circuits still emit deterministic
		// stage telemetry with the resolved session envelope.
		recordLangfuseSessionContext(
			ctx,
			node.id,
			sessionKey,
			pendingAttemptIndex,
			preflightPrompt ? computeLangfusePromptHash(preflightPrompt) : "",
			skillId,
		);

		// --- Resolve worktree directory ---
		const repoDir = resolve(repo);
		const repoParent = dirname(repoDir);
		const explicitWorktreeDir = expandVariables(node.attrs["worktree_dir"] ?? "", ctx) || ctx.get("worktree_dir");
		const worktreeDir = explicitWorktreeDir
			? resolve(explicitWorktreeDir)
			: resolve(repoParent, ".hatch-worktrees", branch);
		const worktreeValidationError = validateWorktreeDirectory({ repoDir, worktreeDir });
		if (worktreeValidationError) {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `agent.worktree: ${worktreeValidationError}`,
				intent: resolveIntentMetadata(node.id, {
					handlerType: "agent.worktree",
					kind: "noop",
					data: {
						repo,
						branch,
						base,
						stage: "worktree.validate",
					},
				}),
			};
		}

		// --- Detect recovery/follow-up vs fresh creation ---
		const worktreeExists = existsSync(worktreeDir);
		let isRecovery = false;
		let commitsAhead = 0;

		if (worktreeExists) {
			const existingWorktreeError = validateExistingGitWorktree(worktreeDir, branch);
			if (existingWorktreeError) {
				return {
					status: StageStatus.Failed,
					output: "",
					error: `agent.worktree: ${existingWorktreeError}`,
					intent: resolveIntentMetadata(node.id, {
						handlerType: "agent.worktree",
						kind: "noop",
						data: {
							repo,
							branch,
							base,
							stage: "worktree.validate_existing",
						},
					}),
				};
			}
			const gitState = getWorktreeGitState(worktreeDir, base);
			commitsAhead = gitState.commitsAhead;
			const isDirty = gitState.isDirty;

			if (commitsAhead > 0 && !isDirty && skipPromptIfCommitsExist) {
				const log = gitLog(worktreeDir, commitsAhead);
				const output = `[recovery] Worktree "${branch}" has ${commitsAhead} commits ahead of ${base}. Agent work preserved.\n\n${log}`;
				const intent = resolveIntentMetadata(node.id, {
					handlerType: "agent.worktree",
					kind: "noop",
					data: {
						repo,
						branch,
						base,
						recovery: true,
						commitsAhead,
						sessionId: sessionKey,
					},
				});

				return {
					status: StageStatus.Completed,
					output,
					contextUpdates: buildContextUpdates(branch, worktreeDir, base),
					intent,
				};
			}

			if (isDirty) {
				try {
					execFileSync("git", ["checkout", "--", "."], { cwd: worktreeDir, stdio: "pipe" });
				} catch {
					// Best-effort
				}
			}

			if (commitsAhead > 0) isRecovery = true;
		} else {
			try {
				const worktreeParent = dirname(worktreeDir);
				if (!existsSync(worktreeParent)) mkdirSync(worktreeParent, { recursive: true });

				withRepoGitMutationLock(repoDir, () => {
					execFileSync("git", ["-C", repoDir, "worktree", "add", "-b", branch, worktreeDir, base], {
						stdio: "pipe",
					});
				});
			} catch {
				try {
					withRepoGitMutationLock(repoDir, () => {
						execFileSync("git", ["-C", repoDir, "worktree", "add", worktreeDir, branch], {
							stdio: "pipe",
						});
					});
				} catch (err2) {
					const intent = resolveIntentMetadata(node.id, {
						handlerType: "agent.worktree",
						kind: "noop",
						data: {
							repo,
							branch,
							base,
							stage: "worktree.create",
						},
					});
					return {
						status: StageStatus.Failed,
						output: "",
						error: `agent.worktree: failed to create worktree: ${err2 instanceof Error ? err2.message : err2}`,
						intent,
					};
				}
			}
			const createdWorktreeError = validateExistingGitWorktree(worktreeDir);
			if (createdWorktreeError) {
				return {
					status: StageStatus.Failed,
					output: "",
					error: `agent.worktree: ${createdWorktreeError}`,
					intent: resolveIntentMetadata(node.id, {
						handlerType: "agent.worktree",
						kind: "noop",
						data: {
							repo,
							branch,
							base,
							stage: "worktree.validate_created",
						},
					}),
				};
			}
		}

		// --- Build prompt ---
		let prompt = nodePrompt(node);
		if (!prompt) prompt = input;
		else if (input) prompt = prompt + "\n\n" + input;
		prompt = expandVariables(prompt, ctx);

		if (isRecovery && commitsAhead > 0) {
			const log = gitLog(worktreeDir, commitsAhead);
			prompt = `You were previously working on this. You have ${commitsAhead} commits.\nReview them with git log. Continue where you left off.\n\nExisting commits:\n${log}\n\n---\n\n${prompt}`;
		}

		// --- Resolve model ---
		const attempts = buildModelAttemptChain({
			defaultProvider: this.config.defaultProvider,
			defaultModel: node.attrs["agent_model"] || nodeLLMModel(node) || this.config.defaultModel,
			policy: this.config.modelPolicy,
			nodeProviderOverride: node.attrs["agent_provider"] || nodeLLMProvider(node),
			nodeModelOverride: node.attrs["agent_model"] || nodeLLMModel(node),
		});
		const attemptIndex = nextLangfuseAttemptIndex(this.generationAttempts, chainKey);

		// Refresh prompt hash once recovery expansion/final prompt shaping is known.
		// Node namespace preserves builder/judge isolation across concurrent nodes.
		recordLangfuseSessionContext(
			ctx,
			node.id,
			sessionKey,
			attemptIndex,
			computeLangfusePromptHash(prompt),
			skillId,
		);

		for (const attempt of attempts) {
			const modelId = attempt.modelId;
			const provider = attempt.provider;
			const selectedVia = attempt.selectedVia;
			assertModelSelectionAllowed({
				policy: this.config.modelPolicy,
				provider,
				model: modelId,
				nodeId: node.id,
				handlerType: "agent.worktree",
				selectedVia,
			});
			const intent = resolveIntentMetadata(node.id, {
				handlerType: "agent.worktree",
				kind: "prompt",
				data: {
					prompt,
					model: modelId,
					provider,
					repo,
					branch,
					base,
					sessionId: sessionKey,
				},
			});

			const model = this.config.modelRegistry.find(provider, modelId);

			if (!model) {
				const errorMessage = `agent.worktree: could not resolve model ${provider}/${modelId}`;
				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.worktree",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: "error",
					errorMessage,
					intent,
				});
				if (attempt !== attempts[attempts.length - 1]) continue;
				return {
					status: StageStatus.Failed,
					output: "",
					error: errorMessage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			}

			// --- Resolve session directory for persistence ---
			const persistentSessionDir = resolvePersistentSessionDir(ctx, sessionKey, { preferWaveSessions: true });
			const sessionManager = persistentSessionDir
				? SessionManager.continueRecent(worktreeDir, persistentSessionDir)
				: SessionManager.inMemory();

			try {
				let progressUnsubscribe = () => {};
				let session = this.sessions.get(sessionKey);
				const cachedCwd = this.sessionCwds.get(sessionKey);
				if (session && cachedCwd && cachedCwd !== worktreeDir) {
					console.log(`    [worktree:${sessionKey}] CWD changed (${cachedCwd} → ${worktreeDir}), migrating session`);
					this.sessionSubscriptions.get(sessionKey)?.();
					if (session.dispose) session.dispose();
					this.sessions.delete(sessionKey);
					this.sessionCwds.delete(sessionKey);
					this.sessionSubscriptions.delete(sessionKey);
					session = undefined;
				}

				if (!session) {
					const traceOptions = buildOpenRouterTraceOptions(
						ctx,
						{ pipelineFile: this.config.pipelineFile, graph: this.config.graph },
						"agent.worktree",
						`${sessionKey}:attempt:${attemptIndex}`,
						llmPathId,
					);
					const sessionOptions = mergeOpenRouterTraceOptions({
						cwd: worktreeDir,
						model,
						thinkingLevel: "high" as any,
						tools: createCodingTools(worktreeDir),
						sessionManager,
						settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 98304, keepRecentTokens: 32768 } }),
						resourceLoader: this.config.resourceLoader,
						authStorage: this.config.authStorage,
						modelRegistry: this.config.modelRegistry,
					}, traceOptions);
					const created = await createAgentSession(sessionOptions as any);
					session = created.session;
					this.sessions.set(sessionKey, session);
					this.sessionCwds.set(sessionKey, worktreeDir);
				}

				this.sessionSubscriptions.get(sessionKey)?.();
				const unsubscribe = bindLangfuseSessionTelemetry({
					session,
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.worktree",
					sessionKey,
					attemptIndex,
					intent,
					logPrefix: `worktree:${sessionKey}`,
				});
				progressUnsubscribe = session.subscribe(() => reportProgress());
				this.sessionSubscriptions.set(sessionKey, () => {
					progressUnsubscribe();
					unsubscribe();
				});

				const ac = new AbortController();
				if (signal) {
					signal.addEventListener("abort", () => ac.abort(), { once: true });
				}
				let timeoutId: ReturnType<typeof setTimeout> | undefined;
				if (timeoutMs > 0) {
					timeoutId = setTimeout(() => ac.abort(), timeoutMs);
				}

				let output: string;
				try {
					output = await promptAndExtractText(session, prompt, `worktree:${sessionKey}`);
					reportProgress();
				} finally {
					if (timeoutId) clearTimeout(timeoutId);
				}

				const assistant = extractLastAssistantMessage(session.messages);
				const apiError = isAssistantError(assistant);
				if (apiError.isError) {
					emitLangfuseGenerationEvent({
						eventBus: this.config.eventBus,
						node,
						ctx,
						handlerType: "agent.worktree",
						llmPathId,
						sessionKey,
						attemptIndex,
						prompt,
						provider,
						model: modelId,
						outcome: "error",
						errorMessage: apiError.errorMessage,
						intent,
					});
					if (attempt !== attempts[attempts.length - 1] && isRetryableModelFailureMessage(apiError.errorMessage || "")) {
						continue;
					}
					return {
						status: StageStatus.Failed,
						output: "",
						error: `agent.worktree: LLM API error: ${apiError.errorMessage}`,
						contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
						intent,
					};
				}
				const usage = usageFromAssistantMessage(assistant);
				const contextUpdates = {
					...buildContextUpdates(branch, worktreeDir, base),
					...modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
				};

				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.worktree",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: "success",
					usage,
					intent,
				});

				if (shouldCleanup) {
					try {
						this.sessionSubscriptions.get(sessionKey)?.();
						session.dispose();
						this.sessions.delete(sessionKey);
						this.sessionCwds.delete(sessionKey);
						this.sessionSubscriptions.delete(sessionKey);
						const cleanupCheck = validateWorktreeDirectory({ repoDir, worktreeDir });
						if (!cleanupCheck) {
							withRepoGitMutationLock(repoDir, () => {
								execFileSync("git", ["-C", repoDir, "worktree", "remove", worktreeDir], { stdio: "pipe" });
								execFileSync("git", ["-C", repoDir, "branch", "-D", branch], { stdio: "pipe" });
							});
						}
					} catch {
						// Best-effort cleanup
					}
				}

				return { status: StageStatus.Completed, output, usage, contextUpdates, intent };
			} catch (err) {
				const errorMessage = `agent.worktree: agent failed: ${err instanceof Error ? err.message : err}`;
				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.worktree",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: /length\/context limit/i.test(errorMessage) ? "length" : "error",
					errorMessage,
					intent,
				});
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
			error: "agent.worktree: exhausted model attempt chain",
		};
	}
}

/**
 * KnowledgeWorkerHandler runs a persistent pi agent session.
 * Unlike worktree agents, KW agents don't create worktrees —
 * they run in the current workdir with full coding tools and
 * persist their session for re-prompting.
 *
 * Attributes:
 *   prompt     — task prompt
 *   session_id — persistent session identifier (for re-use across nodes)
 */
export class KnowledgeWorkerHandler implements Handler {
	private sessions = new Map<string, any>();
	private sessionSubscriptions = new Map<string, () => void>();
	private sessionPersonaFingerprints = new Map<string, string>();
	private generationAttempts = new Map<string, number>();

	constructor(private config: HandlerConfig) {}

	async execute(_signal: AbortSignal, node: Node, ctx: Context, input: string): Promise<Outcome> {
		const explicitSessionId = expandVariables(node.attrs["session_id"] ?? "", ctx);
		const sessionKey = resolveSessionKey(explicitSessionId, node.id);

		// Resolve working directory
		let workDir = node.attrs["workdir"] ?? "";
		if (!workDir && this.config.graph) workDir = this.config.graph.attrs["workdir"] ?? "";
		if (!workDir) workDir = this.config.workDir || ".";
		workDir = expandVariables(workDir, ctx);

		// Build prompt
		let prompt = nodePrompt(node);
		if (!prompt) prompt = input;
		else if (input) prompt = prompt + "\n\n" + input;
		prompt = expandVariables(prompt, ctx);

		const persona = normalizePersona(expandVariables(node.attrs["persona"] ?? "", ctx));
		const personaHash = persona;

		const attempts = buildModelAttemptChain({
			defaultProvider: this.config.defaultProvider,
			defaultModel: nodeLLMModel(node) || this.config.defaultModel,
			policy: this.config.modelPolicy,
			nodeProviderOverride: nodeLLMProvider(node),
			nodeModelOverride: nodeLLMModel(node),
		});
		const chainKey = `agent.kw:${sessionKey}`;
		const attemptIndex = nextLangfuseAttemptIndex(this.generationAttempts, chainKey);
		const llmPathId = String(node.attrs["llm_path_id"] || "");

		// Node-scoped session metadata keeps long-running KW sessions correlated
		// in stage spans without leaking context across nodes/partitions.
		recordLangfuseSessionContext(
			ctx,
			node.id,
			sessionKey,
			attemptIndex,
			computeLangfusePromptHash(prompt),
			node.attrs["skill_id"] || node.attrs["skill"] || node.attrs["skill_name"] || "agent.kw",
		);

		for (const attempt of attempts) {
			const modelId = attempt.modelId;
			const provider = attempt.provider;
			const selectedVia = attempt.selectedVia;
			assertModelSelectionAllowed({
				policy: this.config.modelPolicy,
				provider,
				model: modelId,
				nodeId: node.id,
				handlerType: "agent.kw",
				selectedVia,
			});
			const intent = resolveIntentMetadata(node.id, {
				handlerType: "agent.kw",
				kind: "prompt",
				data: {
					prompt,
					model: modelId,
					provider,
					sessionId: sessionKey,
					workDir,
				},
			});

			const model = this.config.modelRegistry.find(provider, modelId);

			if (!model) {
				const errorMessage = `Could not resolve model ${provider}/${modelId}`;
				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.kw",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: "error",
					errorMessage,
					intent,
				});
				if (attempt !== attempts[attempts.length - 1]) continue;
				return {
					status: StageStatus.Failed,
					output: "",
					error: errorMessage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			}

			try {
				let session = this.sessions.get(sessionKey);
				const cachedPersonaHash = this.sessionPersonaFingerprints.get(sessionKey) ?? "";

				if (session && cachedPersonaHash !== personaHash) {
					this.sessionSubscriptions.get(sessionKey)?.();
					session.dispose?.();
					this.sessions.delete(sessionKey);
					this.sessionSubscriptions.delete(sessionKey);
					session = undefined;
				}

				if (!session) {
					const persistentSessionDir = resolvePersistentSessionDir(ctx, sessionKey);
					const sessionManager = persistentSessionDir
						? SessionManager.create(workDir, persistentSessionDir)
						: SessionManager.inMemory();
					const resourceLoader = persona
						? {
							getExtensions: () => this.config.resourceLoader.getExtensions(),
							getSkills: () => this.config.resourceLoader.getSkills(),
							getPrompts: () => this.config.resourceLoader.getPrompts(),
							getThemes: () => this.config.resourceLoader.getThemes(),
							getAgentsFiles: () => this.config.resourceLoader.getAgentsFiles(),
							getSystemPrompt: () => this.config.resourceLoader.getSystemPrompt(),
							getAppendSystemPrompt: () => [
								...this.config.resourceLoader.getAppendSystemPrompt(),
								`Persona reasoning frame (persistent across this session):\n${persona}`,
							],
							getPathMetadata: () => this.config.resourceLoader.getPathMetadata(),
							extendResources: (paths: Parameters<ResourceLoader["extendResources"]>[0]) => this.config.resourceLoader.extendResources(paths),
							reload: () => this.config.resourceLoader.reload(),
						}
						: this.config.resourceLoader;

					const traceOptions = buildOpenRouterTraceOptions(
						ctx,
						{ pipelineFile: this.config.pipelineFile, graph: this.config.graph },
						"agent.kw",
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
						resourceLoader,
						authStorage: this.config.authStorage,
						modelRegistry: this.config.modelRegistry,
					}, traceOptions);
					const result = await createAgentSession(sessionOptions as any);
					session = result.session;
					this.sessions.set(sessionKey, session);
					this.sessionPersonaFingerprints.set(sessionKey, personaHash);
				}

				this.sessionSubscriptions.get(sessionKey)?.();
				const unsubscribe = bindLangfuseSessionTelemetry({
					session,
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.kw",
					sessionKey,
					attemptIndex,
					intent,
					logPrefix: `kw:${sessionKey}`,
				});
				this.sessionSubscriptions.set(sessionKey, unsubscribe);

				const output = await promptAndExtractText(session, prompt, `kw:${sessionKey}`);

				const assistant = extractLastAssistantMessage(session.messages);
				const apiError = isAssistantError(assistant);
				if (apiError.isError) {
					emitLangfuseGenerationEvent({
						eventBus: this.config.eventBus,
						node,
						ctx,
						handlerType: "agent.kw",
						llmPathId,
						sessionKey,
						attemptIndex,
						prompt,
						provider,
						model: modelId,
						outcome: "error",
						errorMessage: apiError.errorMessage,
						intent,
					});
					if (attempt !== attempts[attempts.length - 1] && isRetryableModelFailureMessage(apiError.errorMessage || "")) {
						continue;
					}
					return {
						status: StageStatus.Failed,
						output: "",
						error: `agent.kw: LLM API error: ${apiError.errorMessage}`,
						contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
						intent,
					};
				}
				const usage = usageFromAssistantMessage(assistant);

				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.kw",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: "success",
					usage,
					intent,
				});

				return {
					status: StageStatus.Completed,
					output,
					usage,
					contextUpdates: modelPolicyContextUpdates(this.config.modelPolicy, provider, modelId, selectedVia),
					intent,
				};
			} catch (err) {
				const errorMessage = `agent.kw: failed: ${err instanceof Error ? err.message : err}`;
				emitLangfuseGenerationEvent({
					eventBus: this.config.eventBus,
					node,
					ctx,
					handlerType: "agent.kw",
					llmPathId,
					sessionKey,
					attemptIndex,
					prompt,
					provider,
					model: modelId,
					outcome: /length\/context limit/i.test(errorMessage) ? "length" : "error",
					errorMessage,
					intent,
				});
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
			error: "agent.kw: exhausted model attempt chain",
		};
	}
}

// ── Helpers ──

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

function getWorktreeGitState(worktreeDir: string, base: string): { commitsAhead: number; isDirty: boolean } {
	let commitsAhead = 0;
	let isDirty = false;

	try {
		const countOut = execFileSync("git", ["rev-list", `${base}..HEAD`, "--count"], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
		commitsAhead = parseInt(countOut, 10) || 0;
	} catch {
		// Branch might not have diverged yet
	}

	try {
		const status = execFileSync("git", ["status", "--porcelain"], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
		isDirty = status.length > 0;
	} catch {
		// Treat as clean
	}

	return { commitsAhead, isDirty };
}

function gitLog(worktreeDir: string, count: number): string {
	try {
		return execFileSync("git", ["log", `--oneline`, `-${count}`], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
	} catch {
		return "(could not read git log)";
	}
}

function buildContextUpdates(branch: string, worktreeDir: string, base: string): Record<string, string> {
	const state = getWorktreeGitState(worktreeDir, base);
	return {
		[`${sanitizeKey(branch)}_commits`]: String(state.commitsAhead),
		[`${sanitizeKey(branch)}_worktree`]: worktreeDir,
		[`${sanitizeKey(branch)}_dirty`]: state.isDirty ? "true" : "false",
	};
}

function sanitizeKey(branch: string): string {
	return branch.replace(/[^a-zA-Z0-9_]/g, "_");
}

function normalizePersona(value: string): string {
	return String(value || "").replace(/\r\n/g, "\n").trim();
}

function extractLastAssistantMessage(messages: any[]): any {
	for (let i = messages.length - 1; i >= 0; i--) {
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

function validateWorktreeDirectory({ repoDir, worktreeDir }: { repoDir: string; worktreeDir: string }): string {
	if (!worktreeDir) return "missing worktree directory";
	const resolved = resolve(worktreeDir);
	if (resolved === resolve(repoDir)) {
		return `worktree directory must not be the canonical checkout: ${worktreeDir}`;
	}
	const canonicalPath = process.env.HATCH_CANONICAL_CHECKOUT_PATH || "";
	if (canonicalPath && resolved === resolve(canonicalPath)) {
		return `worktree directory must not be the canonical checkout: ${worktreeDir}`;
	}
	const classification = classifyWorktreePath(worktreeDir, repoDir, canonicalPath || repoDir);
	if (classification.protected) {
		return `worktree path blocked by policy: ${classification.reason}`;
	}
	return "";
}

function getWorktreeCurrentBranch(worktreeDir: string): string {
	try {
		return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
	} catch {
		return "";
	}
}

function validateExistingGitWorktree(worktreeDir: string, expectedBranch?: string): string {
	try {
		const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
		if (inside !== "true") {
			return `existing worktree is not a git worktree: ${worktreeDir}`;
		}
		const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: worktreeDir,
			stdio: "pipe",
		}).toString().trim();
		if (resolve(topLevel) !== resolve(worktreeDir)) {
			return `existing worktree is not the repo root: ${worktreeDir}`;
		}
		if (expectedBranch) {
			const currentBranch = getWorktreeCurrentBranch(worktreeDir);
			if (currentBranch && currentBranch !== expectedBranch) {
				return `existing worktree is on branch "${currentBranch}" but expected "${expectedBranch}": ${worktreeDir}`;
			}
		}
		return "";
	} catch {
		return `existing worktree is not a git worktree: ${worktreeDir}`;
	}
}

function withRepoGitMutationLock<T>(repoDir: string, fn: () => T): T {
	const release = acquireRepoGitMutationLock(repoDir);
	try {
		return fn();
	} finally {
		release();
	}
}

function acquireRepoGitMutationLock(repoDir: string): () => void {
	const lockPath = resolveRepoGitMutationLockPath(repoDir);
	const payload = JSON.stringify({
		pid: process.pid,
		repoDir,
		createdAt: new Date().toISOString(),
	});

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeFileSync(lockPath, payload, "utf8");
			} finally {
				closeSync(fd);
			}
			return () => {
				try {
					unlinkSync(lockPath);
				} catch {
					// Best-effort cleanup
				}
			};
		} catch (error: any) {
			if (error?.code !== "EEXIST") {
				throw error;
			}
			if (!clearStaleRepoGitMutationLock(lockPath)) {
				const detail = readExistingRepoGitMutationLock(lockPath);
				throw new Error(
					`canonical checkout git mutation lock is already held at ${lockPath}${detail ? ` (${detail})` : ""}`,
				);
			}
		}
	}

	throw new Error(`failed to acquire canonical checkout git mutation lock at ${lockPath}`);
}

function resolveRepoGitMutationLockPath(repoDir: string): string {
	const gitPath = resolve(repoDir, ".git");
	if (existsSync(gitPath)) {
		try {
			mkdirSync(gitPath, { recursive: true });
			return resolve(gitPath, "hatch.lock");
		} catch {
			return resolve(repoDir, ".git.hatch.lock");
		}
	}
	return resolve(repoDir, ".git.hatch.lock");
}

function clearStaleRepoGitMutationLock(lockPath: string): boolean {
	const lock = readRepoGitMutationLock(lockPath);
	if (!lock?.pid || isPidAlive(lock.pid)) {
		return false;
	}
	try {
		unlinkSync(lockPath);
		return true;
	} catch {
		return false;
	}
}

function readExistingRepoGitMutationLock(lockPath: string): string {
	const lock = readRepoGitMutationLock(lockPath);
	if (!lock) return "";
	const parts = [];
	if (typeof lock.pid === "number") parts.push(`pid=${lock.pid}`);
	if (typeof lock.createdAt === "string" && lock.createdAt) parts.push(`createdAt=${lock.createdAt}`);
	return parts.join(" ");
}

function readRepoGitMutationLock(lockPath: string): { pid?: number; createdAt?: string } | null {
	try {
		const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
