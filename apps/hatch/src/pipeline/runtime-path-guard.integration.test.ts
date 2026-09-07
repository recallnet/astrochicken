import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { saveCheckpoint } from "./checkpoint.js";
import { Context, StageStatus } from "./context.js";
import { emitDecisionArtifact } from "./decision-artifacts.js";
import { configureRunStorageScope } from "./run.js";

const ENV_KEYS = ["FACTORY_CONTEXT_REPO_PATH", "HATCH_CANONICAL_CHECKOUT_PATH", "HATCH_RUNS_DIR"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
const cleanupDirs: string[] = [];

afterEach(() => {
	for (const dir of cleanupDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	configureRunStorageScope({ runsDir: ".hatch/runs" });
});

describe("runtime path guard", () => {
	it("refuses to scope run state inside a missing configured repo path", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-runtime-guard-"));
		cleanupDirs.push(root);
		const repoPath = join(root, "destroyed-checkout");
		const runsPath = join(repoPath, ".hatch", "mothership", "runs");
		process.env.FACTORY_CONTEXT_REPO_PATH = repoPath;

		expect(() => configureRunStorageScope({ runsDir: runsPath })).toThrow(/refusing_write label=runs_dir/);
		expect(existsSync(repoPath)).toBe(false);
	});

	it("refuses checkpoint writes that would recreate a destroyed checkout shell", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-checkpoint-guard-"));
		cleanupDirs.push(root);
		const repoPath = join(root, "destroyed-checkout");
		process.env.FACTORY_CONTEXT_REPO_PATH = repoPath;

		expect(() => saveCheckpoint(join(repoPath, "graphs", ".hatch-checkpoint-demo.json"), {
			pipelineFile: join(repoPath, "graphs", "demo.dot"),
			currentNodeId: "review",
			lastOutput: "{}",
			context: {},
			records: [],
			savedAt: "2026-03-12T00:00:00.000Z",
		})).toThrow(/refusing_write label=checkpoint_path/);
		expect(existsSync(repoPath)).toBe(false);
	});

	it("refuses decision artifact writes under a missing configured repo path", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-artifact-guard-"));
		cleanupDirs.push(root);
		const repoPath = join(root, "destroyed-checkout");
		process.env.FACTORY_CONTEXT_REPO_PATH = repoPath;
		process.env.HATCH_RUNS_DIR = join(repoPath, ".hatch", "mothership", "runs");
		expect(() => configureRunStorageScope()).toThrow(/refusing_write label=runs_dir/);

		expect(() => emitDecisionArtifact({
			runState: {
				runId: "run-guard-1",
				pipelineFile: "graphs/demo.dot",
				pipeline: "graphs/demo.dot",
				pid: process.pid,
				status: "running",
				startedAt: "2026-03-12T00:00:00.000Z",
				updatedAt: "2026-03-12T00:00:00.000Z",
				currentNode: "",
				lastOutput: "",
				context: {},
				completedNodes: [],
				activeChildren: {},
				locksHeld: [],
				records: [],
				guard: {
					policyRevision: "guard.v1",
					factoryScope: "default",
					workerPeriod: "default",
					counters: { tool_calls: 0, llm_calls: 0, review_retry_calls: 0, pipeline_transition_calls: 0 },
					factoryCounters: { tool_calls: 0, llm_calls: 0, review_retry_calls: 0, pipeline_transition_calls: 0 },
					circuitState: "closed",
					reasonCode: "",
					metadata: null,
					overflowCount: 0,
					openedAt: "",
					expiresAt: "",
					terminalAt: "",
					lastDecisionAt: "",
					lastDecisionType: "",
					resetCount: 0,
					owner: { ownerId: "run:run-guard-1", leaseName: "", leaseGeneration: 0 },
				},
				schemaVersion: 2,
			},
			node: { id: "review_decision", attrs: { judge: "true", objective_id: "goal-1" } } as any,
			outcome: { status: StageStatus.Completed, output: "{\"decision\":\"approved\",\"judge_verdict\":\"pass\"}" },
			ctx: new Context(),
			attempt: 1,
			pipeline: "graphs/demo.dot",
		})).toThrow(/refusing_write label=decision_artifact_path/);
		expect(existsSync(repoPath)).toBe(false);
	});
});
