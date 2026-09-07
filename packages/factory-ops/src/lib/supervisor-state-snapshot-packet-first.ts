import { fileURLToPath } from "node:url";

import { listCanonicalPacketsSync } from "./canonical-packet-projection.ts";
import { trim } from "./cli-helpers.ts";
import {
  isDurablePacketType,
} from "./packet-core.ts";

const FACTORY_OPS_CLI_ENTRYPOINT = fileURLToPath(new URL("../cli.ts", import.meta.url));

export function buildPacketActionDedupeKey(packetType = "", runId = "") {
  const normalizedPacketType = trim(packetType);
  const normalizedRunId = trim(runId);
  if (!normalizedPacketType || !normalizedRunId) return "";
  return `${normalizedPacketType}:${normalizedRunId}`;
}

export function mapPersistedPacketEntryToActionItem(entry = {}) {
  const packet = entry?.packet && typeof entry.packet === "object" ? entry.packet : {};
  const normalizedPacket = normalizePersistedPacket(packet);
  const refs = normalizedPacket?.resource_refs && typeof normalizedPacket.resource_refs === "object" ? normalizedPacket.resource_refs : {};
  const packetType = trim(normalizedPacket?.packet_type || entry?.packet_ref?.packet_type || "");
  const runId = trim(normalizedPacket?.run_id || entry?.run_id || "");
  const packetDedupeKey = buildPacketActionDedupeKey(packetType, runId);

  if (trim(entry?.registry_entry?.family || "") === "merge_conflict_packet") {
    const conflictFiles = Array.isArray(normalizedPacket?.conflict_files) ? normalizedPacket.conflict_files : [];
    const branch = trim(normalizedPacket?.branch || "");
    const issueNumber = trim(normalizedPacket?.issue_number || "");
    const worktreeDir = trim(normalizedPacket?.worktree_dir || "");
    const mergeCandidateIssues = Array.isArray(normalizedPacket?.merge_candidate_issues) ? normalizedPacket.merge_candidate_issues.map(String).filter(Boolean) : [];
    const candidateSuffix = mergeCandidateIssues.length > 0
      ? ` Unmerged merge candidate sub-issues: ${mergeCandidateIssues.map((n) => `#${n}`).join(", ")}. Do NOT close this packet unless ALL listed sub-issues are closed or merged to main.`
      : "";
    return {
      type: "merge_conflict_packet",
      source: "persisted_packet",
      packet_preferred: true,
      packet_dedupe_key: packetDedupeKey,
      problem: `MERGE_CONFLICT_PACKET_OPEN: branch ${branch || "(unknown)"}${issueNumber ? ` issue #${issueNumber}` : ""} still requires recovery.${candidateSuffix}`,
      title: issueNumber ? `issue #${issueNumber} merge recovery` : (branch || "merge recovery"),
      diagnostics: {
        packet_id: trim(normalizedPacket?.packet_id),
        packet_path: entry.packet_path,
        packet_state: trim(normalizedPacket?.packet_state || ""),
        packet_storage_class: entry.registry_entry?.storage_class,
        branch,
        issue_number: issueNumber,
        worktree_dir: worktreeDir,
        conflict_file_count: String(conflictFiles.length),
      },
      packet_ref: entry.packet_ref,
      remediation_packet: normalizedPacket,
      suggested_action: trim(normalizedPacket?.operator_prompt || "") || [
        `Open conflict packet ${entry.packet_path}.`,
        "Load packages/factory-skills/skills/merge_conflict_resolver/SKILL.md and use the packet as the recovery map.",
        branch ? `Inspect branch/worktree state for ${branch} before mutating anything.` : "Inspect current repo/worktree state before mutating anything.",
        "Resolve the merge/push blocker, verify the repo is clean, and keep the durable packet path in the recovery log.",
      ].join(" "),
    };
  }

  return {
    type: "recovery_packet",
    source: "persisted_packet",
    packet_preferred: true,
    packet_dedupe_key: packetDedupeKey,
    problem: `RECOVERY_PACKET_OPEN: ${packetType} for run ${runId || "(unknown_run)"} (${trim(normalizedPacket?.pipeline || "unknown_pipeline")}).`,
    title: trim(refs.milestone_title || normalizedPacket?.intent || packetType),
    diagnostics: {
      packet_id: trim(normalizedPacket?.packet_id),
      packet_path: entry.packet_path,
      packet_state: trim(normalizedPacket?.packet_state || ""),
      packet_storage_class: entry.registry_entry?.storage_class,
      gate_code: trim(refs.gate_code || ""),
      route_code: trim(refs.route_code || ""),
      error_text: trim(refs.error_text || ""),
      milestone_title: trim(refs.milestone_title || ""),
      ready_issue_number: trim(refs.ready_issue_number || ""),
      judge_kind: trim(refs.judge_kind || ""),
    },
    packet_ref: entry.packet_ref,
    remediation_packet: normalizedPacket,
    suggested_action: trim(normalizedPacket?.operator_prompt || normalizedPacket?.execution_commands?.[0] || `Open ${entry.packet_path}`),
  };
}

function normalizePersistedPacket(packet = {}) {
  const packetType = trim(packet?.packet_type || "");
  if (!packetType) return packet;

  if (packetType === "goal_execution_path_packet") {
    // @context:regression !critical Older persisted routing packets stored prose in
    // execution_commands. Replaying them verbatim makes supervisor auto-exec try to run
    // English text in every future tick until the packet ages out.
    return {
      ...packet,
      execution_commands: [],
    };
  }

  if (packetType === "orphan_feature_triage") {
    const repo = resolvePersistedPacketRepo(packet);
    if (!repo) return packet;
    const canonicalCommand = `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor remediate-orphan-features --repo '${repo}'`;
    // @context:regression !critical Persisted orphan triage packets outlive the tick that
    // created them. Normalizing to the control-plane CLI path on load prevents stale
    // repo-relative commands from trapping every later managed tick in supervisor_review.
    return {
      ...packet,
      execution_commands: [canonicalCommand],
    };
  }

  return packet;
}

function resolvePersistedPacketRepo(packet = {}) {
  const refs = packet?.resource_refs && typeof packet.resource_refs === "object" ? packet.resource_refs : {};
  const explicitRepo = trim(refs.repo || packet?.target_repo || "");
  if (explicitRepo) return explicitRepo;

  const candidateCommands = [
    ...(Array.isArray(packet?.execution_commands) ? packet.execution_commands : []),
    ...(Array.isArray(packet?.inspection_commands) ? packet.inspection_commands : []),
    ...(Array.isArray(packet?.verify_commands) ? packet.verify_commands : []),
  ];
  for (const command of candidateCommands) {
    const text = trim(command);
    if (!text) continue;
    const singleQuotedMatch = text.match(/--repo\s+'([^']+)'/);
    if (singleQuotedMatch?.[1]) return trim(singleQuotedMatch[1]);
    const bareMatch = text.match(/--repo\s+([^\s]+)/);
    if (bareMatch?.[1]) return trim(bareMatch[1]);
  }

  return "";
}

function resolveMergeConflictPacketIssueNumber(entry = {}) {
  const packet = entry?.packet && typeof entry.packet === "object" ? entry.packet : {};
  const refs = packet?.resource_refs && typeof packet.resource_refs === "object" ? packet.resource_refs : {};
  return trim(packet?.issue_number || refs?.issue_number || "");
}

function shouldKeepPersistedPacketEntry(entry = {}, { openIssueNumbers = null } = {}) {
  if (!(openIssueNumbers instanceof Set) || openIssueNumbers.size === 0) return true;
  if (trim(entry?.registry_entry?.family || "") !== "merge_conflict_packet") return true;
  const issueNumber = Number(resolveMergeConflictPacketIssueNumber(entry));
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) return true;
  return openIssueNumbers.has(issueNumber);
}

export function loadOpenDurablePacketActionItems({
  runsDir = "",
  factoryId = "",
  repo = "",
  nowMs = Date.now(),
  openIssueNumbers = null,
} = {}) {
  try {
    const entries = listCanonicalPacketsSync({
      runsDir,
      context: {
        factory_id: factoryId,
        repo,
      },
      factoryId,
      durableOnly: true,
      packetState: "open",
      nowMs,
      windowMs: 24 * 60 * 60 * 1000,
      excludeTerminalRuns: true,
    });
    return entries
      .filter((entry) => shouldKeepPersistedPacketEntry(entry, { openIssueNumbers }))
      .map((entry) => mapPersistedPacketEntryToActionItem(entry));
  } catch {
    return [];
  }
}

export function getActionItemPacketDedupeKey(item = {}) {
  if (String(item?.packet_dedupe_key || "")) return String(item.packet_dedupe_key);
  const packet = item?.remediation_packet && typeof item.remediation_packet === "object"
    ? item.remediation_packet
    : null;
  return buildPacketActionDedupeKey(
    trim(packet?.packet_type || item?.packet_ref?.packet_type || ""),
    trim(packet?.run_id || item?.packet_ref?.run_id || ""),
  );
}

export function shouldSuppressSynthesisActionItem({ item = {}, persistedPacketByDedupeKey = new Map() } = {}) {
  if (String(item?.source || "") === "persisted_packet") return false;
  const packetDedupeKey = getActionItemPacketDedupeKey(item);
  const packetType = trim(item?.remediation_packet?.packet_type || item?.packet_ref?.packet_type || "");
  if (!packetType || !isDurablePacketType(packetType)) return false;
  if (!packetDedupeKey) return false;
  return persistedPacketByDedupeKey.has(packetDedupeKey);
}
