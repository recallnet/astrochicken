import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Functions under test — these don't exist yet, TDD will drive them into existence.
import {
  computeFactoryContractHash,
  detectWaveContractDrift,
  buildContractDriftActionItems,
} from "../src/lib/factory-contract-drift.ts";

function scaffold(tmp) {
  // Minimal factory contract surface
  const skillsDir = join(tmp, "factories", "mothership", "skills", "code_review");
  const graphsDir = join(tmp, "factories", "mothership", "graphs");
  const styDir = join(tmp, "factories", "mothership");
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(graphsDir, { recursive: true });

  writeFileSync(join(skillsDir, "SKILL.md"), "# Code Review\nApprove or revise.\n");
  writeFileSync(join(graphsDir, "wave_execute.dot"), 'digraph { start -> done; }');
  writeFileSync(join(graphsDir, "wave_issue_execute.dot"), 'digraph { start -> build -> done; }');
  writeFileSync(join(styDir, "roles.stylesheet"), 'knowledge_worker { model="gpt-5" }');

  return { skillsDir, graphsDir, styDir };
}

function scaffoldRuns(tmp, runs) {
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });
  for (const r of runs) {
    const runDir = join(runsDir, r.runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "state.json"), JSON.stringify({
      runId: r.runId,
      status: r.status || "completed",
      pipelineFile: r.pipeline || "wave_execute.dot",
      context: r.context || {},
      updatedAt: r.updatedAt || new Date().toISOString(),
    }));
  }
  return runsDir;
}

let tmp;
test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "drift-test-"));
});
test.afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// ─── 1. computeFactoryContractHash ───────────────────────────────

test("computeFactoryContractHash returns deterministic hash of contract surface", () => {
  scaffold(tmp);
  const factoryRoot = join(tmp, "factories", "mothership");

  const hash1 = computeFactoryContractHash({ factoryRoot });
  const hash2 = computeFactoryContractHash({ factoryRoot });

  assert.ok(hash1, "hash should be non-empty");
  assert.match(hash1, /^[a-f0-9]{64}$/, "hash should be a 64-char hex SHA-256");
  assert.equal(hash1, hash2, "same inputs produce same hash");
});

test("computeFactoryContractHash changes when a skill file changes", () => {
  const { skillsDir } = scaffold(tmp);
  const factoryRoot = join(tmp, "factories", "mothership");

  const hashBefore = computeFactoryContractHash({ factoryRoot });

  // Mutate the review skill
  writeFileSync(join(skillsDir, "SKILL.md"), "# Code Review v2\nNew policy: always approve.\n");

  const hashAfter = computeFactoryContractHash({ factoryRoot });
  assert.notEqual(hashBefore, hashAfter, "hash must change when skill content changes");
});

test("computeFactoryContractHash changes when a graph file changes", () => {
  const { graphsDir } = scaffold(tmp);
  const factoryRoot = join(tmp, "factories", "mothership");

  const hashBefore = computeFactoryContractHash({ factoryRoot });

  writeFileSync(join(graphsDir, "wave_execute.dot"), 'digraph { start -> rebase -> merge -> done; }');

  const hashAfter = computeFactoryContractHash({ factoryRoot });
  assert.notEqual(hashBefore, hashAfter, "hash must change when graph content changes");
});

test("computeFactoryContractHash changes when roles.stylesheet changes", () => {
  const { styDir } = scaffold(tmp);
  const factoryRoot = join(tmp, "factories", "mothership");

  const hashBefore = computeFactoryContractHash({ factoryRoot });

  writeFileSync(join(styDir, "roles.stylesheet"), 'knowledge_worker { model="gpt-6" }');

  const hashAfter = computeFactoryContractHash({ factoryRoot });
  assert.notEqual(hashBefore, hashAfter, "hash must change when stylesheet changes");
});

// ─── 2. detectWaveContractDrift ──────────────────────────────────

test("detectWaveContractDrift returns empty when no wave runs have contract hash", () => {
  scaffold(tmp);
  const runsDir = scaffoldRuns(tmp, [
    { runId: "run-1", status: "completed", context: {} },
  ]);

  const result = detectWaveContractDrift({
    runsDir,
    currentHash: "abc123",
    nowMs: Date.now(),
  });

  assert.ok(Array.isArray(result), "result should be array");
  assert.equal(result.length, 0, "no drift when no runs carry contract hash");
});

test("detectWaveContractDrift returns empty when all completed runs match current hash", () => {
  scaffold(tmp);
  const currentHash = "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233";
  const runsDir = scaffoldRuns(tmp, [
    {
      runId: "run-1",
      status: "completed",
      pipeline: "wave_execute.dot",
      context: {
        factory_contract_sha256: currentHash,
        wave_issue_number: "42",
        milestone: "goal-1-wave-1",
      },
    },
  ]);

  const result = detectWaveContractDrift({
    runsDir,
    currentHash,
    nowMs: Date.now(),
  });

  assert.equal(result.length, 0, "no drift when hashes match");
});

test("detectWaveContractDrift detects completed wave run with stale contract hash", () => {
  scaffold(tmp);
  const spawnHash = "aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000";
  const currentHash = "bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111";
  const runsDir = scaffoldRuns(tmp, [
    {
      runId: "run-drift",
      status: "completed",
      pipeline: "wave_execute.dot",
      context: {
        factory_contract_sha256: spawnHash,
        wave_issue_number: "99",
        milestone: "goal-5-wave-2",
      },
    },
  ]);

  const result = detectWaveContractDrift({
    runsDir,
    currentHash,
    nowMs: Date.now(),
  });

  assert.equal(result.length, 1, "should detect one drifted run");
  assert.equal(result[0].run_id, "run-drift");
  assert.equal(result[0].spawn_hash, spawnHash);
  assert.equal(result[0].current_hash, currentHash);
  assert.equal(result[0].wave_issue_number, "99");
  assert.equal(result[0].milestone, "goal-5-wave-2");
});

test("detectWaveContractDrift ignores non-wave pipelines", () => {
  scaffold(tmp);
  const spawnHash = "aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000";
  const currentHash = "bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111";
  const runsDir = scaffoldRuns(tmp, [
    {
      runId: "run-goal",
      status: "completed",
      pipeline: "goal_run.dot",
      context: { factory_contract_sha256: spawnHash },
    },
  ]);

  const result = detectWaveContractDrift({
    runsDir,
    currentHash,
    nowMs: Date.now(),
  });

  assert.equal(result.length, 0, "non-wave pipelines should not trigger drift detection");
});

test("detectWaveContractDrift ignores still-running wave runs", () => {
  scaffold(tmp);
  const spawnHash = "aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000";
  const currentHash = "bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111";
  const runsDir = scaffoldRuns(tmp, [
    {
      runId: "run-active",
      status: "running",
      pipeline: "wave_execute.dot",
      context: { factory_contract_sha256: spawnHash, wave_issue_number: "50" },
    },
  ]);

  const result = detectWaveContractDrift({
    runsDir,
    currentHash,
    nowMs: Date.now(),
  });

  assert.equal(result.length, 0, "running waves should not trigger drift — they haven't finished yet");
});

// ─── 3. buildContractDriftActionItems ────────────────────────────

test("buildContractDriftActionItems builds supervisor action item with correct remediation", () => {
  const driftSignals = [
    {
      run_id: "run-drift",
      spawn_hash: "aaaa",
      current_hash: "bbbb",
      wave_issue_number: "99",
      milestone: "goal-5-wave-2",
      pipeline: "wave_execute.dot",
    },
  ];

  const actionItems = buildContractDriftActionItems({
    signals: driftSignals,
    repo: "recallnet/astrochicken",
  });

  assert.equal(actionItems.length, 1);
  const item = actionItems[0];

  // Must identify itself as contract drift
  assert.match(item.problem, /CONTRACT_DRIFT/i, "problem should contain CONTRACT_DRIFT");
  assert.match(item.problem, /99/, "problem should reference affected issue");

  // Must include drift evidence in diagnostics
  assert.equal(item.diagnostics.spawn_hash, "aaaa");
  assert.equal(item.diagnostics.current_hash, "bbbb");
  assert.equal(item.diagnostics.wave_issue_number, "99");
  assert.equal(item.diagnostics.milestone, "goal-5-wave-2");

  // Must include a remediation packet
  assert.ok(item.remediation_packet, "must include remediation packet");
  assert.equal(item.remediation_packet.packet_type, "contract_drift_wave_cleanup");

  // Remediation must include commands for the supervisor to:
  // 1. Inspect the affected issue
  // 2. Re-queue the wave marker so next tick picks it up fresh
  // 3. Verify the cleanup
  const execCmds = item.remediation_packet.execution_commands;
  assert.ok(execCmds.length > 0, "must include execution commands");
  assert.ok(
    execCmds.some((cmd) => cmd.includes("99") || cmd.includes("wave_issue_number")),
    "execution commands must reference affected issue",
  );

  const verifyCmds = item.remediation_packet.verify_commands;
  assert.ok(verifyCmds.length > 0, "must include verify commands");

  // Postconditions should describe what healthy state looks like
  const postconditions = item.remediation_packet.expected_postconditions;
  assert.ok(postconditions.length > 0, "must describe expected postconditions");
  assert.ok(
    postconditions.some((p) => /next tick|re.?queue|healthy/i.test(p)),
    "postconditions should describe path to healthy next tick",
  );
});

test("buildContractDriftActionItems includes suggested_action for supervisor prompt", () => {
  const driftSignals = [
    {
      run_id: "run-drift",
      spawn_hash: "old",
      current_hash: "new",
      wave_issue_number: "42",
      milestone: "goal-3-wave-1",
      pipeline: "wave_execute.dot",
    },
  ];

  const actionItems = buildContractDriftActionItems({
    signals: driftSignals,
    repo: "recallnet/astrochicken",
  });

  const item = actionItems[0];
  assert.ok(item.suggested_action, "must include suggested_action string for supervisor LLM");
  assert.ok(item.suggested_action.length > 20, "suggested_action should be descriptive enough for LLM");
  // Should tell supervisor to check if the drift is benign or needs requeue
  assert.ok(
    /drift|contract|re.?queue|re.?review|force.?merge/i.test(item.suggested_action),
    "suggested_action should mention drift handling options",
  );
});

test("buildContractDriftActionItems returns empty for no drift signals", () => {
  const actionItems = buildContractDriftActionItems({
    signals: [],
    repo: "recallnet/astrochicken",
  });
  assert.equal(actionItems.length, 0);
});

test("buildContractDriftActionItems handles multiple drifted runs", () => {
  const driftSignals = [
    {
      run_id: "run-a", spawn_hash: "old", current_hash: "new",
      wave_issue_number: "10", milestone: "goal-1-wave-1", pipeline: "wave_execute.dot",
    },
    {
      run_id: "run-b", spawn_hash: "old", current_hash: "new",
      wave_issue_number: "20", milestone: "goal-1-wave-1", pipeline: "wave_execute.dot",
    },
  ];

  const actionItems = buildContractDriftActionItems({
    signals: driftSignals,
    repo: "recallnet/astrochicken",
  });

  // Each drifted run gets its own action item
  assert.equal(actionItems.length, 2);
  assert.match(actionItems[0].problem, /10/);
  assert.match(actionItems[1].problem, /20/);
});
