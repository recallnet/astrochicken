import { trim } from "../lib/cli-helpers.ts";
import {
  buildGoalDecompositionPacket,
  hasActiveGoalDecompositionPacket,
  listGoalDecompositionPackets,
  persistGoalDecompositionPacket,
} from "../lib/goal-decomposition-packet.ts";


export function persistGoalDecompositionLedger({
  repo = "",
  goalIssueRaw = "",
  goalContextRaw = "",
  approvedFeaturesRaw = "",
  issueUrlsRaw = "",
  goalIssueNumber = "",
  goalIssueTitle = "",
  goalIssueUrl = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const packet = buildGoalDecompositionPacket({
    goalIssueRaw,
    goalContextRaw,
    approvedFeaturesRaw,
    issueUrlsRaw,
    goalIssueNumber,
    goalIssueTitle,
    goalIssueUrl,
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });
  const persisted = persistGoalDecompositionPacket({ repo, packet });
  return {
    packet_path: persisted.packet_path,
    packet_id: persisted.packet_ref.packet_id,
    packet_type: persisted.packet_ref.packet_type,
    schema_version: persisted.packet_ref.schema_version,
    storage_class: persisted.storage_class,
    goal_issue_number: trim(packet.goal_issue_number),
    created_issue_numbers: packet.created_issue_numbers,
  };
}

export function checkGoalAlreadyDecomposedByPacket({
  repo = "",
  factoryId = "",
  issueNumber = "",
} = {}) {
  return hasActiveGoalDecompositionPacket({
    repo,
    factoryId,
    goalIssueNumber: issueNumber,
  }) ? "true" : "false";
}

export function listGoalDecompositionLedger({
  repo = "",
  factoryId = "",
  issueNumber = "",
} = {}) {
  return listGoalDecompositionPackets({
    repo,
    factoryId,
    goalIssueNumber: issueNumber,
  }).map((entry) => ({
    packet_path: entry.packet_path,
    packet_id: entry.packet?.packet_id,
    packet_state: entry.packet?.packet_state,
    goal_issue_number: entry.packet?.goal_issue_number,
    created_issue_numbers: entry.packet?.created_issue_numbers,
  }));
}
