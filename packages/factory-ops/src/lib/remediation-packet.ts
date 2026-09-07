import { trim, toCommandList, toPlainObject } from "./cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  findPacketRegistryEntry,
  makePacketId,
  persistNamedPacket,
  validatePacketTakeoverContract,
  validateNamedPacketBase,
  validateRegisteredPacketType,
} from "./packet-core.ts";

export const REMEDIATION_PACKET_SCHEMA_VERSION = "remediation_packet/v1";

export function buildRemediationPacket({
  packetType = "",
  intent = "",
  inspectionCommands = [],
  executionCommands = [],
  verifyCommands = [],
  expectedPostconditions = [],
  retryPolicy = {},
  requiresCommit = false,
  requiresRepoFix = false,
  resourceRefs = {},
  preserveWork = {},
  operatorPrompt = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const normalizedType = trim(packetType);
  const registeredEntry = findPacketRegistryEntry(normalizedType);
  const packetId = makePacketId({
    packetType: normalizedType || "remediation_packet",
    identity: {
      intent: trim(intent),
      inspection_commands: toCommandList(inspectionCommands),
      execution_commands: toCommandList(executionCommands),
      verify_commands: toCommandList(verifyCommands),
      expected_postconditions: toCommandList(expectedPostconditions),
      resource_refs: toPlainObject(resourceRefs),
      preserve_work: toPlainObject(preserveWork),
      operator_prompt: trim(operatorPrompt),
      factory_id: trim(factoryId),
      run_id: trim(runId),
      pipeline: trim(pipeline),
      node_id: trim(nodeId),
    },
  });

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: REMEDIATION_PACKET_SCHEMA_VERSION,
      packetType: normalizedType,
      packetId,
      factoryId,
      runId,
      pipeline,
      nodeId,
      targetRepo,
      controlPlaneRepo,
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "supervisor",
      handoffKind: trim(registeredEntry?.takeover_contract || normalizedType || "remediation_packet"),
      resourceRefs,
      inspectionCommands,
      executionCommands,
      verifyCommands,
      expectedOutcomes: expectedPostconditions,
      preserveWork,
      operatorPrompt,
    }),
    intent: trim(intent),
    inspection_commands: toCommandList(inspectionCommands),
    execution_commands: toCommandList(executionCommands),
    verify_commands: toCommandList(verifyCommands),
    expected_postconditions: toCommandList(expectedPostconditions),
    retry_policy: {
      max_attempts: Number(retryPolicy.max_attempts || 1),
      on_failure: trim(retryPolicy.on_failure || "defer_with_evidence"),
      recheck_after: trim(retryPolicy.recheck_after || ""),
    },
    requires_commit: requiresCommit === true,
    requires_repo_fix: requiresRepoFix === true,
    resource_refs: toPlainObject(resourceRefs),
    preserve_work: toPlainObject(preserveWork),
    operator_prompt: trim(operatorPrompt),
  };
}

export function validateRemediationPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const errors = [...base.errors];
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  errors.push(...registration.errors);

  const entry = findPacketRegistryEntry(packet?.packet_type);
  if (entry && entry.family !== "remediation_packet") {
    errors.push(`invalid_remediation_packet_family:${entry.family}`);
  }
  const handoff = validatePacketTakeoverContract(packet, {
    required: Boolean(entry?.takeover_contract),
  });
  errors.push(...handoff.errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistRemediationPacket({ repo = "", packet = {} } = {}) {
  const validation = validateRemediationPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_remediation_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}
