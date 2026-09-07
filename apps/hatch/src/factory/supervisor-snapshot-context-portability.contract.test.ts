import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
	runFactoryConformanceHarness,
	type FactoryConformanceCommandRequest,
	type FactoryConformanceCommandResult,
} from "./conformance-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = path.resolve(__dirname, "../../../../");

function successfulCommand(command: string): FactoryConformanceCommandResult {
	return {
		ok: true,
		command,
		stdout: "",
		stderr: "",
		exitCode: 0,
		durationMs: 1,
		timedOut: false,
		errorMessage: "",
	};
}

describe("supervisor snapshot context portability contract", () => {
	it("passes external-factory identity fields in supervisor_tick_smoke --context", async () => {
		const acmeFactoryRoot = path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support");
		const commandRequests: FactoryConformanceCommandRequest[] = [];

		const commandRunner = vi.fn((request: FactoryConformanceCommandRequest): FactoryConformanceCommandResult => {
			commandRequests.push(request);
			const commandText = `${request.command} ${request.args.join(" ")}`;
			if (request.args[0] === "run") {
				const runIdIndex = request.args.indexOf("--run-id");
				const runId = runIdIndex >= 0 ? String(request.args[runIdIndex + 1] || "") : "";
				const runsDir = String(request.env.HATCH_RUNS_DIR || "");
				if (runId && runsDir) {
					const runDir = path.join(runsDir, runId);
					mkdirSync(runDir, { recursive: true });
					writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ runId, status: "completed" }, null, 2));
				}
			}
			return successfulCommand(commandText);
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: acmeFactoryRoot,
			repoRoot: REAL_REPO_ROOT,
			phases: [
				"config_schema",
				"graph_validate",
				"benchmark_telemetry",
				"run_dir_isolation",
				"supervisor_tick_smoke",
			],
			commandRunner,
		});

		expect(result.ok).toBe(true);
		const smokeCalls = commandRequests.filter((request) => request.args[0] === "run" && request.args.includes("--context"));
		expect(smokeCalls.length, "expected at least one hatch run supervisor smoke call").toBeGreaterThan(0);

		const smokeCall = smokeCalls[0] as FactoryConformanceCommandRequest;
		const contextIndex = smokeCall.args.indexOf("--context");
		expect(contextIndex).toBeGreaterThanOrEqual(0);
		const contextRaw = String(smokeCall.args[contextIndex + 1] || "");
		const context = JSON.parse(contextRaw) as Record<string, unknown>;
		expect(context["factory_id"]).toBe("acme-support");
		expect(context["gh_repo"]).toBe("acme/support-factory");
		expect(context["control_plane"]).toBe("recallnet/astrochicken");
	});
});
