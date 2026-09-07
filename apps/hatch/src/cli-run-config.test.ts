import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const createRunStateMock = vi.fn();
let realCreateRunState: ((runId: string, pipelineFile: string, scope?: unknown) => unknown) | null = null;

vi.mock("./pipeline/run.js", async () => {
	const actual = await vi.importActual<any>("./pipeline/run.js");
	realCreateRunState = actual.createRunState;
	return {
		...actual,
		createRunState: createRunStateMock,
	};
});

const contextEnvKeys = [
	"HATCH_FACTORY_ROOT",
	"HATCH_FACTORY_CONFIG_PATH",
	"HATCH_FACTORY_ID",
	"HATCH_TARGET_REPO",
	"HATCH_CONTROL_PLANE_REPO",
	"HATCH_RUNS_DIR",
	"HATCH_SCENARIOS_ROOT",
	"HATCH_GH_REPO",
	"FACTORY_ROOT",
	"FACTORY_CONFIG_PATH",
	"FACTORY_ID",
	"TARGET_REPO",
	"CONTROL_PLANE_REPO",
	"RUNS_DIR",
	"SCENARIOS_ROOT",
	"GH_REPO",
	"MOTHERSHIP_REPO",
] as const;

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function normalizeTmpAlias(value: string): string {
	return String(value || "").replace(/^\/private\//, "/");
}

function writeGraph(path: string): void {
	writeFileSync(path, "digraph test { start [shape=Mdiamond] done [shape=Msquare] start -> done }\n");
}

function buildFactoryLayout(kind: "control" | "external"): {
	root: string;
	graphPath: string;
	nestedCwd: string;
	configPath: string;
	graphArgFromNested: string;
	config: {
		factory_id: string;
		target_repo: string;
		control_plane_repo: string;
		runs_dir: string;
		scenarios: { root: string };
	};
	expected: {
		factory_id: string;
		target_repo: string;
		control_plane_repo: string;
		runs_dir: string;
		scenarios_root: string;
	};
} {
	const root = mkdtempSync(join(tmpdir(), `hatch-cli-run-config-${kind}-`));
	if (kind === "control") {
		const factoryRoot = join(root, "factories", "mothership");
		const graphsRoot = join(factoryRoot, "graphs");
		const nestedCwd = join(graphsRoot, "nested", "deep");
		mkdirSync(nestedCwd, { recursive: true });
		const graphPath = join(graphsRoot, "factory_supervisor_tick.dot");
		const configPath = join(factoryRoot, "factory.config.json");
		const config = {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			factory_root: "factories/mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			dispatch: { graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
			skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
			scenarios: { root: "factories/mothership/scenarios" },
			pipeline: { supervisor_tick: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
			runs_dir: ".hatch/mothership/runs",
			trust: {
				domain: "mothership.local",
				roles: ["mothership.local.tool", "mothership.local.codergen"],
			},
		};
		writeGraph(graphPath);
		writeJson(configPath, config);
		return {
			root,
			graphPath,
			nestedCwd,
			configPath,
			graphArgFromNested: "../../factory_supervisor_tick.dot",
			config,
			expected: {
				factory_id: "mothership",
				target_repo: "recallnet/astrochicken",
				control_plane_repo: "recallnet/astrochicken",
				runs_dir: join(root, ".hatch", "mothership", "runs"),
				scenarios_root: join(root, "factories", "mothership", "scenarios"),
			},
		};
	}

	const graphsRoot = join(root, "graphs");
	const nestedCwd = join(graphsRoot, "nested", "deep");
	mkdirSync(nestedCwd, { recursive: true });
	const graphPath = join(graphsRoot, "factory_supervisor_tick.dot");
	const configPath = join(root, "factory.config.json");
	const config = {
		schema: "hatch.factory.config.v1",
		factory_id: "acme-support",
		factory_root: ".",
		target_repo: "acme/support-factory",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
		skills: { supervisor: "skills/supervisor/current.md" },
		scenarios: { root: "scenarios/acme-support" },
		pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
		runs_dir: ".hatch/acme-support/runs",
		trust: {
			domain: "acme-support.local",
			roles: ["acme-support.local.tool", "acme-support.local.codergen"],
		},
	};
	writeGraph(graphPath);
	writeJson(configPath, config);
	return {
		root,
		graphPath,
		nestedCwd,
		configPath,
		graphArgFromNested: "../../factory_supervisor_tick.dot",
		config,
		expected: {
			factory_id: "acme-support",
			target_repo: "acme/support-factory",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: join(root, ".hatch", "acme-support", "runs"),
			scenarios_root: join(root, "scenarios", "acme-support"),
		},
	};
}

async function runCliImportFromCwd(cwd: string, args: string[]): Promise<{ exitCodes: number[]; errorMessages: string[] }> {
	const originalArgv = process.argv;
	const originalCwd = process.cwd();
	const originalEnv = Object.fromEntries(contextEnvKeys.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
	const processExitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => undefined) as any);
	const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

	try {
		for (const key of contextEnvKeys) delete process.env[key];
		process.argv = ["node", "cli", ...args];
		process.chdir(cwd);
		vi.resetModules();
		await import("./cli.js");
		await vi.waitFor(() => {
			expect(processExitSpy.mock.calls.length).toBeGreaterThan(0);
		}, { timeout: 2000 });

		return {
			exitCodes: processExitSpy.mock.calls.map(([code]) => Number(code ?? 0)),
			errorMessages: consoleErrorSpy.mock.calls.flat().map((entry) => String(entry)),
		};
	} finally {
		process.argv = originalArgv;
		process.chdir(originalCwd);
		for (const key of contextEnvKeys) {
			const value = originalEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

afterEach(() => {
	createRunStateMock.mockReset();
	vi.restoreAllMocks();
});

describe("cli run factory config validation", () => {
	it("finds nearest factory config via exported ancestor walker", async () => {
		const layout = buildFactoryLayout("control");
		const { findNearestFactoryConfigPath } = await import("./pipeline/run.js");
		expect(findNearestFactoryConfigPath(layout.graphPath)).toBe(layout.configPath);
	});

	it(
		"runs hatch cli entrypoint in control-plane and external layouts (root + nested) and seeds factory-scoped run context",
		async () => {
		const controlLayout = buildFactoryLayout("control");
		const externalLayout = buildFactoryLayout("external");
		realCreateRunState = (await vi.importActual<any>("./pipeline/run.js")).createRunState;
		const captures: Array<{
			runId: string;
			pipelineFile: string;
			scope: { runsDir?: string; factoryId?: string };
			state: {
				context: Record<string, string>;
			};
		}> = [];

		createRunStateMock.mockImplementation((runId: string, pipelineFile: string, scope: { runsDir?: string; factoryId?: string }) => {
			if (!realCreateRunState) throw new Error("real createRunState not initialized");
			const state = realCreateRunState(runId, pipelineFile, scope) as { context: Record<string, string> };
			captures.push({ runId, pipelineFile, scope: scope || {}, state });
			return state;
		});

		const scenarios = [
			{ name: "control-root", cwd: controlLayout.root, graphArg: controlLayout.graphPath, layout: controlLayout },
			{ name: "control-nested", cwd: controlLayout.nestedCwd, graphArg: controlLayout.graphArgFromNested, layout: controlLayout },
			{ name: "external-root", cwd: externalLayout.root, graphArg: externalLayout.graphPath, layout: externalLayout },
			{ name: "external-nested", cwd: externalLayout.nestedCwd, graphArg: externalLayout.graphArgFromNested, layout: externalLayout },
		] as const;

		for (const scenario of scenarios) {
			const beforeCount = captures.length;
			const result = await runCliImportFromCwd(scenario.cwd, ["run", scenario.graphArg]);
			await vi.waitFor(() => {
				expect(captures.length).toBe(beforeCount + 1);
			});
			const allErrors = result.errorMessages.join("\n");
			expect(allErrors, scenario.name).not.toContain("factory config validation failed");
			expect(allErrors, scenario.name).not.toContain("unable to load factory.config.json");
			const capture = captures[captures.length - 1];
			expect(capture, scenario.name).toBeTruthy();
			expect(normalizeTmpAlias(capture.pipelineFile), scenario.name).toBe(normalizeTmpAlias(resolve(scenario.cwd, scenario.graphArg)));
			expect(capture.scope.factoryId, scenario.name).toBe(scenario.layout.expected.factory_id);
			expect(normalizeTmpAlias(capture.scope.runsDir || ""), scenario.name).toBe(normalizeTmpAlias(scenario.layout.expected.runs_dir));
			expect(capture.state.context.factory_id, scenario.name).toBe(scenario.layout.expected.factory_id);
			expect(capture.state.context.target_repo, scenario.name).toBe(scenario.layout.expected.target_repo);
			expect(capture.state.context.control_plane_repo, scenario.name).toBe(scenario.layout.expected.control_plane_repo);
			expect(normalizeTmpAlias(capture.state.context.runs_dir), scenario.name).toBe(normalizeTmpAlias(scenario.layout.expected.runs_dir));
			expect(normalizeTmpAlias(capture.state.context.scenarios_root), scenario.name).toBe(normalizeTmpAlias(scenario.layout.expected.scenarios_root));
			expect(normalizeTmpAlias(capture.state.context.factory_config_path), scenario.name).toBe(normalizeTmpAlias(scenario.layout.configPath));
			// Proves derived run-state context came from the authored factory.config.json document.
			expect(capture.state.context.target_repo, scenario.name).toBe(scenario.layout.config.target_repo);
			expect(capture.state.context.control_plane_repo, scenario.name).toBe(scenario.layout.config.control_plane_repo);
		}
		},
		// @context:regression !critical This contract exercises four real CLI
		// launches across control-plane and external layouts under the bounded
		// single-fork hook path. A 20s per-test cap flakes under hook pressure
		// even when the CLI contract is healthy, so keep the guard high enough to
		// cover the deterministic workload while still failing closed long before
		// the outer Vitest timeout.
		90_000,
	);

	it(
		"loads factory context for shared managed supervisor graphs via --factory-root",
		async () => {
		const controlLayout = buildFactoryLayout("control");
		const sharedGraphPath = resolve(import.meta.dirname, "../../../packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs");
		realCreateRunState = (await vi.importActual<any>("./pipeline/run.js")).createRunState;
		const captures: Array<{
			scope: { runsDir?: string; factoryId?: string };
			state: { context: Record<string, string> };
		}> = [];

		createRunStateMock.mockImplementation((runId: string, pipelineFile: string, scope: { runsDir?: string; factoryId?: string }) => {
			if (!realCreateRunState) throw new Error("real createRunState not initialized");
			const state = realCreateRunState(runId, pipelineFile, scope) as { context: Record<string, string> };
			captures.push({ scope: scope || {}, state });
			return state;
		});

		const result = await runCliImportFromCwd(controlLayout.root, [
			"run",
			"--factory-root",
			join(controlLayout.root, "factories", "mothership"),
			sharedGraphPath,
		]);
		const allErrors = result.errorMessages.join("\n");
		expect(allErrors).not.toContain("unable to load factory.config.json");
		expect(captures).toHaveLength(1);
		expect(captures[0]?.scope.factoryId).toBe("mothership");
		expect(normalizeTmpAlias(captures[0]?.scope.runsDir || "")).toBe(normalizeTmpAlias(controlLayout.expected.runs_dir));
		expect(captures[0]?.state.context.factory_root).toBe(join(controlLayout.root, "factories", "mothership"));
		expect(captures[0]?.state.context.factory_id).toBe("mothership");
		expect(normalizeTmpAlias(captures[0]?.state.context.runs_dir || "")).toBe(normalizeTmpAlias(controlLayout.expected.runs_dir));
		},
		120_000,
	);

	it("fails before creating run state when nearest factory config is invalid", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-cli-run-config-"));
		const factoryRoot = join(root, "factories", "broken-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		const pipelinePath = join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
		writeGraph(pipelinePath);
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v0",
			factory_id: "broken-factory",
			repo: "example-org/test-repo",
			target_repo: "example-org/test-repo",
			control_plane: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			dispatch: { graph: "factories/broken-factory/graphs/factory_supervisor_tick.dot" },
			skills: { supervisor: "factories/broken-factory/skills/supervisor/current.md" },
			scenarios: { root: "factories/broken-factory/scenarios/broken-factory" },
			pipeline: { supervisor_tick: "factories/broken-factory/graphs/factory_supervisor_tick.dot" },
			runs_dir: ".hatch/broken-factory/runs",
			trust: {
				domain: "broken-factory.local",
				roles: ["broken-factory.local.tool"],
			},
		});

		const result = await runCliImportFromCwd(root, ["run", pipelinePath]);
		const allErrors = result.errorMessages.join("\n");
		expect(result.exitCodes.includes(1)).toBe(true);
		expect(allErrors).toContain("factory config validation failed");
		expect(createRunStateMock).not.toHaveBeenCalled();
		expect(allErrors).toContain(configPath);
		expect(allErrors).toContain('schema must be "hatch.factory.config.v1"');
	});
});
