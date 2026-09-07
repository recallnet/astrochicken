import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFactoryContext } from "./factory/context-resolver.js";
import { configureRunStorageScope } from "./pipeline/run.js";
import { cmdRuns } from "./runs.js";

const RESOLVER_ENV_KEYS = [
	"HATCH_FACTORY_ROOT",
	"FACTORY_ROOT",
	"HATCH_FACTORY_CONFIG_PATH",
	"FACTORY_CONFIG_PATH",
	"HATCH_FACTORY_ID",
	"FACTORY_ID",
	"HATCH_TARGET_REPO",
	"TARGET_REPO",
	"HATCH_GH_REPO",
	"GH_REPO",
	"MOTHERSHIP_REPO",
	"HATCH_CONTROL_PLANE_REPO",
	"CONTROL_PLANE_REPO",
	"HATCH_RUNS_DIR",
	"RUNS_DIR",
	"HATCH_SCENARIOS_ROOT",
	"SCENARIOS_ROOT",
	"HATCH_FACTORY_MODE",
	"FACTORY_MODE",
] as const;

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeTmpAlias(value: string): string {
	return String(value || "").replace(/^\/private\//, "/");
}

function writeFactoryConfig({
	rootDir,
	configPath,
	factoryRoot,
}: {
	rootDir: string;
	configPath: string;
	factoryRoot: string;
}): void {
	writeJson(configPath, {
		schema: "hatch.factory.config.v1",
		factory_id: "mothership",
		factory_root: factoryRoot,
		target_repo: "recallnet/astrochicken",
		control_plane_repo: "recallnet/astrochicken",
		runs_dir: ".hatch/mothership/runs",
		scenarios: {
			root: "factories/mothership/scenarios/astrochicken",
		},
	});
}

function writeRunState({
	runsDir,
	runId,
	status = "running",
	runsPathContext,
}: {
	runsDir: string;
	runId: string;
	status?: "running" | "completed" | "failed";
	runsPathContext: string;
}): void {
	const now = new Date().toISOString();
	writeJson(join(runsDir, runId, "state.json"), {
		runId,
		pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
		status,
		pid: process.pid,
		startedAt: now,
		updatedAt: now,
		currentNode: "wave_execute",
		context: {
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			runs_dir: runsPathContext,
			factory_mode: "standalone",
		},
		activeChildren: {},
		completedNodes: [],
		locksHeld: [],
		records: [],
	});
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk));
		return true;
	}) as typeof process.stdout.write);

	try {
		await run();
	} finally {
		spy.mockRestore();
	}

	return chunks.join("");
}

function clearResolverEnv(): void {
	for (const key of RESOLVER_ENV_KEYS) delete process.env[key];
}

async function runActiveFromCwd(cwd: string): Promise<{ raw: string; payload: any }> {
	const original = process.cwd();
	clearResolverEnv();

	try {
		process.chdir(cwd);
		const context = resolveFactoryContext({ cwd });
		configureRunStorageScope({
			runsDir: context.runs_dir,
			factoryId: context.factory_id,
		});
	} finally {
		process.chdir(original);
	}

	const raw = await captureStdout(async () => {
		await cmdRuns(["active", "--json"]);
	});
	return { raw, payload: JSON.parse(raw) };
}

describe("hatch runs active cross-context portability", () => {
	let root: string;
	const envBackup = new Map<string, string | undefined>();

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-runs-context-portability-"));
		for (const key of RESOLVER_ENV_KEYS) envBackup.set(key, process.env[key]);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		for (const key of RESOLVER_ENV_KEYS) {
			const previous = envBackup.get(key);
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		}
		configureRunStorageScope({ runsDir: ".hatch/runs" });
	});

	it("resolves factory-scoped runs from control-plane + external roots (root + nested cwd) and rejects unscoped fallback", async () => {
		const controlRoot = join(root, "control");
		const externalRoot = join(root, "external");

		writeFactoryConfig({
			rootDir: controlRoot,
			configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
			factoryRoot: "factories/mothership",
		});
		writeFactoryConfig({
			rootDir: externalRoot,
			configPath: join(externalRoot, "factory.config.json"),
			factoryRoot: ".",
		});

		const controlRunsDir = join(controlRoot, ".hatch", "mothership", "runs");
		const externalRunsDir = join(externalRoot, ".hatch", "mothership", "runs");
		const controlFallbackRunsDir = join(controlRoot, ".hatch", "runs");
		const externalFallbackRunsDir = join(externalRoot, ".hatch", "runs");

		writeRunState({
			runsDir: controlRunsDir,
			runId: "control-scoped-run",
			runsPathContext: controlRunsDir,
		});
		writeRunState({
			runsDir: externalRunsDir,
			runId: "external-scoped-run",
			runsPathContext: externalRunsDir,
		});

		writeRunState({
			runsDir: controlFallbackRunsDir,
			runId: "fallback-run",
			runsPathContext: controlFallbackRunsDir,
		});
		writeRunState({
			runsDir: externalFallbackRunsDir,
			runId: "fallback-run",
			runsPathContext: externalFallbackRunsDir,
		});

		const controlNested = join(controlRoot, "factories", "mothership", "graphs", "nested", "deep");
		const externalNested = join(externalRoot, "graphs", "nested", "deep");
		mkdirSync(controlNested, { recursive: true });
		mkdirSync(externalNested, { recursive: true });

		const cases = [
			{ name: "control-root", cwd: controlRoot, expectedRun: "control-scoped-run", expectedRunsDir: controlRunsDir },
			{ name: "control-nested", cwd: controlNested, expectedRun: "control-scoped-run", expectedRunsDir: controlRunsDir },
			{ name: "external-root", cwd: externalRoot, expectedRun: "external-scoped-run", expectedRunsDir: externalRunsDir },
			{ name: "external-nested", cwd: externalNested, expectedRun: "external-scoped-run", expectedRunsDir: externalRunsDir },
		] as const;

		for (const testCase of cases) {
			const { raw, payload } = await runActiveFromCwd(testCase.cwd);
			expect(payload.context.factory_id, testCase.name).toBe("mothership");
			expect(payload.context.factory_mode, testCase.name).toBe("standalone");
			expect(normalizeTmpAlias(payload.context.runs_dir), testCase.name).toBe(normalizeTmpAlias(testCase.expectedRunsDir));
			expect(payload.active.some((row: { run_id: string }) => row.run_id === testCase.expectedRun), testCase.name).toBe(true);
			expect(payload.active.some((row: { run_id: string }) => row.run_id === "fallback-run"), testCase.name).toBe(false);
			expect(raw, testCase.name).not.toContain("fallback-run");
			expect(resolve(testCase.expectedRunsDir).replace(/\\/g, "/").endsWith("/.hatch/mothership/runs"), testCase.name).toBe(true);
			expect(raw.replace(/\\/g, "/"), testCase.name).not.toMatch(/\/\.hatch\/runs(?!\/mothership\/runs)/);
		}
	});
});
