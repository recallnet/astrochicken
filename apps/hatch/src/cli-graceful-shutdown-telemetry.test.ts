import { describe, expect, it, vi } from "vitest";

const processOnMock = vi.fn();
const processExitMock = vi.fn();
const loadCheckpointMock = vi.fn();
const parseWithAstMock = vi.fn();
const validateMock = vi.fn(() => []);
const hasValidationErrorsMock = vi.fn(() => false);
const formatValidationErrorMock = vi.fn();
const graphIdentityModeMock = vi.fn(() => "legacy");
const loadIntentRegistryMock = vi.fn(() => undefined);
const findRepoRootMock = vi.fn(() => process.cwd());
const loadFactoryRegistryMock = vi.fn();
const runDispatchLoopMock = vi.fn();
const applyGraphStylesheetImportsMock = vi.fn();
const printHelpTopicMock = vi.fn();
const parseValidateCommandArgsMock = vi.fn();
const parseComplexityEstimateArgsMock = vi.fn();
const loadComplexityInputMock = vi.fn();
const estimateComplexityMock = vi.fn();
const createTraceHandlerMock = vi.fn(() => vi.fn());
const defaultTracePathMock = vi.fn();
const formatTraceMock = vi.fn();
const acquireLockMock = vi.fn();
const watchLoopStartMock = vi.fn();
const watchLoopStopMock = vi.fn();
const createLiveStatusHandlerMock = vi.fn(() => vi.fn());
const generateRunIdMock = vi.fn(() => "run-1");
const createRunStateMock = vi.fn(() => ({ runId: "run-1", status: "running" }));
const saveRunStateMock = vi.fn();
const loadRunStateMock = vi.fn();
const findRecoverableRunMock = vi.fn();
const isStaleRunMock = vi.fn(() => false);
const isPidAliveMock = vi.fn(() => false);
const eventsPathMock = vi.fn(() => "/tmp/events.jsonl");
const cmdRunsMock = vi.fn();
const persistLifecycleContextFromEngineMock = vi.fn();
const flushOtelRuntimeMock = vi.fn(async () => {});
const shutdownOtelRuntimeMock = vi.fn(async () => {});
const registerAllMock = vi.fn();
const buildHandlerConfigModelRegistryMock = { find: vi.fn() };
const authStorageCreateMock = vi.fn(() => ({ kind: "auth", setRuntimeApiKey: vi.fn() }));
const modelRegistryCtorMock = vi.fn(() => buildHandlerConfigModelRegistryMock);
const defaultResourceLoaderReloadMock = vi.fn(async () => {});
const defaultResourceLoaderCtorMock = vi.fn(() => ({ reload: defaultResourceLoaderReloadMock }));

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
	graphModelStylesheet: vi.fn(() => ""),
	nodeHandlerType: vi.fn(() => "start"),
	outgoingEdges: vi.fn(() => []),
	edgeCondition: vi.fn(() => ""),
	edgeLabel: vi.fn(() => ""),
	graphWorkDir: vi.fn(() => "."),
	graphIdentityMode: graphIdentityModeMock,
}));
vi.mock("./intent/loader.js", () => ({
	findRepoRoot: findRepoRootMock,
	loadIntentRegistry: loadIntentRegistryMock,
	IntentLoadError: class IntentLoadError extends Error {},
}));
vi.mock("./dispatch/registry.js", () => ({
	loadFactoryRegistry: loadFactoryRegistryMock,
	FactoryRegistryLoadError: class FactoryRegistryLoadError extends Error {},
}));
vi.mock("./dispatch/loop.js", () => ({ runDispatchLoop: runDispatchLoopMock }));
vi.mock("./cli-commands.js", async () => {
	const actual = await vi.importActual<any>("./cli-commands.js").catch(() => ({}));
	return {
		...actual,
		cmdRun: vi.fn(async (_args: string[], deps: any) => {
			const factoryContext = {
				factory_root: process.cwd(),
				factory_config_path: `${process.cwd()}/factory.config.json`,
				factory_id: "",
				target_repo: "",
				control_plane_repo: "",
				kind_id: "",
				instance_id: "",
				destinations_json: "",
				runs_dir: `${process.cwd()}/.hatch/runs`,
				scenarios_root: `${process.cwd()}/scenarios`,
				factory_mode: "standalone",
				factory_mode_source: [{ source: "mode.default", mode: "standalone", precedence: "low", detail: "no explicit mode sources resolved" }],
			};
			await deps.runPipeline("sample.dot", {
				factoryContext,
				live: false,
				trace: false,
			});
		}),
	};
});
vi.mock("./cli/run-config.js", () => ({
	readFactoryTelemetryIdentityForRun: vi.fn(() => ({
		factory: "",
		factory_id: "",
		repo: "",
		validation: { status: "missing", configPath: "", issuePath: "", message: "", warning: "" },
	})),
}));
vi.mock("./pipeline/stylesheet-imports.js", () => ({ applyGraphStylesheetImports: applyGraphStylesheetImportsMock }));
vi.mock("./pipeline/engine.js", () => ({ Engine: EngineStub, HandlerRegistry: HandlerRegistryStub }));
vi.mock("./pipeline/context.js", () => ({ Context: class Context { constructor(initial:any={}){ this.values={...initial}; } values:any; set(k:string,v:string){ this.values[k]=v; } get(k:string){ return this.values[k] ?? ""; } clone(){ return new (this.constructor as any)(this.values); } all(){ return { ...this.values }; } } }));
vi.mock("./pipeline/handler/register.js", () => ({ registerAll: registerAllMock }));
vi.mock("./pipeline/handler/human.js", () => ({ ConsoleInterviewer: class ConsoleInterviewer {} }));
vi.mock("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: { create: authStorageCreateMock },
	ModelRegistry: modelRegistryCtorMock,
	DefaultResourceLoader: defaultResourceLoaderCtorMock,
}));
vi.mock("./help.js", () => ({ printHelpTopic: printHelpTopicMock }));
vi.mock("./cli/validate-args.js", () => ({ parseValidateCommandArgs: parseValidateCommandArgsMock }));
vi.mock("./cli/complexity-estimate-args.js", () => ({ parseComplexityEstimateArgs: parseComplexityEstimateArgsMock, loadComplexityInput: loadComplexityInputMock, COMPLEXITY_ESTIMATE_USAGE: "usage" }));
vi.mock("./complexity/estimate.js", () => ({ estimateComplexity: estimateComplexityMock }));
vi.mock("./pipeline/trace.js", () => ({ createTraceHandler: createTraceHandlerMock, defaultTracePath: defaultTracePathMock, formatTrace: formatTraceMock }));
vi.mock("./pipeline/checkpoint.js", () => ({ loadCheckpoint: loadCheckpointMock, defaultCheckpointPath: vi.fn(() => "/tmp/checkpoint") }));
vi.mock("./pipeline/lock.js", () => ({ acquireLock: acquireLockMock }));
vi.mock("./pipeline/watch.js", () => ({ WatchLoop: class WatchLoop { start = watchLoopStartMock; stop = watchLoopStopMock; }, parseTriggerArgs: vi.fn() }));
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
	configureRunStorageScope: vi.fn(() => ".hatch/runs"),
	setLifecycleProjectionEmitter: vi.fn(),
	findNearestFactoryConfigPath: vi.fn(() => ""),
	inferFactoryTelemetryIdentityFromPipelineConfig: vi.fn(() => ({
		factory: "",
		factory_id: "",
		repo: "",
		validation: {
			status: "missing",
			configPath: "",
			issuePath: "",
			message: "factory config not found",
			warning: "[factory-config] status=missing search_start=(none)",
		},
	})),
}));
vi.mock("./factory/context-resolver.js", () => ({
	resolveFactoryContext: vi.fn(() => ({
		factory_root: process.cwd(),
		factory_config_path: `${process.cwd()}/factory.config.json`,
		factory_id: "",
		target_repo: "",
		control_plane_repo: "",
		kind_id: "",
		instance_id: "",
		destinations_json: "",
		runs_dir: `${process.cwd()}/.hatch/runs`,
		scenarios_root: `${process.cwd()}/scenarios`,
		factory_mode: "standalone",
		factory_mode_source: [{ source: "mode.default", mode: "standalone", precedence: "low", detail: "no explicit mode sources resolved" }],
	})),
}));
vi.mock("./runs.js", () => ({ cmdRuns: cmdRunsMock }));
vi.mock("./pipeline/tool-env.js", () => ({
	createSharedToolEnv: vi.fn((opts: any) => ({
		FACTORY_REPO: process.cwd(),
		FACTORY_CONFIG_PATH: `${process.cwd()}/factory.config.json`,
		HATCH_PIPELINE_FILE: require("node:path").resolve(opts?.pipelineFile || "sample.dot"),
		HATCH_WORKDIR: process.cwd(),
	})),
}));
vi.mock("./cli/factory-context-runtime.js", () => ({
	applyFactoryContextToEngineContext: vi.fn(),
	seedRunStateFactoryContext: vi.fn(),
}));
vi.mock("./cli/provider-defaults.js", () => ({
	defaultModelForProvider: vi.fn(() => "claude-sonnet-4-6"),
	resolveFactoryIsolationAuthStoragePath: vi.fn(() => undefined),
	resolveFactoryIsolationRuntimeEnv: vi.fn(({ env }: { env: NodeJS.ProcessEnv }) => env),
	seedRuntimeApiKeysFromEnv: vi.fn(),
}));
vi.mock("./factory/model-policy.js", () => ({
	resolveEffectiveModelPolicyForPipeline: vi.fn(() => undefined),
}));
vi.mock("./pipeline/lifecycle-persistence.js", () => ({ persistLifecycleContextFromEngine: persistLifecycleContextFromEngineMock }));
vi.mock("@recallnet/factory-telemetry", async (importOriginal) => {
	const actual = await importOriginal<any>();
	return {
		...actual,
		EventBus: class EventBus { on = vi.fn(() => () => {}); emit = vi.fn(); },
		factoryMetadataProviderFromIdentity: vi.fn(() => () => ({})),
		flushOtelRuntime: flushOtelRuntimeMock,
		shutdownOtelRuntime: shutdownOtelRuntimeMock,
	};
});

vi.stubGlobal("process", {
	...process,
	argv: ["node", "cli", "run", "sample.dot"],
	on: processOnMock,
	exit: processExitMock,
});

describe("cli graceful shutdown telemetry", () => {
	it("flushes runtime telemetry before process exit on signal", async () => {
		parseWithAstMock.mockReturnValue({
			graph: { name: "sample", attrs: {}, nodes: {}, edges: [] },
			nodes: [],
			stylesheetImports: [],
		});
		const imported = await import("./cli.js");
		expect(imported).toBeTruthy();
		await vi.waitFor(() => expect(registerAllMock).toHaveBeenCalled(), { timeout: 2000 });
		const handlerConfig = registerAllMock.mock.calls[0]?.[1] as any;
		expect(handlerConfig).toBeTruthy();
		expect(handlerConfig?.toolEnv).toEqual(expect.objectContaining({
			FACTORY_REPO: process.cwd(),
			FACTORY_CONFIG_PATH: `${process.cwd()}/factory.config.json`,
			HATCH_PIPELINE_FILE: `${process.cwd()}/sample.dot`,
		}));
		const signalHandlerCall = processOnMock.mock.calls.find((call: any[]) => call[0] === "SIGTERM");
		expect(signalHandlerCall).toBeTruthy();
		const handler = signalHandlerCall?.[1] as () => Promise<void>;
		await handler();
		expect(flushOtelRuntimeMock).toHaveBeenCalled();
		expect(shutdownOtelRuntimeMock).toHaveBeenCalled();
		expect(processExitMock).toHaveBeenCalledWith(0);
	});

	it("continues cleanly when otel flush is best-effort", async () => {
		flushOtelRuntimeMock.mockRejectedValueOnce(new Error("flush failed"));
		parseWithAstMock.mockReturnValue({
			graph: { name: "sample", attrs: {}, nodes: {}, edges: [] },
			nodes: [],
			stylesheetImports: [],
		});
		await import("./cli.js");
		await vi.waitFor(() => expect(registerAllMock).toHaveBeenCalled(), { timeout: 2000 });
		expect(flushOtelRuntimeMock).not.toHaveBeenCalledWith(1);
		expect(processExitMock).not.toHaveBeenCalledWith(1);
	});
});
