#!/usr/bin/env node
import { main } from "./lib/check-harness.ts";
import { buildHumanBlockerPacket, buildHumanBlockerSignature } from "../packages/factory-ops/src/commands/human-blocker.ts";
import { buildGoalDecompositionPacket } from "../packages/factory-ops/src/lib/goal-decomposition-packet.ts";
import { buildIncidentPacket } from "../packages/factory-ops/src/lib/incident-packet.ts";
import { buildMergeConflictPacket } from "../packages/factory-ops/src/lib/merge-conflict-packet.ts";
import {
  buildPacketTakeoverContract,
  findPacketRegistryEntry,
  validatePacketTakeoverContract,
} from "../packages/factory-ops/src/lib/packet-core.ts";
import { buildRemediationPacket } from "../packages/factory-ops/src/lib/remediation-packet.ts";

function samplePackets() {
  return [
    buildMergeConflictPacket({
      repo: "/tmp/repo",
      branch: "wave/goal-1-wave-1",
      issueNumber: "101",
      worktreeDir: "/tmp/worktree",
      conflictFiles: ["src/app.ts"],
      branchCommits: [{ hash: "abc" }],
      mainCommitsTouchingConflicts: [{ hash: "def" }],
      factoryId: "mothership",
      runId: "run-1",
    }),
    buildIncidentPacket({
      factory_id: "mothership",
      source_factory: "mothership",
      source_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
      run_id: "run-2",
      signature_hash: "sha256:abc123",
      evidence: {
        observed_behavior: "Observed regression",
        expected_behavior: "Expected stable packet routing",
        remediation_attempts: "Retried twice",
      },
    }),
    buildHumanBlockerPacket({
      repo: "recallnet/astrochicken",
      sourceIssueNumber: 101,
      sourceIssueTitle: "Need sample data",
      goalIssueNumber: 99,
      milestoneTitle: "goal-99-wave-1",
      blocker: {
        kind: "external_input",
        exact_request: "Provide sample CSV",
        why_blocked: "No sample exists in repo",
        unblock_condition: "CSV uploaded",
      },
      factoryId: "mothership",
      signature: buildHumanBlockerSignature({
        sourceIssueNumber: 101,
        goalIssueNumber: 99,
        kind: "external_input",
        exactRequest: "Provide sample CSV",
        unblockCondition: "CSV uploaded",
      }),
    }),
    buildGoalDecompositionPacket({
      goalIssueNumber: "1753",
      goalIssueTitle: "Standardize named packets",
      goalIssueUrl: "https://github.com/recallnet/astrochicken/issues/1753",
      approvedFeaturesRaw: JSON.stringify([{ name: "Registry", summary: "Centralize packet families" }]),
      issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
      factoryId: "mothership",
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
    }),
    buildRemediationPacket({
      packetType: "judge_context_contract_recovery",
      intent: "Repair judge context contract",
      inspectionCommands: ["hatch-ops factory tick-status --json"],
      executionCommands: ["hatch-ops judge build-recovery-packet --help"],
      verifyCommands: ["hatch-ops factory tick-status --json"],
      expectedPostconditions: ["Judge context recovery owner can continue from the packet alone."],
      resourceRefs: { milestone_title: "goal-1-wave-1" },
      preserveWork: { preserve_work_required: true },
      operatorPrompt: "Start from the packet and rerun the failing judge contract path.",
      factoryId: "mothership",
      runId: "run-3",
      pipeline: "wave_execute",
      nodeId: "build_judge_context_recovery_packet",
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
    }),
    ...(findPacketRegistryEntry("stalled_wave_recovery")?.durable === true
      ? [
        buildRemediationPacket({
          packetType: "stalled_wave_recovery",
          intent: "Recover a stalled wave from durable packet state",
          inspectionCommands: ["hatch-ops factory tick-status", "hatch-ops factory status --json"],
          executionCommands: ["hatch-ops wave create-ready --repo recallnet/astrochicken --selected-waves '[\"goal-1-wave-1\"]' --cooldown-minutes 0"],
          verifyCommands: ["hatch-ops factory outcomes --repo recallnet/astrochicken --lookback-hours 1 --json"],
          expectedPostconditions: ["A cold-start supervisor can resume stalled wave recovery from the durable packet alone."],
          resourceRefs: { milestone_title: "goal-1-wave-1" },
          preserveWork: { preserve_work_required: true },
          operatorPrompt: "Start from this packet and resume stalled wave recovery deterministically.",
          factoryId: "mothership",
          runId: "run-4",
          pipeline: "factory_supervisor_tick",
          nodeId: "diagnose_stalled",
          targetRepo: "recallnet/astrochicken",
          controlPlaneRepo: "recallnet/astrochicken",
        }),
      ]
      : []),
  ];
}

export function validatePacketTakeoverSamples() {
  const diagnostics = [];
  for (const packet of samplePackets()) {
    const registration = findPacketRegistryEntry(packet.packet_type);
    if (!registration) {
      diagnostics.push(`missing_registry_entry:${packet.packet_type}`);
      continue;
    }
    if (!String(registration.takeover_contract || "").trim()) {
      diagnostics.push(`missing_takeover_contract:${packet.packet_type}`);
      continue;
    }
    const validation = validatePacketTakeoverContract(packet, { required: true });
    if (!validation.ok) {
      diagnostics.push(...validation.errors.map((error) => `${packet.packet_type}:${error}`));
      continue;
    }
    if (packet.handoff_kind !== registration.takeover_contract) {
      diagnostics.push(`handoff_kind_mismatch:${packet.packet_type}:${packet.handoff_kind}!=${registration.takeover_contract}`);
    }
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

export function validateTakeoverHelperRoundTrip() {
  const packet = buildPacketTakeoverContract({
    handoffOwner: "supervisor",
    handoffKind: "example",
    resourceRefs: { issue: 1 },
    inspectionCommands: ["inspect"],
    executionCommands: ["execute"],
    verifyCommands: ["verify"],
    expectedOutcomes: ["outcome"],
    preserveWork: { preserve_work_required: true },
    operatorPrompt: "start here",
  });
  const validation = validatePacketTakeoverContract(packet, { required: true });
  return {
    ok: validation.ok,
    diagnostics: validation.errors,
  };
}

function checkPacketTakeoverContract() {
  const helper = validateTakeoverHelperRoundTrip();
  if (!helper.ok) {
    return helper;
  }
  const samples = validatePacketTakeoverSamples();
  if (!samples.ok) {
    return samples;
  }
  return {
    ok: true,
    diagnostics: [],
    samples: samplePackets().length,
  };
}

const isEntryPoint = process.argv[1]
  ? new URL(`file://${process.argv[1]}`).href === import.meta.url
  : false;

if (isEntryPoint) {
  main(checkPacketTakeoverContract, {
    gate: "packet-takeover-contract",
    okMessage: (_args, result) => `samples=${result.samples}`,
    emit: ({ ok, diagnostics = [] }) => {
      if (ok) {
        process.stdout.write(`[packet-takeover-contract] result=ok samples=${samplePackets().length}\n`);
        return;
      }
      diagnostics.forEach((diagnostic) => console.error(diagnostic));
    },
  });
}
