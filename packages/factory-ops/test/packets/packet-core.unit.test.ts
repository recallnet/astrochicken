import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMergeConflictPacket,
  validateMergeConflictPacket,
} from "../../src/lib/merge-conflict-packet.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketRegistrySnapshot,
  buildPacketRef,
  buildPacketTakeoverContract,
  DURABLE_PACKET_TYPES,
  findPacketRegistryEntry,
  isDurablePacketType,
  isTakeoverPacketType,
  listPersistedFactoryPackets,
  listPersistedPackets,
  makePacketId,
  PACKET_STATE_OPEN,
  PACKET_STATE_RESOLVED,
  PACKET_STATE_SUPERSEDED,
  persistNamedPacket,
  resolvePacketStoragePath,
  TAKEOVER_PACKET_TYPES,
  updatePersistedPacketState,
  validateDurablePacketPayload,
  validatePacketTakeoverContract,
  validateRegisteredPacketType,
  validateNamedPacketBase,
  PACKET_REGISTRY,
} from "../../src/lib/packet-core.ts";
import {
  buildRemediationPacket,
  persistRemediationPacket,
  validateRemediationPacket,
} from "../../src/lib/remediation-packet.ts";

test("packet-core: validates required named packet envelope fields", () => {
  const out = validateNamedPacketBase({});
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("missing_required_field:schema_version"));
  assert.ok(out.errors.includes("missing_required_field:packet_type"));
});

test("packet-core: resolvePacketStoragePath uses factory-scoped run storage when metadata exists", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const out = resolvePacketStoragePath({
    repo,
    packetType: "merge_conflict_packet",
    packetId: "merge_conflict_packet_abc",
    factoryId: "mothership",
    runId: "run-1",
  });
  assert.match(out.packet_path, /\.hatch\/mothership\/runs\/run-1\/packets\/merge_conflict_packet\/merge_conflict_packet_abc\.json$/);
  assert.equal(out.storage_class, "factory_run_packet");
});

test("packet-core: persistNamedPacket writes canonical packet JSON", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "example_packet/v1",
      packetType: "example_packet",
      packetId: makePacketId({ packetType: "example_packet", identity: { repo } }),
      factoryId: "mothership",
      runId: "run-2",
    }),
    payload: { ok: true },
  };
  const out = persistNamedPacket({ repo, packet });
  const parsed = JSON.parse(readFileSync(out.packet_path, "utf8"));
  assert.equal(parsed.schema_version, "example_packet/v1");
  assert.equal(parsed.packet_type, "example_packet");
  assert.equal(out.packet_ref.packet_state, PACKET_STATE_OPEN);
});

test("merge-conflict packet: builds named packet family with shared envelope", () => {
  const packet = buildMergeConflictPacket({
    repo: "/tmp/repo",
    branch: "wave/1",
    issueNumber: "42",
    conflictFiles: ["file.txt"],
    branchCommits: [{ hash: "abc" }],
    mainCommitsTouchingConflicts: [{ hash: "def" }],
    runId: "run-3",
    factoryId: "mothership",
  });
  const validation = validateMergeConflictPacket(packet);
  assert.equal(validation.ok, true);
  assert.equal(packet.schema_version, "merge_conflict_packet/v1");
  assert.equal(packet.packet_type, "merge_conflict_packet");
  assert.equal(packet.handoff_kind, "merge_conflict_recovery");
  assert.equal(packet.resource_refs.branch, "wave/1");
});

test("packet-core: registry includes merge conflict packet family", () => {
  const family = PACKET_REGISTRY.find((entry) => entry.packet_type === "merge_conflict_packet");
  assert.ok(family);
  assert.equal(family.schema_version, "merge_conflict_packet/v1");
  assert.equal(family.durable, true);
  assert.equal(family.takeover_contract, "merge_conflict_recovery");
});

test("packet-core: registry covers reviewer and judge contract packet families", () => {
  assert.ok(findPacketRegistryEntry("reviewer_context_packet"));
  assert.ok(findPacketRegistryEntry("judge_context_packet"));
  assert.ok(findPacketRegistryEntry("judge_evidence_packet"));
  assert.ok(findPacketRegistryEntry("goal_decomposition_packet"));
  assert.ok(findPacketRegistryEntry("goal_execution_path_packet"));
  assert.ok(findPacketRegistryEntry("goal_hard_plan_packet"));
  assert.ok(findPacketRegistryEntry("goal_hard_plan_materialization_packet"));
});

test("packet-core: durable and takeover packet type helpers derive from registry", () => {
  assert.ok(DURABLE_PACKET_TYPES.has("remote_cli_runtime_crash"));
  assert.ok(DURABLE_PACKET_TYPES.has("merge_conflict_packet"));
  assert.ok(DURABLE_PACKET_TYPES.has("canonical_checkout_recovery"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("remote_cli_runtime_crash"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("canonical_checkout_recovery"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("goal_decomposition_packet"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("goal_execution_path_packet"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("goal_hard_plan_packet"));
  assert.ok(TAKEOVER_PACKET_TYPES.has("goal_hard_plan_materialization_packet"));
  assert.equal(isDurablePacketType("remote_cli_runtime_crash"), true);
  assert.equal(isDurablePacketType("canonical_checkout_recovery"), true);
  assert.equal(isDurablePacketType("goal_execution_path_packet"), true);
  assert.equal(isDurablePacketType("goal_hard_plan_packet"), true);
  assert.equal(isDurablePacketType("goal_hard_plan_materialization_packet"), true);
  assert.equal(isDurablePacketType("stalled_wave_recovery"), false);
  assert.equal(isTakeoverPacketType("canonical_checkout_recovery"), true);
  assert.equal(isTakeoverPacketType("remote_cli_runtime_crash"), true);
  assert.equal(isTakeoverPacketType("goal_execution_path_packet"), true);
  assert.equal(isTakeoverPacketType("goal_hard_plan_packet"), true);
  assert.equal(isTakeoverPacketType("goal_hard_plan_materialization_packet"), true);
  assert.equal(isTakeoverPacketType("stalled_wave_recovery"), false);
});

test("packet-core: validateDurablePacketPayload enforces durable and takeover requirements", () => {
  const remoteCrashMissingTakeover = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "remediation_packet/v1",
      packetType: "remote_cli_runtime_crash",
      packetId: "remote_cli_runtime_crash_1",
      packetState: PACKET_STATE_OPEN,
    }),
  };
  const remoteValidation = validateDurablePacketPayload(remoteCrashMissingTakeover);
  assert.equal(remoteValidation.ok, false);
  assert.ok(remoteValidation.errors.includes("missing_required_field:handoff_owner"));
  assert.ok(remoteValidation.errors.includes("missing_required_field:handoff_kind"));

  const localCrash = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "remediation_packet/v1",
      packetType: "local_cli_runtime_crash",
      packetId: "local_cli_runtime_crash_1",
      packetState: PACKET_STATE_OPEN,
    }),
  };
  const localValidation = validateDurablePacketPayload(localCrash);
  assert.equal(localValidation.ok, true);

  const malformedDurable = {
    schema_version: "remediation_packet/v1",
    packet_type: "remote_cli_runtime_crash",
    packet_id: "",
    created_at: "",
    packet_state: "",
    handoff_owner: "supervisor",
    handoff_kind: "supervisor_recovery",
  };
  const malformedValidation = validateDurablePacketPayload(malformedDurable);
  assert.equal(malformedValidation.ok, false);
  assert.ok(malformedValidation.errors.includes("missing_required_field:packet_id"));
  assert.ok(malformedValidation.errors.includes("missing_required_field:created_at"));
  assert.ok(malformedValidation.errors.includes("missing_required_field:packet_state"));
});

test("packet-core: validateDurablePacketPayload rejects durable packets with all-empty resource refs", () => {
  const emptyRefsPacket = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "goal_decomposition_packet/v1",
      packetType: "goal_decomposition_packet",
      packetId: "goal_decomposition_packet_abc123",
      packetState: PACKET_STATE_OPEN,
    }),
    handoff_owner: "goal.decomposition_dedupe",
    handoff_kind: "goal_decomposition_dedupe",
    resource_refs: { goal_issue_number: "", goal_issue_url: "", created_issue_numbers: [] },
  };
  const validation = validateDurablePacketPayload(emptyRefsPacket);
  assert.equal(validation.ok, false, "packets with all-empty resource refs must be rejected");
  assert.ok(validation.errors.some((e) => e.includes("empty_resource_refs")));
});

test("packet-core: validateDurablePacketPayload allows durable packets with non-empty resource refs", () => {
  const validRefsPacket = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "goal_decomposition_packet/v1",
      packetType: "goal_decomposition_packet",
      packetId: "goal_decomposition_packet_def456",
      packetState: PACKET_STATE_OPEN,
    }),
    handoff_owner: "goal.decomposition_dedupe",
    handoff_kind: "goal_decomposition_dedupe",
    resource_refs: { goal_issue_number: "1403", goal_issue_url: "", created_issue_numbers: [] },
  };
  const validation = validateDurablePacketPayload(validRefsPacket);
  assert.equal(validation.ok, true);
});

test("packet-core: validateDurablePacketPayload allows packets without resource_refs key", () => {
  const noRefsPacket = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "remediation_packet/v1",
      packetType: "local_cli_runtime_crash",
      packetId: "local_cli_runtime_crash_xyz",
      packetState: PACKET_STATE_OPEN,
    }),
  };
  const validation = validateDurablePacketPayload(noRefsPacket);
  assert.equal(validation.ok, true);
});

test("packet-core: takeover contract helper builds reusable packet-only handoff shape", () => {
  const contract = buildPacketTakeoverContract({
    handoffOwner: "supervisor",
    handoffKind: "example",
    resourceRefs: { issue_number: 1 },
    inspectionCommands: ["inspect"],
    executionCommands: ["execute"],
    verifyCommands: ["verify"],
    expectedOutcomes: ["done"],
    preserveWork: { preserve_work_required: true },
    operatorPrompt: "start here",
  });
  const validation = validatePacketTakeoverContract(contract, { required: true });
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(contract.handoff_owner, "supervisor");
  assert.equal(contract.expected_outcomes[0], "done");
});

test("packet-core: registered packet lookup validates known types", () => {
  const entry = findPacketRegistryEntry("incident_packet");
  assert.ok(entry);
  const validation = validateRegisteredPacketType({
    packetType: "incident_packet",
    schemaVersion: "incident_packet.v1",
  });
  assert.equal(validation.ok, true);
});

test("packet-core: buildPacketRef emits stable locator fields", () => {
  const packet = buildNamedPacketEnvelope({
    schemaVersion: "incident_packet.v1",
    packetType: "incident_packet",
    packetId: "incident_packet_123",
    runId: "run-1",
    pipeline: "factory_supervisor_tick",
    nodeId: "emit_bug",
  });
  const ref = buildPacketRef(packet, "/tmp/incident_packet_123.json");
  assert.equal(ref.packet_id, "incident_packet_123");
  assert.equal(ref.packet_path, "/tmp/incident_packet_123.json");
  assert.equal(ref.packet_state, PACKET_STATE_OPEN);
});

test("packet-core: listPersistedPackets discovers durable open packets by family", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = buildRemediationPacket({
    packetType: "judge_context_contract_recovery",
    intent: "Repair failed judge context contract",
    operatorPrompt: "Start from the packet and rerun the judge context build/validate chain.",
    expectedPostconditions: ["Judge context recovery packet remains executable by the supervisor."],
    factoryId: "mothership",
    runId: "run-judge",
    pipeline: "wave_execute",
  });
  persistRemediationPacket({ repo, packet });

  const packets = listPersistedPackets({
    runsDir: join(repo, ".hatch", "mothership", "runs"),
    families: ["remediation_packet"],
    durableOnly: true,
    packetState: PACKET_STATE_OPEN,
  });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].packet.packet_id, packet.packet_id);
});

test("packet-core: listPersistedPackets supersedes stale merge-conflict packets from already-merged runs", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const runId = "run-merge";
  const packet = buildMergeConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "42",
    worktreeDir: join(repo, "missing-merge-worktree"),
    conflictFiles: ["file.txt"],
    branchCommits: [{ hash: "abc" }],
    mainCommitsTouchingConflicts: [{ hash: "def" }],
    runId,
    factoryId: "mothership",
  });
  const persisted = persistNamedPacket({ repo, packet });
  const runsDir = join(repo, ".hatch", "mothership", "runs");
  mkdirSync(join(runsDir, runId), { recursive: true });
  writeFileSync(join(runsDir, runId, "state.json"), JSON.stringify({
    context: {
      merge_status: "already_merged",
    },
  }, null, 2));

  const packets = listPersistedPackets({
    runsDir,
    packetTypes: ["merge_conflict_packet"],
    packetState: PACKET_STATE_OPEN,
  });

  assert.equal(packets.length, 0);
  const reread = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(reread.packet_state, PACKET_STATE_SUPERSEDED);
  assert.equal(reread.status_reason, "merge_conflict_packet_obsolete:run_state_already_merged");
});

test("packet-core: listPersistedPackets supersedes merge-conflict packets when a terminal run lost its worktree", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const runId = "run-lost-worktree";
  const packet = buildMergeConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "42",
    worktreeDir: join(repo, "missing-merge-worktree"),
    conflictFiles: ["file.txt"],
    branchCommits: [{ hash: "abc" }],
    mainCommitsTouchingConflicts: [{ hash: "def" }],
    runId,
    factoryId: "mothership",
  });
  const persisted = persistNamedPacket({ repo, packet });
  const runsDir = join(repo, ".hatch", "mothership", "runs");
  mkdirSync(join(runsDir, runId), { recursive: true });
  writeFileSync(join(runsDir, runId, "state.json"), JSON.stringify({
    status: "completed",
    context: {
      merge_status: "conflict",
      push_status: "conflict",
    },
  }, null, 2));

  const packets = listPersistedPackets({
    runsDir,
    packetTypes: ["merge_conflict_packet"],
    packetState: PACKET_STATE_OPEN,
  });

  assert.equal(packets.length, 0);
  const reread = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(reread.packet_state, PACKET_STATE_SUPERSEDED);
  assert.equal(reread.status_reason, "merge_conflict_packet_obsolete:missing_conflict_worktree_after_terminal_run");
});

test("packet-core: validateNamedPacketBase rejects invalid packet states", () => {
  const packet = buildNamedPacketEnvelope({
    schemaVersion: "example_packet/v1",
    packetType: "example_packet",
    packetId: "example_packet_1",
    packetState: "broken",
  });
  const out = validateNamedPacketBase(packet);
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("invalid_packet_state:broken"));
});

test("packet-core: listPersistedPackets filters by packet_state", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "incident_packet.v1",
      packetType: "incident_packet",
      packetId: "incident_packet_1",
      factoryId: "mothership",
      runId: "run-1",
      packetState: PACKET_STATE_RESOLVED,
    }),
    handoff_owner: "control_plane",
    handoff_kind: "control_plane_incident",
    observed_behavior: "obs",
  };
  persistNamedPacket({ repo, packet });
  const packets = listPersistedPackets({
    runsDir: join(repo, ".hatch", "mothership", "runs"),
    packetTypes: ["incident_packet"],
    packetState: PACKET_STATE_OPEN,
  });
  assert.equal(packets.length, 0);
});

test("packet-core: updatePersistedPacketState rewrites durable packet state and status reason", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = buildMergeConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "42",
    conflictFiles: ["file.txt"],
    branchCommits: [{ hash: "abc" }],
    mainCommitsTouchingConflicts: [{ hash: "def" }],
    runId: "run-3",
    factoryId: "mothership",
  });
  const persisted = persistNamedPacket({ repo, packet });

  const updated = updatePersistedPacketState({
    packetPath: persisted.packet_path,
    packetState: PACKET_STATE_SUPERSEDED,
    statusReason: "merge_conflict_packet_obsolete:run_state_already_merged",
    nowIso: "2026-03-12T00:00:00.000Z",
  });

  assert.equal(updated.packet_state, PACKET_STATE_SUPERSEDED);
  assert.equal(updated.status_reason, "merge_conflict_packet_obsolete:run_state_already_merged");
  assert.equal(updated.updated_at, "2026-03-12T00:00:00.000Z");

  const reread = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(reread.packet_state, PACKET_STATE_SUPERSEDED);
  assert.equal(reread.status_reason, "merge_conflict_packet_obsolete:run_state_already_merged");
});

test("remediation packet: builds named remediation packets for registered subtypes", () => {
  const packet = buildRemediationPacket({
    packetType: "stalled_wave_recovery",
    intent: "Recover stalled wave",
    inspectionCommands: ["hatch-ops factory tick-status"],
    executionCommands: ["hatch-ops factory recovery-sweep --apply true"],
    verifyCommands: ["hatch-ops factory tick-status"],
  });
  const validation = validateRemediationPacket(packet);
  assert.equal(validation.ok, true);
  assert.equal(packet.schema_version, "remediation_packet/v1");
  assert.equal(packet.packet_type, "stalled_wave_recovery");
  assert.match(packet.packet_id, /^stalled_wave_recovery_/);
});

test("remediation packet: supports operator prompt, resource refs, and durable persistence", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = buildRemediationPacket({
    packetType: "judge_context_contract_recovery",
    intent: "Repair failed judge context contract",
    operatorPrompt: "Start with the packet and rerun the judge context build/validate chain.",
    expectedPostconditions: ["Judge context recovery packet remains executable by the supervisor."],
    resourceRefs: {
      milestone_title: "goal-1-wave-1",
      judge_context_path: "/tmp/context.json",
    },
    preserveWork: {
      preserve_work_required: true,
    },
    factoryId: "mothership",
    runId: "run-judge",
    pipeline: "wave_execute",
  });
  const validation = validateRemediationPacket(packet);
  assert.equal(validation.ok, true);
  assert.equal(packet.operator_prompt, "Start with the packet and rerun the judge context build/validate chain.");
  assert.equal(packet.resource_refs.milestone_title, "goal-1-wave-1");
  assert.equal(packet.preserve_work.preserve_work_required, true);
  assert.equal(packet.handoff_kind, "supervisor_recovery");
  assert.deepEqual(packet.expected_outcomes, packet.expected_postconditions);

  const persisted = persistRemediationPacket({ repo, packet });
  const parsed = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(parsed.packet_type, "judge_context_contract_recovery");
  assert.equal(parsed.resource_refs.judge_context_path, "/tmp/context.json");
});

test("remediation packet: canonical checkout recovery persists as a factory packet", () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const packet = buildRemediationPacket({
    packetType: "canonical_checkout_recovery",
    intent: "Recover canonical checkout",
    inspectionCommands: ["git worktree list --porcelain"],
    executionCommands: ["hatch-ops doctor repair-canonical-checkout"],
    verifyCommands: ["hatch-ops doctor canonical-checkout"],
    expectedPostconditions: ["canonical checkout restored"],
    operatorPrompt: "Recover the canonical checkout.",
    factoryId: "mothership",
  });
  const persisted = persistRemediationPacket({ repo, packet });
  const parsed = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(parsed.packet_type, "canonical_checkout_recovery");
  assert.equal(parsed.handoff_kind, "supervisor_recovery");
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/canonical_checkout_recovery\//);
  assert.equal(persisted.storage_class, "factory_packet");
});

test("packet-core: packet registry snapshot includes goal decomposition, execution-path, and hard-plan packets", () => {
  const snapshot = buildPacketRegistrySnapshot();
  assert.equal(snapshot.schema_version, "packet_registry/v1");
  assert.ok(snapshot.packet_types.some((entry) => entry.packet_type === "goal_decomposition_packet"));
  assert.equal(
    snapshot.packet_types.find((entry) => entry.packet_type === "goal_decomposition_packet")?.takeover_contract,
    "goal_decomposition_dedupe",
  );
  assert.ok(snapshot.packet_types.some((entry) => entry.packet_type === "goal_execution_path_packet"));
  assert.equal(
    snapshot.packet_types.find((entry) => entry.packet_type === "goal_execution_path_packet")?.takeover_contract,
    "goal_execution_path",
  );
  assert.ok(snapshot.packet_types.some((entry) => entry.packet_type === "goal_hard_plan_packet"));
  assert.equal(
    snapshot.packet_types.find((entry) => entry.packet_type === "goal_hard_plan_packet")?.takeover_contract,
    "goal_hard_plan",
  );
  assert.ok(snapshot.packet_types.some((entry) => entry.packet_type === "goal_hard_plan_materialization_packet"));
  assert.equal(
    snapshot.packet_types.find((entry) => entry.packet_type === "goal_hard_plan_materialization_packet")?.takeover_contract,
    "goal_hard_plan_materialization",
  );
});

test("packet-core: listPersistedFactoryPackets discovers factory-scoped durable packets outside runs", async () => {
  const repo = mkdtempSync(join(tmpdir(), "packet-core-"));
  const { buildGoalDecompositionPacket, persistGoalDecompositionPacket } = await import("../../src/lib/goal-decomposition-packet.ts");
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1753",
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Standardize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
    factoryId: "mothership",
  });
  persistGoalDecompositionPacket({ repo, packet });
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId: "mothership",
    packetTypes: ["goal_decomposition_packet"],
    durableOnly: true,
  });
  assert.equal(packets.length, 1);
});
