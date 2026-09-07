import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildJudgeRecoveryPacket } from "../../src/commands/judge-recovery-packet.ts";

test("buildJudgeRecoveryPacket persists durable remediation packet with packetized recovery context", () => {
  const repo = mkdtempSync(join(tmpdir(), "judge-recovery-packet-"));
  const out = buildJudgeRecoveryPacket({
    repo,
    packetType: "judge_context_contract_recovery",
    judgeKind: "wave_execution_post_merge",
    milestoneTitle: "goal-1-wave-1",
    readyIssueNumber: "205",
    gateCode: "judge_context_scenarios_missing",
    routeCode: "scenario_registry_missing",
    errorText: "judge_context_scenarios_missing",
    judgeContextPath: "/tmp/judge-context.json",
    judgeEvidencePath: "/tmp/judge-evidence.json",
    scenarioRegistryRoot: `${repo}/factories/mothership/scenarios`,
    judgeContextScopeIdentity: "wave_execute",
    branch: "wave/goal-1-wave-1",
    worktreeDir: `${repo}/.worktrees/goal-1-wave-1`,
    factoryId: "mothership",
    runId: "run-judge-1",
    pipeline: "wave_execute",
    nodeId: "build_judge_context_recovery_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.match(out.packet_path, /\.hatch\/mothership\/runs\/run-judge-1\/packets\/judge_context_contract_recovery\//);
  const packet = JSON.parse(readFileSync(out.packet_path, "utf8"));
  assert.equal(packet.packet_type, "judge_context_contract_recovery");
  assert.equal(packet.resource_refs.milestone_title, "goal-1-wave-1");
  assert.equal(packet.resource_refs.ready_issue_number, "205");
  assert.equal(packet.resource_refs.gate_code, "judge_context_scenarios_missing");
  assert.equal(packet.preserve_work.cleanup_blocked_until_preserved, true);
  assert.match(packet.operator_prompt, /Correct outcome:/);
});
