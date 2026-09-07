import { parseJson, trim } from "../lib/cli-helpers.ts";

function parseSnapshot(snapshot = "", snapshotB64 = "") {
  const rawB64 = trim(snapshotB64);
  if (rawB64) {
    try {
      const decoded = Buffer.from(rawB64, "base64").toString("utf8");
      const parsed = parseJson(decoded, {});
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  const raw = trim(snapshot);
  if (!raw) return {};
  const parsed = parseJson(raw, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

// Triage / issue-classification packet types that represent hygiene debt,
// not active operational incidents.  These must NOT block supervisor dispatch.
export const TRIAGE_ONLY_PACKET_TYPES = new Set([
  "orphan_feature_triage",
  "closed_goal_feature_triage",
  "relabel_merge_followup",
  "merge_followup_triage",
  "unlabeled_issue_classification",
  // @context:regression !critical Persisted goal-execution-path packets are durable routing
  // metadata, not live incidents. Leaving them in the blocker set forces every tick through
  // supervisor review even after the routing contract is already materialized.
  "goal_execution_path_packet",
  // @context:regression !critical Stale bug rechecks are supervisory hygiene,
  // not live execution blockers. Counting them as blockers traps managed
  // factories in bug-fast loops even when goal capacity is free.
  "stale_bug_recheck",
  // @context:regression !critical Persisted goal-decomposition packets are durable
  // planning artifacts from completed runs. Stale decomposition packets from old runs
  // that were never superseded should not block future goal dispatch — they represent
  // completed or abandoned planning, not active incidents requiring operator attention.
  "goal_decomposition_packet",
  // @context:regression !critical Merge conflict packets from completed/failed runs are
  // stale residue. The run finished (merged, failed, or abandoned) without closing the
  // packet. Blocking dispatch on these traps the factory in an unrecoverable state
  // since no active run owns the conflict anymore.
  "merge_conflict_packet",
]);

export function isDispatchBlocker(item) {
  const packetType = trim(
    item?.remediation_packet?.packetType
      ?? item?.remediation_packet?.packet_type
      ?? item?.packet_ref?.packetType
      ?? item?.packet_ref?.packet_type
      ?? "",
  );
  if (packetType && TRIAGE_ONLY_PACKET_TYPES.has(packetType)) return false;
  return true;
}

export function evaluateManagedActionItemGate({ snapshot = "", snapshotB64 = "" } = {}) {
  const parsed = parseSnapshot(snapshot, snapshotB64);
  const items = Array.isArray(parsed?.action_items) ? parsed.action_items : [];
  const blockers = items.filter(isDispatchBlocker);

  return {
    has_action_items: blockers.length > 0 ? "true" : "false",
    action_item_count: blockers.length,
  };
}
