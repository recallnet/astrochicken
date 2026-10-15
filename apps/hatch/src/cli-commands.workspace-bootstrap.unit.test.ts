import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const parseFactoryContextOverrideArgsMock = vi.fn();
const resolveFactoryContextOrExitMock = vi.fn();
const logFactoryContextStartupMock = vi.fn();
const configureRunStorageScopeMock = vi.fn();
const loadCheckpointMock = vi.fn();
const defaultCheckpointPathMock = vi.fn();
const repairWorkspaceBootstrapMock = vi.fn();
const installWorkspaceMock = vi.fn();
const findRepoRootMock = vi.fn();
const processExitMock = vi.fn((code?: number) => {
	throw new Error(`process.exit:${code ?? ""}`);
});

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<any>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(() => true),
	};
});

vi.mock("./cli/factory-context-overrides.js", () => ({
	parseFactoryContextOverrideArgs: parseFactoryContextOverrideArgsMock,
}));

vi.mock("./cli/factory-context-runtime.js", () => ({
	resolveFactoryContextOrExit: resolveFactoryContextOrExitMock,
	logFactoryContextStartup: logFactoryContextStartupMock,
	seedRunStateFactoryContext: vi.fn(),
}));

vi.mock("./pipeline/run.js", () => ({
	configureRunStorageScope: configureRunStorageScopeMock,
	loadRunState: vi.fn(),
	findRecoverableRun: vi.fn(),
	isStaleRun: vi.fn(() => false),
	isPidAlive: vi.fn(() => false),
	eventsPath: vi.fn(),
	saveRunState: vi.fn(),
}));

vi.mock("./pipeline/checkpoint.js", () => ({
	loadCheckpoint: loadCheckpointMock,
	defaultCheckpointPath: defaultCheckpointPathMock,
}));

vi.mock("./intent/loader.js", () => ({
	findRepoRoot: findRepoRootMock,
}));

vi.mock("node:module", async () => {
	const actual = await vi.importActual("node:module");
	return {
		...actual,
		createRequire: vi.fn(() => {
			return (specifier) => {
				if (specifier === "../../../packages/factory-core/src/workspace-package-manager.ts") {
					return { bootstrapWorkspace: installWorkspaceMock, repairWorkspaceBootstrap: repairWorkspaceBootstrapMock };
				}
				throw new Error(`unexpected require: ${specifier}`);
			};
		}),
	};
});

describe("cli workspace bootstrap", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		installWorkspaceMock.mockImplementation(() => { throw new Error("canonical_workspace_install_forbidden"); });
		vi.stubGlobal("process", {
			...process,
			exit: processExitMock,
		});
		parseFactoryContextOverrideArgsMock.mockImplementation((args: string[]) => ({ args, flags: {} }));
		resolveFactoryContextOrExitMock.mockReturnValue({
			factory_root: "/repo/factories/example-trading",
			factory_config_path: "/repo/factories/example-trading/factory.config.json",
			factory_id: "example-trading",
			target_repo: "acme/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: "/repo/.hatch/example-trading/runs",
			scenarios_root: "/repo/factories/example-trading/scenarios",
			factory_mode: "standalone",
			factory_mode_source: [],
		});
		findRepoRootMock.mockReturnValue("/repo");
		repairWorkspaceBootstrapMock.mockReturnValue({
			ok: true,
			reason: "workspace_bootstrapped",
			install_code: "0",
			build_code: "0",
		});
		defaultCheckpointPathMock.mockReturnValue("/repo/checkpoint.json");
		loadCheckpointMock.mockReturnValue({ currentNodeId: "resume-node" });
	});

	it("repairs the installed repo workspace without reinstalling before cmdRun executes the pipeline", async () => {
		const { cmdRun } = await import("./cli-commands.js");
		const runPipeline = vi.fn(async () => undefined);
		const graphDir = path.dirname(path.resolve("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));

		await cmdRun(["docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"], {
			runPipeline,
			parseGraph: vi.fn(),
			loadIntentRegistryForFile: vi.fn(),
			buildHandlerConfig: vi.fn(),
		});

		expect(findRepoRootMock).toHaveBeenCalledWith(graphDir);
		expect(repairWorkspaceBootstrapMock).toHaveBeenCalledWith({
			repoRoot: "/repo",
			workspaceDir: "/repo",
		});
		expect(runPipeline).toHaveBeenCalledTimes(1);
		expect(installWorkspaceMock).not.toHaveBeenCalled();
	});

	it("repairs the installed repo workspace without reinstalling before cmdResume executes the pipeline", async () => {
		const { cmdResume } = await import("./cli-commands.js");
		const runPipeline = vi.fn(async () => undefined);
		const graphDir = path.dirname(path.resolve("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));

		await cmdResume(["docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"], {
			runPipeline,
			parseGraph: vi.fn(),
			loadIntentRegistryForFile: vi.fn(),
			buildHandlerConfig: vi.fn(),
		});

		expect(findRepoRootMock).toHaveBeenCalledWith(graphDir);
		expect(repairWorkspaceBootstrapMock).toHaveBeenCalledWith({
			repoRoot: "/repo",
			workspaceDir: "/repo",
		});
		expect(runPipeline).toHaveBeenCalledTimes(1);
		expect(installWorkspaceMock).not.toHaveBeenCalled();
	});

	it("fails closed when workspace bootstrap fails", async () => {
		const { cmdRun } = await import("./cli-commands.js");
		const runPipeline = vi.fn(async () => undefined);
		repairWorkspaceBootstrapMock.mockReturnValue({
			ok: false,
			reason: "pnpm_install_failed",
			install_code: "1",
			build_code: "",
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			cmdRun(["docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"], {
				runPipeline,
				parseGraph: vi.fn(),
				loadIntentRegistryForFile: vi.fn(),
				buildHandlerConfig: vi.fn(),
			}),
		).rejects.toThrow("process.exit:1");

		expect(runPipeline).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			"[hatch] workspace bootstrap failed repo=/repo reason=pnpm_install_failed install_code=1 build_code=",
		);
		errorSpy.mockRestore();
	});

	it("cmdValidate exits non-zero when parseGraph fails on model_matrix load", async () => {
		const { cmdValidate } = await import("./cli-commands.js");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const parseGraph = vi.fn(() => {
			throw new Error(
				"[model-matrix:model_matrix_load.schema.invalid] graph model_matrix=\"config/model-matrix.json\" (\"/repo/config/model-matrix.json\"): invalid schema",
			);
		});

		await expect(
			cmdValidate(["graph.dot"], {
				runPipeline: vi.fn(),
				parseGraph,
				loadIntentRegistryForFile: vi.fn(),
				buildHandlerConfig: vi.fn(),
			}),
		).rejects.toThrow("process.exit:1");

		expect(parseGraph).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"[model-matrix:model_matrix_load.schema.invalid] graph model_matrix=\"config/model-matrix.json\" (\"/repo/config/model-matrix.json\"): invalid schema",
		);
		errorSpy.mockRestore();
	});
});
