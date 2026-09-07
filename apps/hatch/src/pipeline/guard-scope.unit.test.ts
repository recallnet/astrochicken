import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureFactoryGuardScope } from "./guard-core.js";
import { incrementGuardCounter } from "./guard.js";
import { createRunState, runDir } from "./run.js";

describe("guard factory scope defaults", () => {
	let root: string;
	let testRunsDir: string;
	let savedFactoryId: string | undefined;
	let savedInstanceId: string | undefined;

	beforeEach(() => {
		// Isolate from any ambient HATCH_FACTORY_ID / HATCH_INSTANCE_ID set by the
		// outer process (e.g. when tests run inside a live factory worktree).
		savedFactoryId = process.env["HATCH_FACTORY_ID"];
		savedInstanceId = process.env["HATCH_INSTANCE_ID"];
		delete process.env["HATCH_FACTORY_ID"];
		delete process.env["HATCH_INSTANCE_ID"];
		root = mkdtempSync(join(tmpdir(), "hatch-guard-scope-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		configureFactoryGuardScope({ guardDir: join(root, ".hatch", "guard") });
		// Isolate from host environment factory identity so config-file lookup is used
		savedFactoryId = process.env["HATCH_FACTORY_ID"];
		savedInstanceId = process.env["HATCH_INSTANCE_ID"];
		delete process.env["HATCH_FACTORY_ID"];
		delete process.env["HATCH_INSTANCE_ID"];
	});

	afterEach(() => {
		// Restore env vars before cleaning up the guard scope config.
		if (savedFactoryId !== undefined) {
			process.env["HATCH_FACTORY_ID"] = savedFactoryId;
		}
		if (savedInstanceId !== undefined) {
			process.env["HATCH_INSTANCE_ID"] = savedInstanceId;
		}
		configureFactoryGuardScope({});
		rmSync(root, { recursive: true, force: true });
		// Restore host environment
		if (savedFactoryId !== undefined) process.env["HATCH_FACTORY_ID"] = savedFactoryId;
		else delete process.env["HATCH_FACTORY_ID"];
		if (savedInstanceId !== undefined) process.env["HATCH_INSTANCE_ID"] = savedInstanceId;
		else delete process.env["HATCH_INSTANCE_ID"];
	});

	it("derives default factory guard scope from pipeline identity when no explicit scope is set", () => {
		const pipelineDir = join(root, "factories", "example-trading");
		mkdirSync(pipelineDir, { recursive: true });
		writeFileSync(
			join(pipelineDir, "factory.config.json"),
			JSON.stringify(
				{
					schema: "hatch.factory.config.v1",
					factory_id: "example-trading",
					factory_root: "factories/example-trading",
					kind_id: "example-trading",
					instance_id: "example-trading",
					target_repo: "example-org/example-trading",
					control_plane_repo: "recallnet/astrochicken",
					dispatch: {
						graph: "factories/example-trading/graphs/factory_supervisor_tick.dot",
					},
				},
				null,
				2,
			),
		);
		const runState = createRunState("guard-run-derived-scope", join(pipelineDir, "graphs", "factory_supervisor_tick.dot"), {
			runsDir: testRunsDir,
		});
		runState.context = {};
		const decision = incrementGuardCounter({
			runState,
			counter: "tool_calls",
			context: {},
			now: new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(decision.allowed).toBe(true);
		expect(runState.guard.factoryScope).toBe("example-trading");
		expect(runState.guard.workerPeriod).toBe("default");
		expect(existsSync(join(root, ".hatch", "guard", "example-trading.default.json"))).toBe(true);
		expect(existsSync(join(root, ".hatch", "guard", "default.default.json"))).toBe(false);
		expect(existsSync(runDir(runState.runId))).toBe(true);
	});
});
