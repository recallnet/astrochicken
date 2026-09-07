import { createDefaultActionRegistry, type ActionRegistry } from "../action-registry.js";
import { HandlerRegistry } from "../engine.js";
import { AssertHandler } from "./assert.js";
import { CodergenHandler, type CodergenConfig } from "./codergen.js";
import { ConditionalHandler } from "./conditional.js";
import { ExitHandler } from "./exit.js";
import { DetachedFanOutHandler } from "./fan_out_detached.js";
import { DynamicFanOutHandler, DynamicFanInHandler } from "./fan_out_dynamic.js";
import { HumanHandler, type Interviewer } from "./human.js";
import { ManagerLoopHandler, type ManagerConfig } from "./manager.js";
import { ParallelHandler, FanInHandler } from "./parallel.js";
import { PipelineHandler } from "./pipeline.js";
import { StartHandler } from "./start.js";
import { ToolHandler } from "./tool.js";
import { WorktreeAgentHandler, KnowledgeWorkerHandler } from "./worktree.js";

import type { EffectiveModelPolicy } from "../../factory/model-policy.js";
import type { Graph } from "../graph.js";
import type { IdentityMode } from "../identity.js";
import type { RunState } from "../run.js";
import type { ModelRegistry, AuthStorage, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import type { LangfuseLifecycleEmitter } from "@recallnet/factory-telemetry";
import type { EventBus } from "@recallnet/factory-telemetry";

/** Config holds dependencies needed by handlers. */
export interface HandlerConfig {
	/** Model registry for resolving models and API keys. */
	modelRegistry: ModelRegistry;
	/** Auth storage for credentials. */
	authStorage: AuthStorage;
	/** Resource loader (pre-loaded) for skills, extensions, context. */
	resourceLoader: DefaultResourceLoader;
	/** Default LLM model name. */
	defaultModel: string;
	/** Default LLM provider name. */
	defaultProvider: string;
	/** Effective factory model policy when running inside a factory workspace. */
	modelPolicy?: EffectiveModelPolicy;
	/** Default working directory for tool nodes. */
	workDir?: string;
	/** The parsed pipeline graph. */
	graph?: Graph;
	/** Source DOT file path for this pipeline run. */
	pipelineFile?: string;
	/** Interviewer for wait.human nodes. */
	interviewer?: Interviewer;
	/** Parent run state for live introspection wiring in nested handlers. */
	runState?: RunState;
	/** Shared event bus so handlers can emit telemetry through existing trace scaffolding. */
	eventBus?: EventBus;
	/** Validation identity mode inherited by nested pipeline validation. */
	identityMode?: IdentityMode;
	/** Optional lifecycle emitter override for serve/runtime integration tests and embedding. */
	langfuseLifecycleEmitter?: LangfuseLifecycleEmitter;
	/** Shared environment injected into every tool execution. */
	toolEnv?: Record<string, string>;
	/** Registered in-process typed actions for tool nodes opting into action_runtime="in_process". */
	actionRegistry?: ActionRegistry;
}

/** Register all built-in handlers with the registry. */
export function registerAll(reg: HandlerRegistry, cfg: HandlerConfig): void {
	const workDir = cfg.workDir || ".";
	const actionRegistry = cfg.actionRegistry ?? createDefaultActionRegistry();

	reg.register("start", new StartHandler());
	reg.register("exit", new ExitHandler());
	reg.register("conditional", new ConditionalHandler());
	reg.register("parallel", new ParallelHandler());
	reg.register("parallel.fan_in", new FanInHandler());
	reg.register("tool", new ToolHandler(workDir, cfg.graph, { ...(cfg.toolEnv ?? {}) }, actionRegistry));
	reg.register("assert", new AssertHandler(workDir, cfg.graph));
	reg.register("pipeline", new PipelineHandler(cfg));
	reg.register("fan_out.dynamic", new DynamicFanOutHandler(cfg));
	reg.register("fan_in.dynamic", new DynamicFanInHandler());
	reg.register("fan_out.detached", new DetachedFanOutHandler(cfg));
	reg.register("agent.worktree", new WorktreeAgentHandler(cfg));
	reg.register("agent.kw", new KnowledgeWorkerHandler(cfg));

	// LLM-backed handlers
	const codergenConfig: CodergenConfig = {
		modelRegistry: cfg.modelRegistry,
		authStorage: cfg.authStorage,
		resourceLoader: cfg.resourceLoader,
		defaultModel: cfg.defaultModel,
		defaultProvider: cfg.defaultProvider,
		modelPolicy: cfg.modelPolicy,
		eventBus: cfg.eventBus,
		pipelineFile: cfg.pipelineFile,
	};
	reg.register("codergen", new CodergenHandler(codergenConfig));

	const managerConfig: ManagerConfig = {
		modelRegistry: cfg.modelRegistry,
		authStorage: cfg.authStorage,
		resourceLoader: cfg.resourceLoader,
		defaultModel: cfg.defaultModel,
		defaultProvider: cfg.defaultProvider,
		modelPolicy: cfg.modelPolicy,
		workDir,
		graph: cfg.graph,
		eventBus: cfg.eventBus,
		pipelineFile: cfg.pipelineFile,
	};
	reg.register("stack.manager_loop", new ManagerLoopHandler(managerConfig));

	// Human handler
	const interviewer = cfg.interviewer;
	if (interviewer) {
		reg.register("wait.human", new HumanHandler(interviewer));
	}
}
