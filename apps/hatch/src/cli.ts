#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { AuthStorage, ModelRegistry, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import {
	EventBus,
	factoryMetadataProviderFromIdentity,
	flushOtelRuntime,
	shutdownOtelRuntime,
} from "@recallnet/factory-telemetry";

import {
	applyFactoryContextToEngineContext,
	seedRunStateFactoryContext,
} from "./cli/factory-context-runtime.js";
import { assertCanonicalEventStoreAvailableForCommand } from "./event-store/runtime-guard.js";
import { createCanonicalLifecycleEventEmitter } from "./event-store/lifecycle-backfill.js";
import {
	defaultModelForProvider,
	resolveFactoryIsolationAuthStoragePath,
	resolveFactoryIsolationRuntimeEnv,
	seedRuntimeApiKeysFromEnv,
} from "./cli/provider-defaults.js";
import { resolveHandlerModelPolicy } from "./cli/handler-model-policy.js";
import { readFactoryTelemetryIdentityForRun } from "./cli/run-config.js";
import {
	cmdRun,
	cmdResume,
	cmdRecover,
	cmdValidate,
	cmdResolve,
	cmdNew,
	cmdServe,
	cmdTrace,
	cmdGraph,
	cmdWatch,
	cmdDispatch,
	cmdFactory,
	cmdRuns,
	cmdComplexity,
	type RunPipelineOpts,
	type CliCommandDeps,
} from "./cli-commands.js";
import {
	type FactoryContext,
} from "./factory/context-resolver.js";
import { getFactoryIsolationConfig } from "./factory/config-schema.js";
import { type EffectiveModelPolicy } from "./factory/model-policy.js";
import { printHelpTopic } from "./help.js";
import { findRepoRoot, loadIntentRegistry, IntentLoadError } from "./intent/loader.js";
import { Context } from "./pipeline/context.js";
import { Engine, HandlerRegistry } from "./pipeline/engine.js";
import {
	graphWorkDir,
	graphIdentityMode,
} from "./pipeline/graph.js";
import { enforceModelMatrixContractsAtLoad } from "./pipeline/model-matrix-resolution.js";
import { ConsoleInterviewer } from "./pipeline/handler/human.js";
import { registerAll, type HandlerConfig } from "./pipeline/handler/register.js";
import { persistLifecycleContextFromEngine } from "./pipeline/lifecycle-persistence.js";
import { createLiveStatusHandler } from "./pipeline/live.js";
import { parseWithAst } from "./pipeline/parse.js";
import { createReactorInstrumentationHelpers } from "./pipeline/reactor-instrumentation.js";
import { applyGraphStylesheetImports } from "./pipeline/stylesheet-imports.js";
import { validate, formatValidationError, hasValidationErrors } from "./pipeline/validate.js";
import { graphWorkDirForResolvedSource, loadGraphSource } from "./pipeline/graph-source.js";
import type { Graph } from "./pipeline/graph.js";

import { createTraceHandler } from "./pipeline/trace.js";
import { ThreadStore } from "./pipeline/threads.js";

import type { IdentityMode } from "./pipeline/identity.js";

import { createSharedToolEnv } from "./pipeline/tool-env.js";
import {
	generateRunId,
	createRunState,
	saveRunState,
	loadRunState,
	eventsPath,
	configureRunStorageScope,
	setLifecycleProjectionEmitter,
	type RunState,
} from "./pipeline/run.js";

let activeEngine: Engine | null = null;
const commandDeps: CliCommandDeps = {
	runPipeline,
	parseGraph,
	loadIntentRegistryForFile,
	buildHandlerConfig,
};

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		usage();
		return;
	}

	await assertCanonicalEventStoreAvailableForCommand(args[0]);

	switch (args[0]) {
		case "run":
			await cmdRun(args.slice(1), commandDeps);
			break;
		case "resume":
			await cmdResume(args.slice(1), commandDeps);
			break;
		case "recover":
			await cmdRecover(args.slice(1), commandDeps);
			break;
		case "runs":
			await cmdRuns(args.slice(1));
			break;
		case "validate":
			await cmdValidate(args.slice(1), commandDeps);
			break;
		case "resolve":
			await cmdResolve(args.slice(1));
			break;
		case "new":
			await cmdNew(args.slice(1));
			break;
		case "serve":
			await cmdServe(args.slice(1), commandDeps);
			break;
		case "trace":
			await cmdTrace(args.slice(1));
			break;
		case "graph":
			await cmdGraph(args.slice(1), commandDeps);
			break;
		case "watch":
			await cmdWatch(args.slice(1), commandDeps);
			break;
		case "dispatch":
			await cmdDispatch(args.slice(1));
			break;
		case "factory":
			await cmdFactory(args.slice(1));
			break;
		case "complexity":
			await cmdComplexity(args.slice(1));
			break;
		case "help":
		case "--help":
		case "-h":
			if (args.length >= 2) {
				printHelpTopic(args[1]);
			} else {
				usage();
			}
			break;
		default:
			console.error(`unknown command: ${args[0]}\n`);
			usage();
			process.exit(1);
			return;
	}
}

function usage() {
	console.log(`hatch - AI pipeline runner

Hatch runs multi-step AI workflows defined as DOT graphs.
Each node is a task (LLM call, shell command, human gate)
and edges define the flow between them.

Mode orientation:
  Hatch has two modes: standalone and managed.
  Use "hatch help modes" to pick the right lifecycle and command set.

Quick start:
  hatch new my-pipeline                          Create a new pipeline
  hatch validate my-pipeline.dot                 Check it's valid
  hatch validate --identity-mode strict my.dot   Check strict identity contract
  hatch run my-pipeline.dot                      Run it

Commands:
  hatch run <file.dot>           Run a pipeline
  hatch run --trace <file.dot>   Run with JSONL trace output
  hatch run --checkpoint <f.dot> Run with checkpoint/resume support
  hatch run --context <f.json>   Load JSON into pipeline context
  hatch run --run-id <id> <f>    Run with specified run id
  hatch run --lock <name> <f>    Run with named lock (serial execution)
  hatch run --singleton <f.dot>  Run only if not already running
  hatch run --live <f.dot>       Run with live CLI status view
  hatch resume [--trace] [--live] <file.dot>        Resume from last checkpoint
  hatch recover [run-id]         Resume a crashed/suspended run
  hatch runs                     List all pipeline runs
  hatch runs active [--json]     Operator-friendly active-run summary (shared with hatch-ops presenter)
  hatch runs recoverable [--json] Operator-friendly recoverable-run summary (shared presenter)
  hatch runs reconcile [--json] [--abandon-seconds=<n>] [--gc] [--no-lease-sweep]  Terminalize stale recoverables + reclaim stale leases
  hatch runs recovery-sweep [--json] [--apply] [--stale-seconds=<n>] [--runs-dir=<path>] [--repo=<path>] [--run-id=<id>] [--worktree=<path>] [--branch=<name>]  Scan/reconcile stale runs + orphan worktrees/branches
  hatch runs latest [--json] [--pipeline=<name>] [--status=<state>]  Show latest matching run
  hatch runs why [run-id] [--json]  Operator-friendly stage/progress/elapsed posture (shared presenter)
  hatch runs context <run-id> [--key=<name>] [--json]  Inspect run context keys/values
  hatch runs <run-id> [--json]   Show run details
  hatch runs gc [--worktrees]    Clean up completed/stale runs
  hatch validate <file.dot>      Validate a pipeline
  hatch validate --identity-mode <legacy|strict> <file.dot>  Override identity validation mode
  hatch resolve @scope/pkg/path  Resolve package path to absolute filesystem path
  hatch new <name>               Create a new pipeline file
  hatch serve [addr]             Start HTTP server (default :8080)
  hatch trace <file.dot>         Show execution trace
  hatch graph tree <file.dot>    Show pipeline node tree
  hatch graph deps <file.dot>    Show node dependencies
  hatch watch <file.dot> [opts]  Watch files/interval and re-run
  hatch dispatch [opts]          Run dispatch control plane loop
  hatch factory init [opts]      Scaffold a new factory instance from templates
  hatch factory conformance [opts]  Run deterministic factory conformance harness
  hatch complexity estimate [opts]  Deterministically estimate complexity signals/class
  hatch-ops factory status [opts]   mode: both
  hatch-ops factory fleet-status [opts] mode: both
  hatch-ops factory attention [opts] mode: both
  hatch-ops factory tick-status [opts]  mode: both
  hatch-ops factory subscribe [opts] mode: both
  hatch-ops factory host-* [opts]   managed-only

Learn more:
  hatch help nodes               Node types and shapes
  hatch help edges               Edges, conditions, and routing
  hatch help context             Variables and data flow
  hatch help attributes          All graph/node/edge attributes
  hatch help examples            Annotated example pipelines
  hatch help stylesheets         Model stylesheets (CSS-like)
  hatch help validation          Validation rules explained
  hatch help modes               Standalone vs managed lifecycle guidance

Providers (auto-detected from API keys or pi OAuth):
  anthropic    ANTHROPIC_API_KEY or Claude Max via pi /login
  openai       OPENAI_API_KEY
  gemini       GEMINI_API_KEY or GOOGLE_API_KEY

Environment:
  HATCH_MODEL                  Override default model (default: auto per provider)
  HATCH_PROVIDER               Override default provider (default: first available)
  HATCH_INTENT_PATHS           Comma-separated intent paths (default: context/intent if present)
  HATCH_DISPATCH_INTERVAL_MS   Override dispatch loop interval in ms
  HATCH_DISPATCH_MAX_PER_TICK  Override max dispatch claims processed per tick`);
}

export function createPipelineToolEnv(graph: Graph | undefined, pipelineFile: string): Record<string, string> {
	const workDir = graph ? graphWorkDir(graph) || "." : ".";
	return createSharedToolEnv({
		pipelineFile,
		workDir,
	});
}

async function buildHandlerConfig(
	graph?: Graph,
	opts?: { pipelineFile?: string; toolEnv?: Record<string, string>; factoryContext?: FactoryContext },
): Promise<HandlerConfig> {
	const runtimeEnv = resolveRuntimeEnvForHandlerConfig(opts?.factoryContext);
	const authStorage = AuthStorage.create(
		resolveFactoryIsolationAuthStoragePath({ env: runtimeEnv }) || undefined,
	);
	seedRuntimeApiKeysFromEnv(authStorage, runtimeEnv);
	const modelRegistry = new ModelRegistry(authStorage);

	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		noExtensions: true,
	});
	await loader.reload();

	const modelPolicy = resolveHandlerModelPolicy({
		pipelineFile: opts?.pipelineFile,
		factoryContext: opts?.factoryContext,
		env: runtimeEnv,
	});

	let defaultProvider = "";
	let resolvedModel = "";
	if (modelPolicy) {
		defaultProvider = modelPolicy.defaultProvider;
		resolvedModel = modelPolicy.defaultModel;
	} else {
		defaultProvider = runtimeEnv["HATCH_PROVIDER"] || "";
		const defaultModel = runtimeEnv["HATCH_MODEL"] || "";

		if (!defaultProvider) {
			if (runtimeEnv["ANTHROPIC_API_KEY"]) defaultProvider = "anthropic";
			else if (runtimeEnv["OPENAI_API_KEY"]) defaultProvider = "openai";
			else if (runtimeEnv["GEMINI_API_KEY"] || runtimeEnv["GOOGLE_API_KEY"]) defaultProvider = "google";
			else defaultProvider = "anthropic";
		}

		resolvedModel = defaultModel || defaultModelForProvider(defaultProvider);
	}
	const workDir = graph ? graphWorkDir(graph) || "." : ".";
	const toolEnv = opts?.toolEnv ?? (opts?.pipelineFile
		? createPipelineToolEnv(graph, opts.pipelineFile)
		: undefined);

	return {
		modelRegistry,
		authStorage,
		resourceLoader: loader as any,
		defaultModel: resolvedModel,
		defaultProvider,
		modelPolicy,
		workDir,
		graph,
		interviewer: new ConsoleInterviewer(),
		toolEnv,
	};
}

function applyModelPolicyContext(ctx: Context, policy: EffectiveModelPolicy | undefined): void {
	if (!policy) return;
	ctx.set("model_policy_version", policy.policySource.policyVersion);
	ctx.set("model_policy_source", policy.policySource.configPath);
	ctx.set("model_policy_policy_pack_dir", policy.policySource.policyPackDir);
	ctx.set("model_policy_default_provider", policy.defaultProvider);
	ctx.set("model_policy_default_model", policy.defaultModel);
	ctx.set("model_policy_selected_via", policy.selectedVia);
	ctx.set("model_policy_allowed_models", policy.allowedModels.join(","));
}

function parseGraph(file: string): Graph {
	const loadedGraph = loadGraphSource(file, process.cwd());
	const data = loadedGraph.sourceText;
	const parsed = parseWithAst(data);
	applyGraphStylesheetImports({
		graph: parsed.graph,
		graphFile: loadedGraph.resolvedPath,
		stylesheetImports: parsed.stylesheetImports,
		repoRootPath: findRepoRoot(dirname(loadedGraph.resolvedPath)),
	});
	const workDir = graphWorkDir(parsed.graph) || graphWorkDirForResolvedSource(loadedGraph.resolvedPath, file);
	enforceModelMatrixContractsAtLoad({ graph: parsed.graph, workDir });
	return parsed.graph;
}

function loadIntentRegistryForFile(file: string) {
	const rootDir = findRepoRoot(dirname(file));
	try {
		return loadIntentRegistry({ rootDir }) ?? undefined;
	} catch (err) {
		const message = err instanceof IntentLoadError ? err.message : String(err);
		console.error(`Intent registry error:\n${message}`);
		process.exit(1);
		return undefined;
	}
}

function setupEventBus(opts?: { live?: boolean; graph?: Graph; runId?: string }): EventBus {
	const bus = new EventBus();
	const live = opts?.live && opts?.graph;

	if (live && opts?.graph) {
		bus.on(createLiveStatusHandler(opts.graph, opts.runId));
	}

	bus.on((e) => {
		if (live) {
			if (e.kind === "pipeline.error") console.error(`Pipeline error: ${e.message}`);
			return;
		}
		switch (e.kind) {
			case "stage.start":
				console.log(`  ▶ ${e.nodeId}`);
				break;
			case "stage.finish":
				console.log(`  ✓ ${e.nodeId}`);
				if (e.message) console.log(`    ${e.message}`);
				break;
			case "stage.error":
				console.log(`  ✗ ${e.nodeId}: ${e.error?.message}`);
				break;
			case "edge.selected":
				console.log(`    → ${e.edgeTo}`);
				break;
			case "pipeline.start": {
				const name = e.message || "pipeline";
				console.log(`Starting ${name}`);
				break;
			}
			case "pipeline.finish":
				console.log("Pipeline completed.");
				break;
			case "pipeline.error":
				console.error(`Pipeline error: ${e.message}`);
				break;
			case "checkpoint.saved":
				console.log(`    [checkpoint] saved at ${e.nodeId}`);
				break;
		}
	});
	return bus;
}

async function runPipeline(file: string, opts: RunPipelineOpts) {
	const graph = parseGraph(file);
	const intentRegistry = loadIntentRegistryForFile(file);
	const identityMode = opts.identityMode ?? graphIdentityMode(graph);

	const errs = validate(graph, { intentRegistry, identityMode });
	if (errs.length > 0) {
		for (const e of errs) console.error(`  ${formatValidationError(e)}`);
		if (hasValidationErrors(errs)) {
			// @context:regression !critical CLI tests import this module with
			// `process.exit` mocked, so terminal validation failures must return
			// immediately instead of relying on the real process exit to stop
			// downstream run-state creation.
			process.exit(1);
			return;
		}
	}

	const factoryIdentityFromConfig = readFactoryTelemetryIdentityForRun(file);
	configureRunStorageScope({
		runsDir: opts.factoryContext.runs_dir,
		factoryId: opts.factoryContext.factory_id,
		pipelineFile: file,
	});

	let runState = opts.runState;
	const canonicalFactoryId = String(opts.factoryContext.factory_id || factoryIdentityFromConfig.factory_id || "").trim();
	const canonicalStoreUrl = String(process.env["HATCH_CANONICAL_EVENT_STORE_URL"] || "").trim();
	const canonicalStoreRequired = process.env["HATCH_CANONICAL_EVENT_STORE_REQUIRED"] === "true";
	const canonicalLifecycleEmitter = canonicalStoreUrl
		? createCanonicalLifecycleEventEmitter({
				connectionString: canonicalStoreUrl,
				factoryId: canonicalFactoryId,
				runId: opts.runState?.runId || opts.runId || "",
				emitter: "apps.hatch.runtime",
				required: canonicalStoreRequired,
		  })
		: null;
	if (!runState) {
		const runId = opts.runId ?? generateRunId();
		if (opts.runId && loadRunState(runId)) {
			console.error(`Run "${runId}" already exists.`);
			process.exit(1);
			return;
		}
		runState = createRunState(runId, file, {
			runsDir: opts.factoryContext.runs_dir,
			factoryId: opts.factoryContext.factory_id,
		});
		if (canonicalLifecycleEmitter) {
			setLifecycleProjectionEmitter(runId, (events) => {
				canonicalLifecycleEmitter.emit(events);
			});
		}
		seedRunStateFactoryContext(runState, opts.factoryContext);
		saveRunState(runState, { updateMetadata: true });
		console.log(`Run: ${runId}`);
	}

	const engineContext = opts.context?.clone() ?? new Context();
	engineContext.set("__run_id", runState.runId);
	applyFactoryContextToEngineContext(engineContext, opts.factoryContext);
	if (!engineContext.get("factory_id") && factoryIdentityFromConfig.factory_id) {
		engineContext.set("factory_id", factoryIdentityFromConfig.factory_id);
	}
	if (!engineContext.get("factory") && factoryIdentityFromConfig.factory) {
		engineContext.set("factory", factoryIdentityFromConfig.factory);
	}
	if (!engineContext.get("repo") && factoryIdentityFromConfig.repo) {
		engineContext.set("repo", factoryIdentityFromConfig.repo);
	}

	const bus = setupEventBus({ live: opts.live, graph, runId: runState.runId });
	const telemetryMetadataProvider = factoryMetadataProviderFromIdentity(factoryIdentityFromConfig);
	setLifecycleProjectionEmitter(runState.runId, null);
	const reactorInstrumentation = createReactorInstrumentationHelpers({
		eventBus: bus,
		workflowId: file,
		resolveRunId: () => runState.runId,
		resolveFactoryId: () => String(engineContext.get("factory_id") || factoryIdentityFromConfig.factory_id || "").trim(),
		defaultOwner: "apps.hatch.reactor",
		langfuseContext: {
			runId: runState.runId,
			graphName: graph.name,
			pipelineFile: file,
			factoryMetadataProvider: telemetryMetadataProvider,
		},
	});
	const detachReactorTelemetry = reactorInstrumentation.bind();
	setLifecycleProjectionEmitter(runState.runId, (events) => {
		reactorInstrumentation.emitRunLifecycleEvents(events);
		canonicalLifecycleEmitter?.emit(events);
	});

	const config = await buildHandlerConfig(graph, {
		pipelineFile: file,
		factoryContext: opts.factoryContext,
	});
	config.pipelineFile = file;
	config.runState = runState;
	config.identityMode = identityMode;
	applyModelPolicyContext(engineContext, config.modelPolicy);

	config.eventBus = bus;

	const reg = new HandlerRegistry();
	registerAll(reg, config);
	if (opts.trace) {
		const tracePath = eventsPath(runState.runId);
		bus.on(createTraceHandler(tracePath));
		console.log(`Tracing to ${tracePath}`);
	}

	const engine = new Engine(graph, reg, {
		eventBus: bus,
		context: engineContext,
		pipelineFile: file,
		checkpoint: opts.checkpoint,
		resumeFrom: opts.resumeFrom,
		threadStore: new ThreadStore(),
		runState,
		telemetryFactoryMetadataProvider: telemetryMetadataProvider,
	});

	activeEngine = engine;

	let runError: unknown;
	try {
		await engine.run();
		detachReactorTelemetry();
		await canonicalLifecycleEmitter?.flush();
		await canonicalLifecycleEmitter?.close();
		await flushOtelRuntime();
		await shutdownOtelRuntime();
	} catch (err) {
		detachReactorTelemetry();
		const rs = engine.getRunState();
		if (rs && rs.status !== "suspended") {
			rs.status = "failed";
			saveRunState(rs, { updateMetadata: true });
		}
		await canonicalLifecycleEmitter?.flush();
		await canonicalLifecycleEmitter?.close();
		await flushOtelRuntime();
		await shutdownOtelRuntime();
		runError = err;
	} finally {
		try {
			persistLifecycleContextFromEngine(engine);
		} catch {
			// best-effort, never throw from lifecycle flush path
		}
		setLifecycleProjectionEmitter(runState.runId, null);
		activeEngine = null;
	}

	if (runError) {
		console.error(`run: ${runError instanceof Error ? runError.message : runError}`);
		throw runError;
	}
}

function resolveRuntimeEnvForHandlerConfig(factoryContext?: FactoryContext): NodeJS.ProcessEnv {
	const factoryConfigPath = String(factoryContext?.factory_config_path || "").trim();
	if (!factoryConfigPath) {
		return { ...process.env };
	}
	try {
		const rawConfig = JSON.parse(readFileSync(factoryConfigPath, "utf-8"));
		return resolveFactoryIsolationRuntimeEnv({
			env: process.env,
			isolationConfig: getFactoryIsolationConfig(rawConfig),
		});
	} catch {
		return { ...process.env };
	}
}

function setupGracefulShutdown(): void {
	let exiting = false;
	const handler = async (signal: string) => {
		if (exiting) return;
		exiting = true;
		console.log(`\nReceived ${signal}. Suspending pipeline...`);
		if (activeEngine) {
			activeEngine.suspend();
			const rs = activeEngine.getRunState();
			if (rs) {
				console.log(`Run ${rs.runId} suspended. Resume with: hatch recover ${rs.runId}`);
			}
		}
		try {
			await flushOtelRuntime();
			await shutdownOtelRuntime();
			persistLifecycleContextFromEngine(activeEngine);
		} catch {
			// best-effort non-blocking shutdown path
		}
		process.exit(0);
	};

	process.on("SIGINT", handler.bind(null, "SIGINT"));
	process.on("SIGTERM", handler.bind(null, "SIGTERM"));
}

setupGracefulShutdown();

/** Exit only after stdout/stderr drain so piped data is never lost. */
function exitAfterFlush(code: number): void {
	const flush = (stream: NodeJS.WriteStream, cb: () => void) => {
		if (!stream.writableNeedDrain) return cb();
		stream.once("drain", cb);
	};
	flush(process.stdout, () => flush(process.stderr, () => process.exit(code)));
}

main().then(() => {
	exitAfterFlush(0);
}).catch((err) => {
	console.error(err);
	exitAfterFlush(1);
});
