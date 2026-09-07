import { describe, expect, it, vi } from "vitest";

const processOnMock = vi.fn();
const processExitMock = vi.fn();
const parseWithAstMock = vi.fn();
const validateMock = vi.fn(() => []);
const hasValidationErrorsMock = vi.fn(() => false);
const formatValidationErrorMock = vi.fn();
const graphIdentityModeMock = vi.fn(() => "legacy");
const loadIntentRegistryMock = vi.fn(() => undefined);
const findRepoRootMock = vi.fn(() => process.cwd());
const applyGraphStylesheetImportsMock = vi.fn();
const printHelpTopicMock = vi.fn();
const parseValidateCommandArgsMock = vi.fn();
const runComplexityEstimateCommandMock = vi.fn(() => ({ ok: true, payload: { ok: true } }));
const loadCheckpointMock = vi.fn();
const acquireLockMock = vi.fn();
const watchLoopStartMock = vi.fn();
const watchLoopStopMock = vi.fn();
const createLiveStatusHandlerMock = vi.fn(() => vi.fn());
const generateRunIdMock = vi.fn(() => "run-1");
const createRunStateMock = vi.fn(() => ({ runId: "run-1", status: "running", context: {} }));
const saveRunStateMock = vi.fn();
const loadRunStateMock = vi.fn();
const findRecoverableRunMock = vi.fn();
const isStaleRunMock = vi.fn(() => false);
const isPidAliveMock = vi.fn(() => false);
const eventsPathMock = vi.fn(() => "/tmp/events.jsonl");
const configureRunStorageScopeMock = vi.fn(() => ".hatch/runs");
const cmdRunsMock = vi.fn(async () => undefined);
const resolveFactoryContextMock = vi.fn(() => ({
	factory_root: process.cwd(),
	factory_config_path: `${process.cwd()}/factory.config.json`,
	factory_id: "mothership",
	target_repo: "recallnet/astrochicken",
	control_plane_repo: "recallnet/astrochicken",
	runs_dir: `${process.cwd()}/.hatch/mothership/runs`,
	scenarios_root: `${process.cwd()}/factories/mothership/scenarios`,
	factory_mode: "standalone",
	factory_mode_source: [{ source: "mode.default", mode: "standalone", precedence: "low", detail: "no explicit mode sources resolved" }],
}));

class HandlerRegistryStub {
	register = vi.fn();
	get = vi.fn();
}

class EngineStub {
	suspend = vi.fn();
	getRunState = vi.fn(() => ({ runId: "run-1", status: "suspended" }));
	constructor(..._args: any[]) {}
	async run() {
		return;
	}
}

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<any>("node:fs");
	return {
		...actual,
		readFileSync: vi.fn(() => "digraph x { start [shape=Mdiamond] done [shape=Msquare] start -> done }"),
		writeFileSync: vi.fn(),
		existsSync: vi.fn(() => true),
	};
});

vi.mock("./pipeline/parse.js", () => ({ parseWithAst: parseWithAstMock }));
vi.mock("./pipeline/validate.js", () => ({
	validate: validateMock,
	formatValidationError: formatValidationErrorMock,
	hasValidationErrors: hasValidationErrorsMock,
}));
vi.mock("./pipeline/graph.js", () => ({
	graphWorkDir: vi.fn(() => "."),
	graphIdentityMode: graphIdentityModeMock,
}));
vi.mock("./intent/loader.js", () => ({
	findRepoRoot: findRepoRootMock,
	loadIntentRegistry: loadIntentRegistryMock,
	IntentLoadError: class IntentLoadError extends Error {},
}));
vi.mock("./dispatch/registry.js", () => ({
	loadFactoryRegistry: vi.fn(),
	FactoryRegistryLoadError: class FactoryRegistryLoadError extends Error {},
}));
vi.mock("./dispatch/loop.js", () => ({ runDispatchLoop: vi.fn() }));
vi.mock("./pipeline/stylesheet-imports.js", () => ({ applyGraphStylesheetImports: applyGraphStylesheetImportsMock }));
vi.mock("./pipeline/engine.js", () => ({ Engine: EngineStub, HandlerRegistry: HandlerRegistryStub }));
vi.mock("./pipeline/context.js", () => ({ Context: class Context { constructor(initial:any={}){ this.values={...initial}; } values:any; set(k:string,v:string){ this.values[k]=v; } get(k:string){ return this.values[k] ?? ""; } has(k:string){ return Object.prototype.hasOwnProperty.call(this.values, k); } clone(){ return new (this.constructor as any)(this.values); } all(){ return { ...this.values }; } } }));
vi.mock("./pipeline/handler/register.js", () => ({ registerAll: vi.fn() }));
vi.mock("./pipeline/handler/human.js", () => ({ ConsoleInterviewer: class ConsoleInterviewer {} }));
vi.mock("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: { create: vi.fn(() => ({ setRuntimeApiKey: vi.fn() })) },
	ModelRegistry: vi.fn(() => ({ find: vi.fn() })),
	DefaultResourceLoader: vi.fn(() => ({ reload: vi.fn(async () => {}) })),
}));
vi.mock("./help.js", () => ({ printHelpTopic: printHelpTopicMock }));
vi.mock("./cli/validate-args.js", () => ({ parseValidateCommandArgs: parseValidateCommandArgsMock }));
vi.mock("./complexity/cli.js", () => ({ runComplexityEstimateCommand: runComplexityEstimateCommandMock }));
vi.mock("./pipeline/trace.js", () => ({ createTraceHandler: vi.fn(() => vi.fn()), defaultTracePath: vi.fn(), formatTrace: vi.fn() }));
vi.mock("./pipeline/checkpoint.js", () => ({ loadCheckpoint: loadCheckpointMock, defaultCheckpointPath: vi.fn(() => "/tmp/checkpoint") }));
vi.mock("./pipeline/lock.js", () => ({ acquireLock: acquireLockMock }));
vi.mock("./pipeline/watch.js", () => ({ WatchLoop: class WatchLoop { start = watchLoopStartMock; stop = watchLoopStopMock; }, parseTriggerArgs: vi.fn(() => ({ file: "", trigger: {} })) }));
vi.mock("./pipeline/threads.js", () => ({ ThreadStore: class ThreadStore {} }));
vi.mock("./pipeline/live.js", () => ({ createLiveStatusHandler: createLiveStatusHandlerMock }));
vi.mock("./pipeline/run.js", () => ({
	generateRunId: generateRunIdMock,
	createRunState: createRunStateMock,
	saveRunState: saveRunStateMock,
	loadRunState: loadRunStateMock,
	findRecoverableRun: findRecoverableRunMock,
	isStaleRun: isStaleRunMock,
	isPidAlive: isPidAliveMock,
	eventsPath: eventsPathMock,
	configureRunStorageScope: configureRunStorageScopeMock,
	setLifecycleProjectionEmitter: vi.fn(),
}));
vi.mock("./runs.js", () => ({ cmdRuns: cmdRunsMock }));
vi.mock("./pipeline/lifecycle-persistence.js", () => ({ persistLifecycleContextFromEngine: vi.fn() }));
vi.mock("./cli/run-config.js", () => ({ readFactoryTelemetryIdentityForRun: vi.fn(() => ({ factory_id: "", factory: "", repo: "" })) }));
vi.mock("./factory/context-resolver.js", () => ({ resolveFactoryContext: resolveFactoryContextMock }));
vi.mock("./factory/model-policy.js", () => ({ resolveEffectiveModelPolicyForPipeline: vi.fn(() => undefined) }));
vi.mock("./cli/graph-command.js", () => ({ cmdGraph: vi.fn() }));
vi.mock("@recallnet/factory-telemetry", async (importOriginal) => {
	const actual = await importOriginal<any>();
	return {
		...actual,
		EventBus: class EventBus { on = vi.fn(() => () => {}); emit = vi.fn(); },
		bindLangfuseLifecycleTelemetry: vi.fn(() => ({ flushNow: vi.fn(async () => {}), waitForIdle: vi.fn(async () => {}) })),
		createLangfuseTelemetry: vi.fn(() => ({ eventHandler: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) })),
		createRedisTelemetrySink: vi.fn(async () => ({
			enabled: false,
			reason: "no_config",
			streamKey: "hatch:telemetry:unknown:unknown:events",
			sink: { emit: vi.fn(), flush: vi.fn(async () => {}), close: vi.fn(async () => {}) },
		})),
		resolveRedisTelemetryConfig: vi.fn(() => null),
		factoryMetadataProviderFromIdentity: vi.fn(() => () => ({})),
	};
});

vi.stubGlobal("process", {
	...process,
	argv: ["node", "cli", "runs", "recovery-sweep", "--repo", "/tmp/repo", "--json"],
	on: processOnMock,
	once: processOnMock,
	removeListener: vi.fn(),
	exit: processExitMock,
});

describe("cli runs factory-context override routing", () => {
	it("preserves --repo argument for runs recovery-sweep while still resolving factory context", async () => {
		parseWithAstMock.mockReturnValue({
			graph: { name: "sample", attrs: {}, nodes: {}, edges: [] },
			nodes: [],
			stylesheetImports: [],
		});

		const imported = await import("./cli.js");
		expect(imported).toBeTruthy();
		expect(resolveFactoryContextMock).toHaveBeenCalled();
		expect(configureRunStorageScopeMock).toHaveBeenCalled();
		expect(cmdRunsMock).toHaveBeenCalledWith(["recovery-sweep", "--repo", "/tmp/repo", "--json"]);
	});

});
