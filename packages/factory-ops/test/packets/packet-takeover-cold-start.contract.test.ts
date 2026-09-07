import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildGoalDecompositionPacket } from "../../src/lib/goal-decomposition-packet.ts";
import { buildIncidentPacket } from "../../src/lib/incident-packet.ts";
import { buildMergeConflictPacket } from "../../src/lib/merge-conflict-packet.ts";
import {
  findPacketRegistryEntry,
  listPersistedPackets,
  readPacketFromPath,
  resolvePacketStoragePath,
  validateNamedPacketBase,
  validatePacketTakeoverContract,
} from "../../src/lib/packet-core.ts";
import { buildRemediationPacket } from "../../src/lib/remediation-packet.ts";

function createRepoFixture() {
  return mkdtempSync(join(tmpdir(), "packet-cold-start-"));
}

function persistPacketFixture({ repo, packet }) {
  const resolved = resolvePacketStoragePath({
    repo,
    packetType: packet?.packet_type,
    packetId: packet?.packet_id,
    factoryId: packet?.factory_id,
    runId: packet?.run_id,
  });
  mkdirSync(dirname(resolved.packet_path), { recursive: true });
  writeFileSync(resolved.packet_path, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return resolved;
}

function assertContinuationSufficient(packet = {}, packetType = "") {
  const continuationSufficient =
    String(packet?.operator_prompt || "").length > 0
    && Array.isArray(packet?.inspection_commands)
    && packet.inspection_commands.length > 0
    && Array.isArray(packet?.execution_commands)
    && packet.execution_commands.length > 0
    && Array.isArray(packet?.verify_commands)
    && packet.verify_commands.length > 0
    && Array.isArray(packet?.expected_outcomes)
    && packet.expected_outcomes.length > 0
    && packet.resource_refs
    && typeof packet.resource_refs === "object"
    && !Array.isArray(packet.resource_refs)
    && Object.keys(packet.resource_refs).length > 0;

  assert.strictEqual(continuationSufficient, true, `${packetType}: continuation_sufficient must be true`);
}

function assertPacketColdStartProof({ repo, packet, expectedTakeoverContract = "" }) {
  const persisted = persistPacketFixture({ repo, packet });
  const roundTripped = readPacketFromPath(persisted.packet_path);

  assert.ok(roundTripped, `${packet.packet_type}: packet must round-trip from persisted path`);

  const baseValidation = validateNamedPacketBase(roundTripped || {});
  assert.equal(baseValidation.ok, true, `${packet.packet_type}: ${baseValidation.errors.join(",")}`);

  const takeoverValidation = validatePacketTakeoverContract(roundTripped || {}, { required: true });
  assert.equal(takeoverValidation.ok, true, `${packet.packet_type}: ${takeoverValidation.errors.join(",")}`);

  if (String(expectedTakeoverContract || "")) {
    assert.equal(String(roundTripped?.handoff_kind || ""), expectedTakeoverContract);
  }

  assertContinuationSufficient(roundTripped, String(packet?.packet_type || ""));

  const runsDir = join(repo, ".hatch", String(packet?.factory_id || ""), "runs");
  const discovered = listPersistedPackets({
    runsDir,
    durableOnly: true,
    packetState: "open",
  });

  assert.ok(
    discovered.some((entry) => String(entry?.packet?.packet_id || "") === String(packet?.packet_id || "")),
    `${packet.packet_type}: persisted packet must be discoverable from durable open packet scan`,
  );
}

function buildSupervisorRecoveryRepresentative() {
  const promoted = ["stalled_wave_recovery", "run_liveness_recovery"].find((packetType) => {
    const entry = findPacketRegistryEntry(packetType);
    return Boolean(entry?.durable === true);
  });
  const packetType = promoted || "judge_context_contract_recovery";

  return buildRemediationPacket({
    packetType,
    intent: "Restore supervisor-owned recovery flow from a durable packet without reconstructing hidden state.",
    inspectionCommands: [
      "hatch-ops factory tick-status",
      "hatch-ops factory status --json",
    ],
    executionCommands: [
      "hatch-ops factory subscribe --target next-goal-progress --timeout 1800",
    ],
    verifyCommands: [
      "hatch-ops factory outcomes --repo recallnet/astrochicken --lookback-hours 1 --json",
    ],
    expectedPostconditions: [
      "Supervisor recovery owner can continue safely from packet and current repo/GitHub state.",
    ],
    resourceRefs: {
      milestone_title: "goal-1823-wave-1",
      recovery_family: "supervisor_recovery",
    },
    preserveWork: {
      preserve_work_required: true,
      branch: "wave/goal-1823-wave-1",
    },
    operatorPrompt: "Start from this recovery packet, inspect current supervisor run state, and continue the declared recovery path.",
    factoryId: "mothership",
    runId: "run-supervisor-recovery",
    pipeline: "factory_supervisor_tick",
    nodeId: "supervisor_state_snapshot",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });
}

test("cold-start takeover proof: merge_conflict_recovery packet is continuation-sufficient", () => {
  const repo = createRepoFixture();
  const packet = buildMergeConflictPacket({
    repo: "recallnet/astrochicken",
    branch: "wave/goal-1823-wave-1",
    issueNumber: "1827",
    worktreeDir: "/tmp/worktrees/wave-goal-1823-wave-1",
    conflictFiles: ["packages/factory-ops/src/lib/packet-core.ts"],
    branchCommits: [{ hash: "abc123", subject: "feature changes" }],
    mainCommitsTouchingConflicts: [{ hash: "def456", subject: "mainline changes" }],
    factoryId: "mothership",
    runId: "run-merge-conflict",
    pipeline: "wave_execute",
    nodeId: "build_conflict_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assertPacketColdStartProof({
    repo,
    packet,
    expectedTakeoverContract: "merge_conflict_recovery",
  });
});

test("cold-start takeover proof: judge_contract_recovery packet is continuation-sufficient", () => {
  const repo = createRepoFixture();
  const packet = buildRemediationPacket({
    packetType: "judge_context_contract_recovery",
    intent: "Repair missing judge context contract artifacts before rerunning judge.",
    inspectionCommands: [
      "hatch-ops factory tick-status",
      "gh issue view 1827 --repo recallnet/astrochicken --json number,title,body,labels",
    ],
    executionCommands: [
      "node packages/factory-ops/src/cli.ts judge context-contract --repo recallnet/astrochicken --issue-number 1827",
    ],
    verifyCommands: [
      "node packages/factory-ops/src/cli.ts judge context-contract --repo recallnet/astrochicken --issue-number 1827",
    ],
    expectedPostconditions: [
      "Judge context contract payload is complete and reusable by downstream review/judge operators.",
    ],
    resourceRefs: {
      issue_number: "1827",
      milestone_title: "goal-1823-wave-1",
    },
    preserveWork: {
      preserve_work_required: true,
      issue_number: "1827",
    },
    operatorPrompt: "Start from this packet, regenerate judge context contract artifacts, then re-run judge gating.",
    factoryId: "mothership",
    runId: "run-judge-recovery",
    pipeline: "wave_execute",
    nodeId: "build_judge_context_recovery_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assertPacketColdStartProof({
    repo,
    packet,
    expectedTakeoverContract: "supervisor_recovery",
  });
});

test("cold-start takeover proof: control_plane_incident packet is continuation-sufficient", () => {
  const repo = createRepoFixture();
  const packet = buildIncidentPacket({
    factory_id: "mothership",
    source_factory: "mothership",
    source_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    run_id: "run-incident",
    pipeline: "factory_supervisor_tick",
    node: "review_external_factory_bug",
    signature_hash: "sha256:incident-proof",
    evidence: {
      observed_behavior: "Managed factory escalated recurring crash loop.",
      expected_behavior: "Control plane should ship deterministic recovery fix and unblock downstream factory.",
      remediation_attempts: "Supervisor retried deterministic recovery and captured packet evidence.",
      source_factory: "mothership",
      source_repo: "recallnet/astrochicken",
      run_id: "run-incident",
    },
  });

  assertPacketColdStartProof({
    repo,
    packet,
    expectedTakeoverContract: "control_plane_incident",
  });
});

test("cold-start takeover proof: supervisor_recovery family representative packet is continuation-sufficient", () => {
  const repo = createRepoFixture();
  const packet = buildSupervisorRecoveryRepresentative();

  assertPacketColdStartProof({
    repo,
    packet,
    expectedTakeoverContract: String(findPacketRegistryEntry(packet.packet_type)?.takeover_contract || packet.handoff_kind || ""),
  });
});

test("cold-start takeover proof: goal_decomposition_dedupe packet is continuation-sufficient", () => {
  const repo = createRepoFixture();
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1823",
    goalIssueTitle: "Goal: Finish final-mile packet standardization and packet-only takeover proof",
    goalIssueUrl: "https://github.com/recallnet/astrochicken/issues/1823",
    goalContextRaw: "Ship packet-first takeover proof and template/docs ratchet for durable handoff contracts.",
    approvedFeaturesRaw: JSON.stringify([
      {
        name: "Cold-start takeover proofs",
        summary: "Add contract fixtures proving packet-only continuation is sufficient.",
        scope: "packages/factory-ops/test/packets/packet-takeover-cold-start.contract.test.mjs",
        domain: "factory-ops",
        acceptance_criteria: [
          "Each fixture validates takeover contract fields",
          "Each fixture is discoverable via durable packet scan",
        ],
      },
    ]),
    issueUrlsRaw: JSON.stringify([
      "https://github.com/recallnet/astrochicken/issues/1827",
    ]),
    factoryId: "mothership",
    runId: "run-goal-decomposition",
    pipeline: "goal_run",
    nodeId: "persist_decomposition_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assertPacketColdStartProof({
    repo,
    packet,
    expectedTakeoverContract: "goal_decomposition_dedupe",
  });
});
