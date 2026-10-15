import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve, dirname } from "node:path";

import { parseFactoryContextOverrideArgs } from "./cli/factory-context-overrides.js";
import {
	logFactoryContextStartup,
	resolveFactoryContextOrExit,
	seedRunStateFactoryContext,
} from "./cli/factory-context-runtime.js";
import { cmdGraph as runGraphCommand } from "./cli/graph-command.js";
import { parseValidateCommandArgs } from "./cli/validate-args.js";
import { runComplexityEstimateCommand } from "./complexity/cli.js";
import { runDispatchLoop } from "./dispatch/loop.js";
import { loadFactoryRegistry, FactoryRegistryLoadError } from "./dispatch/registry.js";
import { runFactoryInit } from "./factory/init.js";
import { runFactoryConformanceCommand } from "./factory/conformance-cli.js";
import { findRepoRoot } from "./intent/loader.js";
import { loadCheckpoint, defaultCheckpointPath } from "./pipeline/checkpoint.js";
import { Context } from "./pipeline/context.js";
import { HandlerRegistry } from "./pipeline/engine.js";
import { resolveGraphPath } from "./pipeline/graph-source.js";
import { registerAll } from "./pipeline/handler/register.js";
import { acquireLock } from "./pipeline/lock.js";
import {
	loadRunState,
	findRecoverableRun,
	isStaleRun,
	isPidAlive,
	eventsPath,
	configureRunStorageScope,
	saveRunState,
	type RunState,
} from "./pipeline/run.js";
import { formatTrace, defaultTracePath } from "./pipeline/trace.js";
import { validate, formatValidationError, hasValidationErrors } from "./pipeline/validate.js";
import { WatchLoop, parseTriggerArgs } from "./pipeline/watch.js";
import { cmdRuns as cmdRunsCommand } from "./runs.js";

import type { FactoryContext } from "./factory/context-resolver.js";
import type { Graph } from "./pipeline/graph.js";
import type { IdentityMode } from "./pipeline/identity.js";

interface WorkspaceBootstrapResult {
	ok: boolean;
	reason: string;
	install_code: string;
	build_code: string;
}

const require = createRequire(import.meta.url);
const { repairWorkspaceBootstrap } = require("../../../packages/factory-core/src/workspace-package-manager.ts") as {
	repairWorkspaceBootstrap: (options?: {
		repoRoot?: string;
		workspaceDir?: string;
		packageManager?: string;
	}) => WorkspaceBootstrapResult;
};

export interface RunPipelineOpts {
	trace?: boolean;
	checkpoint?: boolean;
	live?: boolean;
	context?: Context;
	resumeFrom?: import("./pipeline/checkpoint.js").Checkpoint;
	runState?: RunState;
	runId?: string;
	identityMode?: IdentityMode;
	factoryContext: FactoryContext;
}

export interface CliCommandDeps {
	runPipeline: (file: string, opts: RunPipelineOpts) => Promise<void>;
	parseGraph: (file: string) => Graph;
	loadIntentRegistryForFile: (file: string) => any;
	buildHandlerConfig: (graph?: Graph, opts?: { pipelineFile?: string; toolEnv?: Record<string, string> }) => Promise<any>;
}

function ensureWorkspaceReadyOrExit(file: string): void {
	const repoRoot = findRepoRoot(dirname(file));
	const bootstrap = repairWorkspaceBootstrap({
		repoRoot,
		workspaceDir: repoRoot,
	});
	if (bootstrap?.ok) {
		return;
	}
	console.error(
		`[hatch] workspace bootstrap failed repo=${repoRoot} reason=${bootstrap?.reason || "workspace_bootstrap_failed"} install_code=${bootstrap?.install_code || ""} build_code=${bootstrap?.build_code || ""}`,
	);
	process.exit(1);
}

export async function cmdRun(args: string[], deps: CliCommandDeps): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	const factoryContextFlags = parsedFactoryContext.flags;
	let trace = false;
	let checkpoint = false;
	let live = false;
	let lockName = "";
	let singleton = false;
	let contextFile = "";
	let runId = "";
	const fileArgs: string[] = [];

	for (let i = 0; i < parsedFactoryContext.args.length; i++) {
		const arg = parsedFactoryContext.args[i];
		if (arg === "--trace") trace = true;
		else if (arg === "--checkpoint") checkpoint = true;
		else if (arg === "--live") live = true;
		else if (arg === "--singleton") singleton = true;
		else if (arg === "--lock" && i + 1 < parsedFactoryContext.args.length) lockName = parsedFactoryContext.args[++i];
		else if (arg === "--context" && i + 1 < parsedFactoryContext.args.length) contextFile = parsedFactoryContext.args[++i];
		else if (arg === "--run-id" && i + 1 < parsedFactoryContext.args.length) runId = parsedFactoryContext.args[++i];
		else fileArgs.push(arg);
	}

	if (fileArgs.length < 1) {
		console.error("usage: hatch run [--trace] [--checkpoint] [--live] [--lock <name>] [--singleton] [--context <file.json|inline-json>] [--run-id <id>] [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--runs-dir <path>] [--scenarios-root <path>] [--factory-mode <standalone|managed>] <file.dot>");
		process.exit(1);
	}

	const file = resolve(fileArgs[0]);
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		cwd: dirname(file),
		factoryRoot: factoryContextFlags.factoryRoot,
		factoryConfigPath: factoryContextFlags.factoryConfigPath,
		factoryId: factoryContextFlags.factoryId,
		targetRepo: factoryContextFlags.targetRepo,
		controlPlaneRepo: factoryContextFlags.controlPlaneRepo,
		runsDir: factoryContextFlags.runsDir,
		scenariosRoot: factoryContextFlags.scenariosRoot,
		factoryMode: factoryContextFlags.factoryMode,
	});
	logFactoryContextStartup("run", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
		pipelineFile: file,
	});
	ensureWorkspaceReadyOrExit(file);

	const effectiveLock = singleton ? basename(file).replace(/\.dot$/, "") : lockName;
	let releaseLock: (() => void) | undefined;

	if (effectiveLock) {
		const release = acquireLock(effectiveLock, singleton ? 0 : 30000);
		if (!release) {
			if (singleton) {
				console.log(`Pipeline already running (lock: ${effectiveLock})`);
				return;
			}
			console.error(`Could not acquire lock "${effectiveLock}" within timeout`);
			process.exit(1);
		}
		releaseLock = release;
	}

	let context: Context | undefined;
	if (contextFile) {
		let raw: unknown;
		const trimmed = contextFile.trim();
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			try {
				raw = JSON.parse(trimmed);
			} catch (err) {
				console.error(`Context JSON could not be parsed: ${err instanceof Error ? err.message : err}`);
				process.exit(1);
			}
		} else {
			const ctxPath = resolve(contextFile);
			if (!existsSync(ctxPath)) {
				console.error(`Context file not found: ${contextFile}`);
				process.exit(1);
			}
			raw = JSON.parse(readFileSync(ctxPath, "utf-8"));
		}

		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			console.error("Context must be a JSON object (not array or primitive)");
			process.exit(1);
		}
		const flat: Record<string, string> = {};
		for (const [k, v] of Object.entries(raw)) {
			flat[k] = typeof v === "string" ? v : JSON.stringify(v);
		}
		context = new Context(flat);
	}

	try {
		await deps.runPipeline(file, {
			trace,
			checkpoint,
			context,
			live,
			runId: runId || undefined,
			factoryContext: resolvedFactoryContext,
		});
	} finally {
		releaseLock?.();
	}
}

function trim(value: string): string {
	return String(value || "").trim();
}

export async function cmdResume(args: string[], deps: CliCommandDeps): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	let trace = false;
	let live = false;
	const fileArgs: string[] = [];

	for (const arg of parsedFactoryContext.args) {
		if (arg === "--trace") trace = true;
		else if (arg === "--live") live = true;
		else fileArgs.push(arg);
	}

	if (fileArgs.length < 1) {
		console.error("usage: hatch resume [--trace] [--live] [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--runs-dir <path>] [--scenarios-root <path>] [--factory-mode <standalone|managed>] <file.dot>");
		process.exit(1);
	}

	const file = resolve(fileArgs[0]);
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		cwd: dirname(file),
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("resume", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
		pipelineFile: file,
	});
	ensureWorkspaceReadyOrExit(file);

	const cpPath = defaultCheckpointPath(file);

	if (!existsSync(cpPath)) {
		console.error(`No checkpoint found at ${cpPath}`);
		console.error("Run with --checkpoint first: hatch run --checkpoint <file.dot>");
		process.exit(1);
	}

	const cp = loadCheckpoint(cpPath);
	console.log(`Resuming from checkpoint: node=${cp.currentNodeId}`);

	await deps.runPipeline(file, {
		trace,
		checkpoint: true,
		resumeFrom: cp,
		live,
		factoryContext: resolvedFactoryContext,
	});
}

export async function cmdRecover(args: string[], deps: CliCommandDeps): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	const fileArgs = parsedFactoryContext.args;
	let runId = fileArgs[0] || "";
	let state: RunState | null;

	const resolvedFactoryContext = resolveFactoryContextOrExit({
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("recover", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
	});

	if (runId) {
		state = loadRunState(runId);
		if (!state) {
			console.error(`Run "${runId}" not found.`);
			process.exit(1);
			return;
		}
	} else {
		state = findRecoverableRun();
		if (!state) {
			console.error("No recoverable runs found.");
			console.error("Use 'hatch runs' to see all runs.");
			process.exit(1);
			return;
		}
		runId = state.runId;
	}

	if (state.status === "running" && isPidAlive(state.pid)) {
		console.error(`Run ${runId} is still active (PID ${state.pid}). Not recovering.`);
		process.exit(1);
		return;
	}

	if (!existsSync(state.pipelineFile)) {
		console.error(`Pipeline file no longer exists: ${state.pipelineFile}`);
		process.exit(1);
		return;
	}

	console.log(`Recovering run ${runId}`);
	console.log(`  Pipeline: ${state.pipelineFile}`);
	console.log(`  Status: ${state.status}${isStaleRun(state) ? " (stale)" : ""}`);
	console.log(`  Completed: ${state.completedNodes.length} nodes`);
	console.log(`  Last node: ${state.currentNode}`);

	const cp = {
		pipelineFile: state.pipelineFile,
		currentNodeId: state.currentNode,
		lastOutput: state.lastOutput,
		context: state.context,
		records: state.records,
		savedAt: state.updatedAt,
	};

	state.status = "running";
	state.pid = process.pid;
	seedRunStateFactoryContext(state, resolvedFactoryContext);
	saveRunState(state, { updateMetadata: true });

	console.log(`  Resuming from node: ${state.currentNode}`);

	await deps.runPipeline(state.pipelineFile, {
		trace: true,
		resumeFrom: cp,
		runState: state,
		factoryContext: resolvedFactoryContext,
	});
}

export async function cmdValidate(args: string[], deps: CliCommandDeps): Promise<void> {
	const parsed = parseValidateCommandArgs(args);
	if (!parsed.ok) {
		console.error(parsed.error.message);
		console.error(parsed.error.usage);
		process.exit(parsed.error.exitCode);
	}

	const file = resolve(parsed.value.file);
	let graph: Graph;
	try {
		graph = deps.parseGraph(file);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
		return;
	}
	const intentRegistry = deps.loadIntentRegistryForFile(file);
	const errs = validate(graph, { intentRegistry, identityMode: parsed.value.identityMode });

	if (errs.length === 0) {
		console.log("Valid.");
		return;
	}

	for (const e of errs) console.error(`  ${formatValidationError(e)}`);
	if (hasValidationErrors(errs)) {
		process.exit(1);
	}
	console.log("Valid (with warnings).");
}

export async function cmdResolve(args: string[]): Promise<void> {
	if (args.length < 1 || !args[0].startsWith("@")) {
		console.error("usage: hatch resolve @scope/package/path");
		console.error("");
		console.error("Resolves an @-prefixed package path to an absolute filesystem path.");
		console.error("Uses Node.js require.resolve() with package.json subpath exports.");
		process.exit(1);
	}

	const resolved = resolveGraphPath(args[0], process.cwd());
	process.stdout.write(resolved + "\n");
}

const newPipelineTemplate = `// {{NAME}} pipeline
// Run:      hatch run {{FILENAME}}
// Validate: hatch validate {{FILENAME}}
// Docs:     hatch help nodes    (node types)
//           hatch help edges    (conditions & routing)
//           hatch help examples (full examples)
digraph {{NAME}} {
    label = "{{NAME}}"

    // ── Entry & Exit ────────────────────────────────────────
    // Every pipeline needs exactly one start and one exit node.
    start [shape=Mdiamond]
    done  [shape=Msquare]

    // ── Nodes ───────────────────────────────────────────────
    //
    // LLM node (sends a prompt to an LLM, returns the response):
    //   analyze [label="Analyze" prompt="Your instruction here"]
    //
    // Tool node (runs a shell command):
    //   fetch [type="tool" label="Fetch" prompt="curl -s https://..."]
    //
    // Conditional (branches on context, needs >=2 outgoing edges):
    //   check [shape=diamond label="OK?"]
    //   check -> done  [condition="outcome=success"]
    //   check -> retry [condition="outcome!=success"]
    //
    // Human gate (pauses for approval):
    //   review [shape=hexagon label="Approve?"]

    task [label="TODO: describe this step"
          prompt="TODO: write your prompt here"]

    // ── Edges ───────────────────────────────────────────────
    // Data flows automatically: each node's output becomes
    // the next node's input.

    start -> task -> done
}
`;

export async function cmdNew(args: string[]): Promise<void> {
	if (args.length < 1) {
		console.error("usage: hatch new <name>");
		console.error("");
		console.error("Creates a new pipeline .dot file with scaffolding.");
		process.exit(1);
	}

	let name = args[0];
	name = name.replace(/\.dot$/, "");
	const filename = name + ".dot";

	if (existsSync(filename)) {
		console.error(`${filename} already exists. Remove it first or pick a different name.`);
		process.exit(1);
	}

	const graphName = basename(name).replace(/-/g, "_");
	const content = newPipelineTemplate.replace(/\{\{NAME\}\}/g, graphName).replace(/\{\{FILENAME\}\}/g, filename);

	writeFileSync(filename, content);
	console.log(`Created ${filename}`);
	console.log("");
	console.log(`  hatch validate ${filename}   Check it's valid`);
	console.log(`  hatch run ${filename}        Run it`);
	console.log("");
	console.log("  hatch help nodes      Learn about node types");
	console.log("  hatch help examples   See annotated examples");
}

export async function cmdTrace(args: string[]): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	if (parsedFactoryContext.args.length < 1) {
		console.error("usage: hatch trace [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--runs-dir <path>] [--scenarios-root <path>] [--factory-mode <standalone|managed>] <file.dot|run-id>");
		console.error("");
		console.error("Shows the execution trace from the last run.");
		process.exit(1);
	}

	const target = parsedFactoryContext.args[0];
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("trace", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
	});

	const runState = loadRunState(target);
	if (runState) {
		const tracePath = eventsPath(runState.runId);
		if (existsSync(tracePath)) {
			console.log(formatTrace(tracePath));
			return;
		}
		console.error(`No trace found for run ${target}.`);
		process.exit(1);
		return;
	}

	const file = resolve(target);
	const tracePath = defaultTracePath(file);

	if (!existsSync(tracePath)) {
		console.error(`No trace found. Run with --trace first:`);
		console.error(`  hatch run --trace ${target}`);
		process.exit(1);
	}

	console.log(formatTrace(tracePath));
}

export async function cmdGraph(args: string[], deps: CliCommandDeps): Promise<void> {
	runGraphCommand(args, (file) => deps.parseGraph(resolve(file)));
}

interface DispatchArgs {
	intervalMs: number;
	once: boolean;
	registryPath?: string;
	queuePath?: string;
	maxPerTick: number;
}

function parseDispatchArgs(args: string[]): DispatchArgs {
	const envInterval = process.env["HATCH_DISPATCH_INTERVAL_MS"];
	let intervalMs = envInterval ? Number(envInterval) : 30000;
	if (!Number.isFinite(intervalMs) || intervalMs < 0) {
		console.error("dispatch: HATCH_DISPATCH_INTERVAL_MS must be a non-negative number");
		process.exit(1);
	}

	const envMax = process.env["HATCH_DISPATCH_MAX_PER_TICK"];
	let maxPerTick = envMax ? Number(envMax) : 1;
	if (!Number.isFinite(maxPerTick) || maxPerTick < 0) {
		console.error("dispatch: HATCH_DISPATCH_MAX_PER_TICK must be a non-negative number");
		process.exit(1);
	}

	let once = false;
	let registryPath: string | undefined;
	let queuePath: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--interval" && i + 1 < args.length) {
			intervalMs = Number(args[++i]);
			if (!Number.isFinite(intervalMs) || intervalMs < 0) {
				console.error("dispatch: --interval must be a non-negative number (milliseconds)");
				process.exit(1);
			}
		} else if ((arg === "--max" || arg === "--max-per-tick") && i + 1 < args.length) {
			maxPerTick = Number(args[++i]);
			if (!Number.isFinite(maxPerTick) || maxPerTick < 0) {
				console.error("dispatch: --max-per-tick must be a non-negative number");
				process.exit(1);
			}
		} else if (arg === "--queue" && i + 1 < args.length) {
			queuePath = args[++i];
		} else if (arg === "--once") {
			once = true;
		} else if (arg === "--registry" && i + 1 < args.length) {
			registryPath = args[++i];
		} else {
			console.error(`unknown dispatch option: ${arg}`);
			process.exit(1);
		}
	}

	return { intervalMs, once, registryPath, queuePath, maxPerTick };
}

export async function cmdDispatch(args: string[]): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("dispatch", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
	});

	const { intervalMs, once, registryPath, queuePath, maxPerTick } = parseDispatchArgs(parsedFactoryContext.args);
	const rootDir = findRepoRoot(process.cwd());
	const registryOptions = { rootDir, registryPath };

	const registryCandidate = resolve(rootDir, registryPath ?? "factory-registry.json");
	if (existsSync(registryCandidate)) {
		try {
			loadFactoryRegistry(registryOptions);
		} catch (err) {
			const message = err instanceof FactoryRegistryLoadError ? err.message : String(err);
			console.error(`Factory registry error:\n${message}`);
			process.exit(2);
		}
	}

	const controller = new AbortController();
	const shutdown = (signal: string) => {
		console.log(`\nStopping dispatch (${signal})...`);
		controller.abort();
	};
	process.on("SIGINT", shutdown.bind(null, "SIGINT"));
	process.on("SIGTERM", shutdown.bind(null, "SIGTERM"));

	try {
		await runDispatchLoop({
			rootDir,
			registryPath,
			queuePath,
			intervalMs,
			maxPerTick,
			runOnce: once,
			signal: controller.signal,
		});
	} catch (err) {
		if (err instanceof FactoryRegistryLoadError) {
			console.error(`Factory registry error:\n${err.message}`);
			process.exit(2);
		}
		throw err;
	}
}

export async function cmdFactory(args: string[]): Promise<void> {
	const subcommand = args[0] || "";
	if (subcommand === "init") {
		await runFactoryInit(args.slice(1));
		return;
	}
	if (subcommand === "conformance") {
		const exitCode = await runFactoryConformanceCommand(args.slice(1));
		if (exitCode !== 0) process.exit(exitCode);
		return;
	}
	console.error("usage: hatch factory <init|conformance> [options]");
	process.exit(1);
}

export async function cmdRuns(args: string[]): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args);
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("runs", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
	});

	await cmdRunsCommand(parsedFactoryContext.args);
}

export async function cmdComplexity(args: string[]): Promise<void> {
	const result = runComplexityEstimateCommand(args);
	if (!result.ok) {
		console.error(result.error.message);
		console.error(result.error.usage);
		process.exit(result.error.exitCode);
	}
	process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
}

export async function cmdWatch(args: string[], deps: CliCommandDeps): Promise<void> {
	const parsedFactoryContext = parseFactoryContextOverrideArgs(args, { repoAlias: true });
	const { file, trigger } = parseTriggerArgs(parsedFactoryContext.args);

	if (!file) {
		console.error("usage: hatch watch [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--runs-dir <path>] [--scenarios-root <path>] [--factory-mode <standalone|managed>] <file.dot> [--watch <path>] [--interval <sec>] [--run-on-start]");
		console.error("");
		console.error("Options:");
		console.error("  --watch <path>     Watch a file for changes (can repeat)");
		console.error("  --interval <sec>   Re-run every N seconds");
		console.error("  --run-on-start     Run once immediately before watching");
		process.exit(1);
	}

	if (!trigger.files && !trigger.intervalSec) {
		console.error("Must specify at least one trigger: --watch <path> or --interval <sec>");
		process.exit(1);
	}

	const resolvedFile = resolve(file);
	const resolvedFactoryContext = resolveFactoryContextOrExit({
		cwd: dirname(resolvedFile),
		factoryRoot: parsedFactoryContext.flags.factoryRoot,
		factoryConfigPath: parsedFactoryContext.flags.factoryConfigPath,
		factoryId: parsedFactoryContext.flags.factoryId,
		targetRepo: parsedFactoryContext.flags.targetRepo,
		controlPlaneRepo: parsedFactoryContext.flags.controlPlaneRepo,
		runsDir: parsedFactoryContext.flags.runsDir,
		scenariosRoot: parsedFactoryContext.flags.scenariosRoot,
		factoryMode: parsedFactoryContext.flags.factoryMode,
	});
	logFactoryContextStartup("watch", resolvedFactoryContext);
	configureRunStorageScope({
		runsDir: resolvedFactoryContext.runs_dir,
		factoryId: resolvedFactoryContext.factory_id,
		pipelineFile: resolvedFile,
	});

	console.log(`Watching pipeline: ${file}`);
	if (trigger.files) console.log(`  files: ${trigger.files.join(", ")}`);
	if (trigger.intervalSec) console.log(`  interval: ${trigger.intervalSec}s`);

	const loop = new WatchLoop(trigger, async () => {
		console.log(`\n--- ${new Date().toISOString()} ---`);
		await deps.runPipeline(resolvedFile, { factoryContext: resolvedFactoryContext });
	});

	process.on("SIGINT", () => {
		console.log("\nStopping watch...");
		loop.stop();
		process.exit(0);
	});

	await loop.start();
}

export async function cmdServe(args: string[], deps: CliCommandDeps): Promise<void> {
	const addr = args[0] || ":8080";
	const { createServer } = await import("./server/server.js");
	const config = await deps.buildHandlerConfig();
	const reg = new HandlerRegistry();
	registerAll(reg, config);
	createServer(reg, addr, config);
}
