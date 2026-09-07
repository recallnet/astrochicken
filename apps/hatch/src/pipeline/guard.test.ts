import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { ALIGNMENT_SUMMARY_SCHEMA_VERSION, ALIGNMENT_SUMMARY_TAXONOMY_VERSION, alignmentSummaryPath } from "./decision-artifacts.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { configureFactoryGuardScope } from "./guard-core.js";
import { guardCounterForTransition, incrementGuardCounter, resetGuardBudgets, statusForGuardDecision } from "./guard.js";
import { ToolHandler } from "./handler/tool.js";
import { parse } from "./parse.js";
import { createRunState, loadRunState, readRunAlignmentSummary, runAlignmentSummaryFilePath, runDir, saveRunState } from "./run.js";

import type { Node } from "./graph.js";
const GUARD_TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WRONG_GOAL_DRIFT_HARNESS_DOT = join(GUARD_TEST_DIR, "../../../../packages/factory-ops/test/supervisor/fixtures/wrong-goal-drift-harness.dot");
void readRunAlignmentSummary; void runAlignmentSummaryFilePath; // maintain export coverage
function readAlignmentSummary(runId: string): Record<string, unknown> | null {
	const p = join(runDir(runId), "alignment-summary.json");
	if (!existsSync(p)) return null;
	try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}
function alignmentSummaryFilePath(runId: string): string { return join(runDir(runId), "alignment-summary.json"); }
function guardContext(overrides: Record<string, string> = {}): Record<string, string> { return { guard_factory_scope: "guard-test", guard_worker_period: "period-a", guard_policy_revision: "guard.test.v1", ...overrides }; }

describe("guard budgets and circuit breaker", () => {
	let root: string;
	let testRunsDir: string;
	let previousLockDir: string | undefined;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-guard-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		configureFactoryGuardScope({ guardDir: join(root, ".hatch", "guard") });
		previousLockDir = process.env["HATCH_LOCK_DIR"];
		process.env["HATCH_LOCK_DIR"] = join(root, ".hatch", "locks");
	});

	afterEach(() => {
		configureFactoryGuardScope({});
		if (previousLockDir === undefined) delete process.env["HATCH_LOCK_DIR"];
		else process.env["HATCH_LOCK_DIR"] = previousLockDir;
		rmSync(root, { recursive: true, force: true });
	});
	it("transitions to open on deterministic threshold breach and emits guard artifacts", () => {
		const runState = createRunState("guard-run-open", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_run_max_tool_calls: "1",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "1000",
			guard_backoff_cap_ms: "1000",
		});
		Object.assign(context, { issue_number: "555", branch: "wave/555", milestone_title: "goal-1-wave-1" });
		runState.context = { ...context };

		const first = incrementGuardCounter({ runState, counter: "tool_calls", context, nodeId: "tool_node" });
		expect(first.allowed).toBe(true);

		const second = incrementGuardCounter({ runState, counter: "tool_calls", context, nodeId: "tool_node" });
		expect(second.allowed).toBe(false);
		expect(second.transition).toBe("open");
		expect(second.reasonCode).toBe("run_tool_budget_exceeded");
		expect(second.counter).toBe("tool_calls");
		expect(second.backoffMs).toBe(1000);
		expect(statusForGuardDecision(second)).toBe("guarded");
		expect(runState.guard.metadata?.reasonCode).toBe("run_tool_budget_exceeded");
		expect(runState.guard.metadata?.nodeId).toBe("tool_node");
		expect(runState.guard.metadata?.issueNumber).toBe("555");
		expect(runState.guard.metadata?.branch).toBe("wave/555");
		expect(runState.guard.metadata?.milestoneTitle).toBe("goal-1-wave-1");
		const guardDir = join(runDir(runState.runId), "guard");
		expect(existsSync(guardDir)).toBe(true);
		expect(readdirSync(guardDir).length).toBeGreaterThan(0);

		const eventsPath = join(runDir(runState.runId), "guard-events.jsonl");
		const events = readFileSync(eventsPath, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		expect(events.some((entry) => entry.kind === "guard.transition")).toBe(true);
	});

	it("enters terminal state after repeated retry overflow with replay-safe zero backoff", () => {
		const runState = createRunState("guard-run-terminal", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_factory_scope: "guard-test-terminal",
			guard_worker_period: "period-b",
			guard_run_max_review_retry_calls: "1",
			guard_factory_max_review_retry_calls: "100",
			guard_backoff_base_ms: "0",
			guard_backoff_cap_ms: "0",
			guard_terminal_overflow_count: "2",
		});
		Object.assign(context, { issue_number: "556", branch: "wave/556", milestone_title: "goal-1-wave-2" });
		runState.context = { ...context };

		const t0 = new Date("2026-01-01T00:00:00.000Z");
		const t1 = new Date("2026-01-01T00:00:01.000Z");
		const t2 = new Date("2026-01-01T00:00:02.000Z");

		expect(incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t0 }).allowed).toBe(true);
		const openDecision = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t1 });
		expect(openDecision.transition).toBe("open");
		const terminalDecision = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t2, nodeId: "retry_gate" });
		expect(terminalDecision.allowed).toBe(false);
		expect(terminalDecision.transition).toBe("terminal");
		expect(terminalDecision.circuitState).toBe("terminal");
		expect(terminalDecision.reasonCode).toBe("run_review_retry_budget_exceeded");
		expect(statusForGuardDecision(terminalDecision)).toBe("guarded_terminal");
		expect(runState.guard.metadata?.reasonCode).toBe("run_review_retry_budget_exceeded");
		expect(runState.guard.metadata?.nodeId).toBe("retry_gate");
	});

	it("computes deterministic backoff for equivalent prior state + policy + timestamp", () => {
		const now = new Date("2026-01-02T00:00:00.000Z");
		const contextA = guardContext({
			guard_factory_scope: "guard-determinism-a",
			guard_worker_period: "period-1",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "4000",
			guard_backoff_cap_ms: "4000",
		});
		const contextB = guardContext({
			guard_factory_scope: "guard-determinism-b",
			guard_worker_period: "period-1",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "4000",
			guard_backoff_cap_ms: "4000",
		});

		const runA = createRunState("guard-run-a", "/tmp/sample.dot", { runsDir: testRunsDir });
		runA.context = { ...contextA };
		const runB = createRunState("guard-run-b", "/tmp/sample.dot", { runsDir: testRunsDir });
		runB.context = { ...contextB };

		const decisionA = incrementGuardCounter({ runState: runA, counter: "tool_calls", context: contextA, now });
		const decisionB = incrementGuardCounter({ runState: runB, counter: "tool_calls", context: contextB, now });

		expect(decisionA.allowed).toBe(false);
		expect(decisionB.allowed).toBe(false);
		expect(decisionA.backoffMs).toBe(decisionB.backoffMs);
		expect(decisionA.nextAttemptAt).toBe(decisionB.nextAttemptAt);
		expect(decisionA.transition).toBe(decisionB.transition);
		expect(decisionA.reasonCode).toBe(decisionB.reasonCode);
	});

	it("enforces bounded retry overflow with open-throttle visibility before terminal", () => {
		const runState = createRunState("guard-run-retry-circuit", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_factory_scope: "guard-runaway-retry",
			guard_worker_period: "period-c",
			guard_run_max_review_retry_calls: "1",
			guard_factory_max_review_retry_calls: "100",
			guard_backoff_base_ms: "1000",
			guard_backoff_cap_ms: "8000",
			guard_terminal_overflow_count: "3",
		});
		runState.context = { ...context };

		const t0 = new Date("2026-01-02T00:00:00.000Z");
		const t1 = new Date("2026-01-02T00:00:00.001Z");
		const tOpen = new Date("2026-01-02T00:00:00.100Z");
		const t2 = new Date("2026-01-02T00:00:01.100Z");
		const t3 = new Date("2026-01-02T00:00:03.200Z");

		const warmup = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t0 });
		expect(warmup.allowed).toBe(true);

		const open1 = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t1 });
		expect(open1.allowed).toBe(false);
		expect(open1.transition).toBe("open");
		expect(open1.backoffMs).toBe(1000);

		const throttled = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: tOpen });
		expect(throttled.allowed).toBe(false);
		expect(throttled.reasonCode).toBe("guard_backoff_active");
		expect(throttled.circuitState).toBe("open");

		const open2 = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t2 });
		expect(open2.allowed).toBe(false);
		expect(open2.transition).toBe("open");
		expect(open2.backoffMs).toBe(2000);

		const terminal = incrementGuardCounter({ runState, counter: "review_retry_calls", context, now: t3 });
		expect(terminal.allowed).toBe(false);
		expect(terminal.transition).toBe("terminal");
		expect(terminal.circuitState).toBe("terminal");
	});

	it("increments review-retry counter only for re-entry attempts, not first build attempt", () => {
		expect(guardCounterForTransition("init_review_attempt", "build", {})).toBeNull();
		expect(guardCounterForTransition("retry_gate", "build", {})).toBe("review_retry_calls");
		expect(guardCounterForTransition("some_node", "build", { review_verdict: "revise" })).toBe("review_retry_calls");
	});

	it("rehydrates guarded state after restart and short-circuits deterministically", async () => {
		const graph = parse(`
	digraph guard_restart {
		start [shape=Mdiamond]
		run [shape=parallelogram prompt="echo guarded"]
		done [shape=Msquare]
		start -> run -> done
	}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", new ToolHandler(".", graph));

		const runState = createRunState("guard-restart", "/tmp/guard_restart.dot", { runsDir: testRunsDir });
		const contextValues = guardContext({
			guard_factory_scope: "guard-restart-scope",
			guard_worker_period: "period-restart",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "600000",
			guard_backoff_cap_ms: "600000",
		});
		runState.context = { ...contextValues };

		const engine = new Engine(graph, registry, { runState, context: new Context(contextValues) });
		await engine.run();
		expect(runState.status).toBe("guarded");

		const persisted = loadRunState(runState.runId);
		expect(persisted).not.toBeNull();
		expect(persisted?.status).toBe("guarded");
		expect(persisted?.guard.circuitState).toBe("open");

		const restartContext = new Context(persisted?.context || contextValues);
		const restartEngine = new Engine(graph, registry, { runState: persisted!, context: restartContext });
		await restartEngine.run();
		const reloaded = loadRunState(runState.runId);
		expect(reloaded?.status).toBe("guarded");
		const completedIds = (reloaded?.completedNodes || []).map((entry) => entry.id);
		expect(completedIds.every((id) => id === "start")).toBe(true);
	});

	it("enforces reset-only recovery with ownership checks", () => {
		const runState = createRunState("guard-reset", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_factory_scope: "guard-reset-scope",
			guard_worker_period: "period-reset",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "0",
			guard_backoff_cap_ms: "0",
		});
		runState.context = { ...context };
		incrementGuardCounter({ runState, counter: "tool_calls", context, now: new Date("2026-01-03T00:00:00.000Z") });
		expect(runState.guard.circuitState).toBe("open");

		const denied = resetGuardBudgets({ runState, actorId: "run:someone-else", context });
		expect(denied.ok).toBe(false);
		expect(denied.reason).toBe("owner_mismatch");

		const applied = resetGuardBudgets({ runState, actorId: runState.guard.owner.ownerId, context });
		expect(applied.ok).toBe(true);
		expect(applied.runState.circuitState).toBe("closed");
		expect(applied.runState.counters.tool_calls).toBe(0);
		expect(applied.factoryState.counters.tool_calls).toBe(0);
		expect(applied.artifactPath.length).toBeGreaterThan(0);
		expect(existsSync(applied.artifactPath)).toBe(true);
	});

	it("does not mutate run guard state when factory owner check denies reset", () => {
		const runState = createRunState("guard-reset-denied", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_factory_scope: "guard-reset-owner-scope",
			guard_worker_period: "period-owner",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "0",
			guard_backoff_cap_ms: "0",
		});
		runState.context = { ...context };
		incrementGuardCounter({ runState, counter: "tool_calls", context, now: new Date("2026-01-04T00:00:00.000Z") });
		expect(runState.guard.circuitState).toBe("open");

		const guardDir = join(root, ".hatch", "guard");
		const factoryPath = join(guardDir, "guard-reset-owner-scope.period-owner.json");
		mkdirSync(guardDir, { recursive: true });
		writeFileSync(
			factoryPath,
			JSON.stringify(
				{
					schemaVersion: 1,
					factoryScope: "guard-reset-owner-scope",
					workerPeriod: "period-owner",
					policyRevision: "guard.test.v1",
					counters: { tool_calls: 5, llm_calls: 0, review_retry_calls: 0, pipeline_transition_calls: 0 },
					circuitState: "open",
					reasonCode: "factory_tool_budget_exceeded",
					overflowCount: 1,
					openedAt: "2026-01-04T00:00:00.000Z",
					expiresAt: "2026-01-05T00:00:00.000Z",
					terminalAt: "",
					lastDecisionAt: "2026-01-04T00:00:00.000Z",
					lastDecisionType: "open",
					resetCount: 0,
					owner: { ownerId: "run:other-owner", leaseName: "", leaseGeneration: 0 },
					updatedAt: "2026-01-04T00:00:00.000Z",
				},
				null,
				2,
			),
		);

		const before = JSON.parse(JSON.stringify(runState.guard));
		const denied = resetGuardBudgets({ runState, actorId: runState.guard.owner.ownerId, context });
		expect(denied.ok).toBe(false);
		expect(denied.reason).toBe("factory_owner_mismatch");
		expect(runState.guard).toEqual(before);
	});
});

class StaticNodeOutputHandler implements Handler {
	constructor(private readonly outputsByNode: Record<string, Outcome>) {}

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		return this.outputsByNode[node.id] ?? { status: StageStatus.Completed, output: "" };
	}
}

function listDecisionRecordFiles(runId: string): string[] {
	return readdirSync(join(runDir(runId), "decisions"))
		.filter((name) => /^\d+\..+\.attempt-\d+\.json$/.test(name))
		.sort((a, b) => a.localeCompare(b));
}

function listDecisionRecordFilesFromDir(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => /^\d+\..+\.attempt-\d+\.json$/.test(name))
		.sort((a, b) => a.localeCompare(b));
}

describe("judge output alignment schema enforcement", () => {
	let root: string;
	let testRunsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-judge-schema-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("supports deterministic pass path with canonical schema + intent fallback objective mapping", async () => {
		const graph = parse(`
			digraph judge_pass_path {
				intent_ref="intent.recallnet.alignment"
				intent_profile="enterprise"
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_key="judge_result" output_format="json" outputs="pass,decision,review_notes" judge_required_evidence="qa_command"]
				accept [type="codergen" output_key="route"]
				revise [type="codergen" output_key="route"]
				done [shape=Msquare]
				start -> judge
				judge -> accept [condition="pass=true"]
				judge -> revise [condition="pass!=true"]
				accept -> done
				revise -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						alignment_score: 0.97,
						constraint_violations: [],
						missing_evidence: [],
						recommendations: [],
						pass: true,
					}),
				},
				accept: { status: StageStatus.Completed, output: "accept" },
				revise: { status: StageStatus.Completed, output: "revise" },
			}),
		);

		const context = new Context({ qa_command: "npm run test" });
		const engine = new Engine(graph, registry, { context, runState: createRunState("judge-pass-path", "/tmp/judge_pass_path.dot", { runsDir: testRunsDir }) });
		await engine.run();

		expect(engine.getContext().get("route")).toBe("accept");
		expect(engine.getContext().get("pass")).toBe("true");
		const normalized = JSON.parse(engine.getContext().get("judge_result"));
		expect(normalized.objective_id).toBe("intent.recallnet.alignment@enterprise");
		expect(normalized.judge_rubric).toBe("alignment.enterprise");
		expect(normalized.decision).toBe("approved");
	});

	it("forces pass=false and deterministic missing_evidence when required evidence is absent", async () => {
		const graph = parse(`
			digraph judge_missing_evidence {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" objective_id="obj.explicit" output_key="judge_result" output_format="json" outputs="pass,decision,review_notes" judge_required_evidence="qa_command,artifact.path"]
				accept [type="codergen" output_key="route"]
				revise [type="codergen" output_key="route"]
				done [shape=Msquare]
				start -> judge
				judge -> accept [condition="pass=true"]
				judge -> revise [condition="pass!=true"]
				accept -> done
				revise -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						alignment_score: 0.91,
						constraint_violations: [],
						missing_evidence: [],
						recommendations: ["initial recommendation"],
						pass: true,
					}),
				},
				accept: { status: StageStatus.Completed, output: "accept" },
				revise: { status: StageStatus.Completed, output: "revise" },
			}),
		);

		const context = new Context({ qa_command: "" });
		const engine = new Engine(graph, registry, { context, runState: createRunState("judge-missing-evidence", "/tmp/judge_missing_evidence.dot", { runsDir: testRunsDir }) });
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		expect(engine.getContext().get("pass")).toBe("false");
		const normalized = JSON.parse(engine.getContext().get("judge_result"));
		expect(normalized.objective_id).toBe("obj.explicit");
		expect(normalized.missing_evidence).toEqual(["artifact.path", "qa_command"]);
		expect(normalized.decision).toBe("revise");
	});

	it("fails malformed judge output with deterministic diagnostics and does not leak pass context", async () => {
		const graph = parse(`
			digraph judge_invalid_output {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_key="judge_result" output_format="json" outputs="pass,decision"]
				accept [type="codergen" output_key="route"]
				revise [type="codergen" output_key="route"]
				done [shape=Msquare]
				start -> judge
				judge -> accept [condition="pass=true"]
				judge -> revise [condition="pass!=true"]
				accept -> done
				revise -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ pass: "true" }),
				},
				accept: { status: StageStatus.Completed, output: "accept" },
				revise: { status: StageStatus.Completed, output: "revise" },
			}),
		);

		const engine = new Engine(graph, registry, { context: new Context(), runState: createRunState("judge-invalid-output", "/tmp/judge_invalid_output.dot", { runsDir: testRunsDir }) });
		await engine.run();

		expect(engine.getContext().get("route")).toBe("revise");
		expect(engine.getContext().get("pass")).toBe("");
		const records = engine.getRecords();
		const judgeRecord = records.find((record) => record.nodeId === "judge");
		expect(judgeRecord?.outcome?.status).toBe(StageStatus.Failed);
		expect(judgeRecord?.outcome?.error).toContain('"code":"judge_output_invalid"');
	});

	it("adapts legacy judge output format deterministically", async () => {
		const graph = parse(`
			digraph judge_legacy_adapter {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_key="judge_result" output_format="json" outputs="pass,decision,review_notes,human_questions_md"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "revise", review_notes: "missing tests", human_questions_md: "" }),
				},
			}),
		);

		const engine = new Engine(graph, registry, { context: new Context(), runState: createRunState("judge-legacy-adapter", "/tmp/judge_legacy_adapter.dot", { runsDir: testRunsDir }) });
		await engine.run();

		expect(engine.getContext().get("pass")).toBe("false");
		expect(engine.getContext().get("decision")).toBe("revise");
		expect(engine.getContext().get("review_notes")).toBe("missing tests");
		const normalized = JSON.parse(engine.getContext().get("judge_result"));
		expect(normalized.constraint_violations).toEqual([]);
		expect(normalized.recommendations).toEqual(["missing tests"]);
	});
});

describe("decision artifact emission", () => {
	let root: string;
	let testRunsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-decision-artifact-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("emits schema-validated decision artifact for eligible judge node with deterministic filename", async () => {
		const graph = parse(`
			digraph decision_artifact_judge {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" objective_id="goal.444.judge" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						decision: "approved",
						tradeoff_applied: "speed_over_scope",
						options_considered: ["accept", "revise"],
						evidence: "scenario checks pass",
						risk_assessment: "low",
						escalation: false,
					}),
				},
			}),
		);

		const runState = createRunState("decision-artifact-judge", "/tmp/decision_artifact_judge.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("1");
		const dir = join(runDir(runState.runId), "decisions");
		expect(existsSync(dir)).toBe(true);
		const files = listDecisionRecordFilesFromDir(dir);
		expect(files).toEqual(["0001.judge.attempt-1.json"]);

		const artifact = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
		expect(artifact.schema_version).toBe("hatch.decision.v1");
		expect(artifact.node_id).toBe("judge");
		expect(artifact.objective_id).toBe("goal.444.judge");
		expect(artifact.objective_id_source).toBe("node.objective_id");
		expect(artifact.marker).toBe("judge");
		expect(artifact.judge_verdict).toBe("pass");
		expect(Array.isArray(artifact.options_considered)).toBe(true);
		expect(typeof artifact.escalation).toBe("boolean");
		expect(typeof artifact.decision_id).toBe("string");
		expect(typeof artifact.intent_hash).toBe("string");
		expect(typeof artifact.tradeoff_applied).toBe("string");
		expect(typeof artifact.decision).toBe("string");
		expect(typeof artifact.evidence).toBe("string");
		expect(typeof artifact.risk_assessment).toBe("string");
	});

	it("uses stable objective_id fallback intent_ref@intent_profile when objective_id is unset", async () => {
		const graph = parse(`
			digraph decision_artifact_objective_fallback {
				intent_ref="intent.sample.feature"
				intent_profile="enterprise"
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "revise" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-objective", "/tmp/decision_artifact_objective.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		const files = listDecisionRecordFiles(runState.runId);
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", files[0]), "utf8"));
		expect(artifact.objective_id).toBe("intent.sample.feature@enterprise");
		expect(artifact.objective_id_source).toBe("intent.identity");
	});

	it("prefers explicit objective_id over intent fallback identity mapping", async () => {
		const graph = parse(`
			digraph decision_artifact_objective_precedence {
				intent_ref="intent.sample.feature"
				intent_profile="enterprise"
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" objective_id="objective.explicit" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-objective-precedence", "/tmp/decision_artifact_objective_precedence.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		const files = listDecisionRecordFiles(runState.runId);
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", files[0]), "utf8"));
		expect(artifact.objective_id).toBe("objective.explicit");
		expect(artifact.objective_id_source).toBe("node.objective_id");
	});

	it("uses intent.unbound objective mapping source when no explicit objective or intent identity is available", async () => {
		const graph = parse(`
			digraph decision_artifact_objective_unbound {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-objective-unbound", "/tmp/decision_artifact_objective_unbound.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		const files = listDecisionRecordFiles(runState.runId);
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", files[0]), "utf8"));
		expect(artifact.objective_id).toBe("intent.unbound");
		expect(artifact.objective_id_source).toBe("intent.unbound");
	});

	it("legacy decision marker output_key=decision emits decision artifact without explicit marker", async () => {
		const graph = parse(`
			digraph decision_artifact_legacy_marker {
				start [shape=Mdiamond]
				decide [type="codergen" output_key="decision" output_format="json"]
				done [shape=Msquare]
				start -> decide -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				decide: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved", evidence: "legacy marker path" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-legacy", "/tmp/decision_artifact_legacy.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("1");
		const files = listDecisionRecordFiles(runState.runId);
		expect(files).toEqual(["0001.decide.attempt-1.json"]);
	});

	it("legacy decision marker extracts scalar plain-text decisions", async () => {
		const graph = parse(`
			digraph decision_artifact_legacy_scalar {
				start [shape=Mdiamond]
				decide [type="codergen" output_key="decision"]
				done [shape=Msquare]
				start -> decide -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				decide: {
					status: StageStatus.Completed,
					output: "approved",
				},
			}),
		);

		const runState = createRunState("decision-artifact-legacy-scalar", "/tmp/decision_artifact_legacy_scalar.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		const files = listDecisionRecordFiles(runState.runId);
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", files[0]), "utf8"));
		expect(artifact.decision).toBe("approved");
	});

	it("governance_decision and decision_record markers emit artifacts under decisions directory", async () => {
		const graph = parse(`
			digraph decision_artifact_governance_markers {
				start [shape=Mdiamond]
				govern [type="codergen" governance_decision="approved" output_format="json"]
				record [type="codergen" decision_record="true" output_format="json"]
				done [shape=Msquare]
				start -> govern -> record -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				govern: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved", evidence: "governance decision marker path" }),
				},
				record: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "revise", evidence: "decision record marker path" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-governance-markers", "/tmp/decision_artifact_governance_markers.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("2");
		const files = listDecisionRecordFiles(runState.runId);
		expect(files).toEqual(["0001.govern.attempt-1.json", "0002.record.attempt-1.json"]);
	});

	it("tracks alignment decision counters deterministically for eligible-only nodes", async () => {
		const graph = parse(`
			digraph decision_artifact_counter_alignment {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				noop [type="codergen" output_format="json"]
				record [type="codergen" decision_record="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> noop -> record -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved", evidence: "judge path" }),
				},
				noop: {
					status: StageStatus.Completed,
					output: JSON.stringify({ note: "not decision eligible" }),
				},
				record: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "revise", evidence: "record marker path" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-counter-alignment", "/tmp/decision_artifact_counter_alignment.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("2");
		expect(engine.getContext().get("__decision_record_seq")).toBe("2");
		const files = listDecisionRecordFiles(runState.runId);
		expect(files).toContain("0001.judge.attempt-1.json");
		expect(files).toContain("0002.record.attempt-1.json");

		const summary = JSON.parse(readFileSync(alignmentSummaryPath(runState.runId), "utf8"));
		expect(summary.schema_version).toBe(ALIGNMENT_SUMMARY_SCHEMA_VERSION);
		expect(summary.taxonomy_version).toBe(ALIGNMENT_SUMMARY_TAXONOMY_VERSION);
		expect(summary.run_id).toBe(runState.runId);
		expect(summary.decision_records_count).toBe(2);
		expect(summary.judge_pass_count).toBe(1);
		expect(summary.judge_fail_count).toBe(1);
		expect(summary.needs_review_count).toBe(0);
		expect(summary.intent_violations_count).toBe(0);
		expect(summary.escalations_count).toBe(0);
		expect(summary.blocked_actions_count).toBe(0);
		expect(summary.objective_mapping_rule).toBe("objective_id=node.objective_id|intent.identity|intent.unbound");
		expect(engine.getContext().get("judge_pass_count")).toBe("1");
		expect(engine.getContext().get("judge_fail_count")).toBe("1");
		expect(engine.getContext().get("needs_review_count")).toBe("0");
		expect(engine.getContext().get("intent_violations_count")).toBe("0");
		expect(engine.getContext().get("escalations_count")).toBe("0");
		expect(engine.getContext().get("blocked_actions_count")).toBe("0");
	});

	it("routes wrong-goal expected failure using canonical fixture in non-interactive mode", async () => {
		const fixture = readFileSync(new URL("./fixtures/wrong-goal-expected-failure.dot", import.meta.url), "utf8");
		const graph = parse(fixture);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				enforce: {
					status: StageStatus.Failed,
					output: JSON.stringify({ decision: "blocked", evidence: "wrong_goal_detected", escalation: true }),
					error: "wrong goal optimization blocked",
				},
				expected_failure: {
					status: StageStatus.Completed,
					output: "expected_failure",
				},
			}),
		);

		const runState = createRunState("decision-artifact-wrong-goal-harness", "/tmp/decision_artifact_wrong_goal_harness.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("harness_result")).toBe("expected_failure");
		expect(engine.getContext().get("decision_records_count")).toBe("1");
		const files = listDecisionRecordFiles(runState.runId);
		expect(files).toContain("0001.enforce.attempt-1.json");
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", "0001.enforce.attempt-1.json"), "utf8"));
		expect(artifact.decision).toBe("blocked");

		const summary = JSON.parse(readFileSync(alignmentSummaryPath(runState.runId), "utf8"));
		expect(summary.schema_version).toBe(ALIGNMENT_SUMMARY_SCHEMA_VERSION);
		expect(summary.taxonomy_version).toBe(ALIGNMENT_SUMMARY_TAXONOMY_VERSION);
		expect(summary.objective_mapping_rule).toBe("objective_id=node.objective_id|intent.identity|intent.unbound");
		expect(summary.decision_records_count).toBe(1);
		expect(summary.judge_pass_count).toBe(0);
		expect(summary.judge_fail_count).toBe(1);
		expect(summary.needs_review_count).toBe(0);
		expect(summary.intent_violations_count).toBe(1);
		expect(summary.escalations_count).toBe(1);
		expect(summary.blocked_actions_count).toBe(1);
	});

	it("violation-marked nodes emit through the same decision artifact path", async () => {
		const graph = parse(`
			digraph decision_artifact_violation {
				start [shape=Mdiamond]
				enforce [type="codergen" violation="true" output_format="json"]
				done [shape=Msquare]
				start -> enforce -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				enforce: {
					status: StageStatus.Failed,
					output: JSON.stringify({ decision: "blocked", evidence: "wrong_goal_detected", escalation: true }),
					error: "wrong goal optimization blocked",
				},
			}),
		);

		const runState = createRunState("decision-artifact-violation", "/tmp/decision_artifact_violation.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("1");
		const files = listDecisionRecordFiles(runState.runId);
		expect(files).toEqual(["0001.enforce.attempt-1.json"]);
		const artifact = JSON.parse(readFileSync(join(runDir(runState.runId), "decisions", files[0]), "utf8"));
		expect(artifact.decision).toBe("blocked");
		expect(artifact.marker).toBe("violation");
		expect(artifact.intent_violation).toBe(true);
		expect(artifact.blocked_action).toBe(true);
		expect(artifact.escalation).toBe(true);
	});

	it("resumed runs continue artifact sequencing and decision_records_count from existing decisions dir", async () => {
		const graph = parse(`
			digraph decision_artifact_resume {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-resume", "/tmp/decision_artifact_resume.dot", { runsDir: testRunsDir });
		const dir = join(runDir(runState.runId), "decisions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "0001.prior.attempt-1.json"), JSON.stringify({ existing: true }));

		const context = new Context({ decision_records_count: "0" });
		const engine = new Engine(graph, registry, { context, runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("2");
		const files = listDecisionRecordFilesFromDir(dir);
		expect(files).toEqual(["0001.prior.attempt-1.json", "0002.judge.attempt-1.json"]);
	});

	it("resumed runs rehydrate from highest existing numeric prefix even with non-contiguous files", async () => {
		const graph = parse(`
			digraph decision_artifact_resume_gapped {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-resume-gapped", "/tmp/decision_artifact_resume_gapped.dot", { runsDir: testRunsDir });
		const dir = join(runDir(runState.runId), "decisions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "0001.prior.attempt-1.json"), JSON.stringify({ existing: true }));
		writeFileSync(join(dir, "0003.prior.attempt-1.json"), JSON.stringify({ existing: true }));

		const context = new Context({ decision_records_count: "0" });
		const engine = new Engine(graph, registry, { context, runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("4");
		const files = new Set(listDecisionRecordFilesFromDir(dir));
		expect(files.has("0004.judge.attempt-1.json")).toBe(true);
	});

	it("resumed runs parse 5+ digit decision prefixes and continue at max+1", async () => {
		const graph = parse(`
			digraph decision_artifact_resume_large_prefix {
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "approved" }),
				},
			}),
		);

		const runState = createRunState("decision-artifact-resume-large-prefix", "/tmp/decision_artifact_resume_large_prefix.dot", { runsDir: testRunsDir });
		const dir = join(runDir(runState.runId), "decisions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "9999.prior.attempt-1.json"), JSON.stringify({ existing: true }));
		writeFileSync(join(dir, "10000.prior.attempt-1.json"), JSON.stringify({ existing: true }));

		const context = new Context({ decision_records_count: "0" });
		const engine = new Engine(graph, registry, { context, runState });
		await engine.run();

		expect(engine.getContext().get("decision_records_count")).toBe("10001");
		const files = new Set(listDecisionRecordFilesFromDir(dir));
		expect(files.has("10001.judge.attempt-1.json")).toBe(true);
	});
});

describe("run alignment summary emission", () => {
	let root: string;
	let testRunsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-alignment-summary-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("writes deterministic alignment-summary.json on completed terminal transition with required counters", async () => {
		const graph = parse(`
			digraph alignment_summary_terminal {
				intent_ref="intent.sample.feature"
				intent_profile="enterprise"
				start [shape=Mdiamond]
				judge [type="codergen" judge="true" objective_id="goal.explicit" output_format="json"]
				review [type="codergen" decision_record="true" output_format="json"]
				enforce [type="codergen" violation="true" output_format="json"]
				done [shape=Msquare]
				start -> judge -> review -> enforce -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				judge: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						alignment_score: 0.99,
						constraint_violations: [],
						missing_evidence: [],
						recommendations: [],
						pass: true,
					}),
				},
				review: {
					status: StageStatus.Completed,
					output: JSON.stringify({ decision: "revise", evidence: "follow-up required" }),
				},
				enforce: {
					status: StageStatus.Failed,
					output: JSON.stringify({ decision: "blocked", escalation: true, intent_violation: true }),
				},
			}),
		);

		const runState = createRunState("alignment-summary-completed", "/tmp/alignment_summary_terminal.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		const summaryPath = alignmentSummaryFilePath(runState.runId);
		expect(existsSync(summaryPath)).toBe(true);
		const summary = readAlignmentSummary(runState.runId);
		expect(summary).not.toBeNull();
		expect(summary?.schema_version).toBe("hatch.run_alignment_summary.v1");
		expect(summary?.counter_taxonomy_version).toBe("hatch.alignment_counters.v1");
		expect(summary?.status).toBe("completed");
		expect(summary?.decision_records_count).toBe(3);
		expect(summary?.judge_pass_count).toBe(1);
		expect(summary?.judge_fail_count).toBe(0);
		expect(summary?.needs_review_count).toBe(2);
		expect(summary?.intent_violations_count).toBe(1);
		expect(summary?.escalations_count).toBe(1);
		expect(summary?.blocked_actions_count).toBe(1);

		const explicitObjective = summary?.objective_counters.find((row) => row.objective_id === "goal.explicit");
		expect(explicitObjective?.objective_id_source).toBe("node.objective_id");
		const fallbackObjective = summary?.objective_counters.find((row) => row.objective_id === "intent.sample.feature@enterprise");
		expect(fallbackObjective?.objective_id_source).toBe("intent.identity");
	});

	it("executes wrong-goal drift harness with deterministic non-pass violation/escalation artifacts", async () => {
		const graph = parse(readFileSync(WRONG_GOAL_DRIFT_HARNESS_DOT, "utf8"));

		const registry = new HandlerRegistry();
		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				local_optimize: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						local_score: 0.99,
						selected_option: "maximize_local_score",
					}),
				},
				judge_alignment: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						alignment_score: 0.11,
						constraint_violations: ["wrong_goal.local_score_maximization"],
						missing_evidence: [],
						recommendations: ["Reject local optimum and enforce intent constraints"],
						pass: false,
					}),
				},
				escalate_misalignment: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						decision: "escalate",
						escalation: true,
						evidence: "deterministic wrong-goal drift detected",
					}),
				},
				block_wrong_goal: {
					status: StageStatus.Failed,
					output: JSON.stringify({
						decision: "blocked",
						escalation: true,
						constraint_violations: ["wrong_goal.local_score_maximization"],
						intent_violation: true,
					}),
				},
			}),
		);

		const runState = createRunState("wrong-goal-drift-harness", WRONG_GOAL_DRIFT_HARNESS_DOT, { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, { context: new Context(), runState });
		await engine.run();

		expect(engine.getContext().get("pass")).toBe("false");
		const normalizedJudgeResult = JSON.parse(engine.getContext().get("judge_result"));
		expect(normalizedJudgeResult.objective_id).toBe("goal.intent_alignment.guardrail");
		expect(normalizedJudgeResult.pass).toBe(false);

		const decisionsDir = join(runDir(runState.runId), "decisions");
		const decisionFiles = listDecisionRecordFiles(runState.runId);
		expect(decisionFiles.length).toBe(3);
		const decisionArtifacts = decisionFiles.map((name) => JSON.parse(readFileSync(join(decisionsDir, name), "utf8")));
		const markers = decisionArtifacts.map((artifact) => artifact.marker).sort((a, b) => a.localeCompare(b));
		expect(markers).toEqual(["escalation", "judge", "violation"]);

		const judgeArtifact = decisionArtifacts.find((artifact) => artifact.marker === "judge");
		expect(judgeArtifact?.objective_id).toBe("goal.intent_alignment.guardrail");
		expect(judgeArtifact?.objective_id_source).toBe("node.objective_id");
		expect(judgeArtifact?.judge_verdict).toBe("fail");

		const escalationArtifact = decisionArtifacts.find((artifact) => artifact.marker === "escalation");
		expect(escalationArtifact?.escalation).toBe(true);
		expect(escalationArtifact?.objective_id).toBe("intent.default@default");
		expect(escalationArtifact?.objective_id_source).toBe("intent.identity");

		const violationArtifact = decisionArtifacts.find((artifact) => artifact.marker === "violation");
		expect(violationArtifact?.decision).toBe("blocked");
		expect(violationArtifact?.intent_violation).toBe(true);
		expect(violationArtifact?.blocked_action).toBe(true);

		const summary = readAlignmentSummary(runState.runId);
		expect(summary?.status).toBe("completed");
		expect(summary?.decision_records_count).toBe(3);
		expect(summary?.judge_pass_count).toBe(0);
		expect(summary?.judge_fail_count).toBe(1);
		expect(summary?.needs_review_count).toBe(3);
		expect(summary?.intent_violations_count).toBe(2);
		expect(summary?.escalations_count).toBe(2);
		expect(summary?.blocked_actions_count).toBe(1);
	});

	it("writes alignment summary for failed, guarded, and guarded_terminal terminal statuses", () => {
		const failed = createRunState("alignment-summary-failed", "/tmp/failed.dot", { runsDir: testRunsDir });
		failed.status = "failed";
		saveRunState(failed, { updateMetadata: true, updatePid: false });
		expect(readAlignmentSummary(failed.runId)?.status).toBe("failed");

		const guarded = createRunState("alignment-summary-guarded", "/tmp/guarded.dot", { runsDir: testRunsDir });
		guarded.status = "guarded";
		saveRunState(guarded, { updateMetadata: true, updatePid: false });
		const guardedSummary = readAlignmentSummary(guarded.runId);
		expect(guardedSummary?.status).toBe("guarded");
		expect(guardedSummary?.blocked_actions_count).toBe(1);

		const guardedTerminal = createRunState("alignment-summary-guarded-terminal", "/tmp/guarded_terminal.dot", { runsDir: testRunsDir });
		guardedTerminal.status = "guarded_terminal";
		guardedTerminal.guard.terminalAt = "2026-01-01T00:00:00.000Z";
		saveRunState(guardedTerminal, { updateMetadata: true, updatePid: false });
		const guardedTerminalSummary = readAlignmentSummary(guardedTerminal.runId);
		expect(guardedTerminalSummary?.status).toBe("guarded_terminal");
		expect(guardedTerminalSummary?.terminal_at).toBe("2026-01-01T00:00:00.000Z");
		expect(guardedTerminalSummary?.blocked_actions_count).toBe(1);
	});
});
