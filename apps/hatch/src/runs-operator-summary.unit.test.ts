import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureRunStorageScope, createRunState, saveRunState } from "./pipeline/run.js";
import { cmdRuns } from "./runs.js";

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

describe("hatch runs operator presenter output", () => {
	let root: string;
	let runsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-runs-operator-summary-"));
		runsDir = join(root, ".hatch", "runs");
		mkdirSync(runsDir, { recursive: true });
		configureRunStorageScope({ runsDir });
		delete process.env["HATCH_FACTORY_ROOT"];
		delete process.env["FACTORY_ROOT"];
		delete process.env["HATCH_FACTORY_CONFIG_PATH"];
		delete process.env["FACTORY_CONFIG_PATH"];
		delete process.env["HATCH_FACTORY_ID"];
		delete process.env["FACTORY_ID"];
		delete process.env["HATCH_TARGET_REPO"];
		delete process.env["TARGET_REPO"];
		delete process.env["HATCH_GH_REPO"];
		delete process.env["GH_REPO"];
		delete process.env["MOTHERSHIP_REPO"];
		delete process.env["HATCH_CONTROL_PLANE_REPO"];
		delete process.env["CONTROL_PLANE_REPO"];
		delete process.env["HATCH_SCENARIOS_ROOT"];
		delete process.env["SCENARIOS_ROOT"];
		delete process.env["HATCH_RUNS_DIR"];
		delete process.env["RUNS_DIR"];
		delete process.env["HATCH_FACTORY_MODE"];
		delete process.env["FACTORY_MODE"];
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("active/recoverable/why human output uses shared presenter sections", async () => {
		const run = createRunState("operator-run-1", "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		run.status = "running";
		run.currentNode = "wave_execute";
		run.context = {
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: runsDir,
			factory_mode: "managed",
			milestone_title: "goal-1565-wave-2",
			issue_number: "1631",
		};
		saveRunState(run);

		const activeOutput = await captureStdout(async () => {
			await cmdRuns(["active"]);
		});
		expect(activeOutput).toContain("Factory ID: mothership");
		expect(activeOutput).toContain("Target Repo: recallnet/astrochicken");
		expect(activeOutput).toContain("Factory Mode: managed");
		expect(activeOutput).toContain("Control plane gate:");
		expect(activeOutput).toContain("Managed state:");
		expect(activeOutput).toContain("Active runs:");
		expect(activeOutput).toContain("node=wave_execute");

		const recoverableRun = createRunState("operator-run-2", "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs");
		recoverableRun.status = "suspended";
		recoverableRun.currentNode = "execute_issue_in_wave";
		recoverableRun.context = {
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: runsDir,
			factory_mode: "managed",
		};
		saveRunState(recoverableRun);

		const recoverableOutput = await captureStdout(async () => {
			await cmdRuns(["recoverable"]);
		});
		expect(recoverableOutput).toContain("Factory ID: mothership");
		expect(recoverableOutput).toContain("Target Repo: recallnet/astrochicken");
		expect(recoverableOutput).toContain("Factory Mode: managed");
		expect(recoverableOutput).toContain("Control plane gate:");
		expect(recoverableOutput).toContain("Managed state:");
		expect(recoverableOutput).toContain("Active runs:");
		expect(recoverableOutput).toContain("node=execute_issue_in_wave");

		const whyOutput = await captureStdout(async () => {
			await cmdRuns(["why", "operator-run-1"]);
		});
		expect(whyOutput).toContain("Factory ID: mothership");
		expect(whyOutput).toContain("Target Repo: recallnet/astrochicken");
		expect(whyOutput).toContain("Factory Mode: managed");
		expect(whyOutput).toContain("CURRENT TICK");
		expect(whyOutput).toContain("Stage: wave_execute");
		expect(whyOutput).toContain("Elapsed:");
	});

	it("active/recoverable/why --json preserve deterministic payload shape", async () => {
		const run = createRunState("operator-json-1", "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		run.status = "running";
		run.currentNode = "wave_execute";
		run.context = {
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: runsDir,
			factory_mode: "managed",
			goal_issues: JSON.stringify([1565, 1566]),
		};
		saveRunState(run);

		const activeJsonRaw = await captureStdout(async () => {
			await cmdRuns(["active", "--json"]);
		});
		const activeJson = JSON.parse(activeJsonRaw) as {
			count: number;
			context: { factory_id: string; target_repo: string; runs_dir: string; factory_mode: string };
			active: Array<{ id: string; node: string }>;
			runs: Array<{ run_id: string; node: string }>;
			human_rows: Array<{ runId: string }>;
		};
		expect(activeJson.count).toBeGreaterThanOrEqual(1);
		expect(activeJson.context.factory_id).toBe("mothership");
		expect(activeJson.context.factory_mode).toBe("managed");
		expect(activeJson.context.target_repo).toBe("recallnet/astrochicken");
		expect(activeJson.context.runs_dir).toBe(runsDir);
		expect(activeJson.active.some((row) => row.id === "operator-json-1" && row.node === "wave_execute")).toBe(true);
		expect(activeJson.runs.some((row) => row.run_id === "operator-json-1" && row.node === "wave_execute")).toBe(true);
		expect(activeJson.human_rows.some((row) => row.runId === "operator-json-1")).toBe(true);

		run.status = "suspended";
		saveRunState(run);
		const recoverableJsonRaw = await captureStdout(async () => {
			await cmdRuns(["recoverable", "--json"]);
		});
		const recoverableJson = JSON.parse(recoverableJsonRaw) as {
			count: number;
			context: { factory_id: string; target_repo: string; factory_mode: string };
			active: Array<{ id: string; status: string }>;
			runs: Array<{ run_id: string; status: string }>;
			human_rows: Array<{ runId: string; status: string }>;
		};
		expect(recoverableJson.count).toBeGreaterThanOrEqual(1);
		expect(recoverableJson.context.factory_id).toBe("mothership");
		expect(recoverableJson.context.factory_mode).toBe("managed");
		expect(recoverableJson.context.target_repo).toBe("recallnet/astrochicken");
		expect(recoverableJson.active.some((row) => row.id === "operator-json-1" && row.status === "suspended")).toBe(true);
		expect(recoverableJson.runs.some((row) => row.run_id === "operator-json-1" && row.status === "suspended")).toBe(true);
		expect(recoverableJson.human_rows.some((row) => row.runId === "operator-json-1" && row.status === "suspended")).toBe(true);

		const whyJsonRaw = await captureStdout(async () => {
			await cmdRuns(["why", "operator-json-1", "--json"]);
		});
		const whyJson = JSON.parse(whyJsonRaw) as {
			found: boolean;
			context: { factory_id: string; target_repo: string; factory_mode: string };
			ticks: Array<{ id: string; stage: string; goalCount: string }>;
			why: { runId: string };
		};
		expect(whyJson.found).toBe(true);
		expect(whyJson.context.factory_id).toBe("mothership");
		expect(whyJson.context.factory_mode).toBe("managed");
		expect(whyJson.context.target_repo).toBe("recallnet/astrochicken");
		expect(whyJson.ticks[0]?.id).toBe("operator-json-1");
		expect(whyJson.ticks[0]?.stage).toBe("wave_execute");
		expect(whyJson.ticks[0]?.goalCount).toBe("2");
		expect(whyJson.why.runId).toBe("operator-json-1");
	});
});
