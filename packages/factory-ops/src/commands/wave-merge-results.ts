import {
  buildMergeCompletedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";

/**
 * Build final wave merge results from merge_candidates + the single-branch merge status.
 * In deferred merge mode, the entire shared branch is merged once. The merge_status
 * applies to all candidates uniformly (all merged or all failed).
 */
export function buildWaveMergeResults({ mergeCandidatesRaw = "[]", mergeStatus = "", mergeNotes = "", mergeResolver = "", pathTaken = "", pushStatus = "", factoryId = "", runId = "", repo = "", emitDomainEventFn } = {}) {
  const candidates = parseJson(String(mergeCandidatesRaw || "[]"), []);
  const arr = Array.isArray(candidates) ? candidates : [];
  const rawStatus = String(mergeStatus || "").trim();
  // When the LLM conflict resolution path pushes code to main successfully,
  // goal_merge_status is never set (only the normal merge_gate path sets it).
  // Fall back to push_status as a merge-success signal.
  const status = rawStatus || (String(pushStatus || "").trim() === "pushed" ? "pushed" : "");
  const notes = String(mergeNotes || "").trim();
  const resolver = String(mergeResolver || "").trim() || "unknown";
  const path = String(pathTaken || "").trim() || "merge";

  const isMerged = status === "merged" || status === "already_merged" || status === "pushed";
  const merged = [];
  const failed = [];

  for (const item of arr) {
    if (!item) continue;
    const result = {
      issue_number: String(item.issue_number || ""),
      branch: String(item.branch || ""),
      merge_status: status,
      merge_notes: notes,
      path_taken: path,
      "hatch.merge.resolver": resolver,
    };
    if (isMerged) merged.push(result);
    else failed.push(result);
  }

  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: merged.map((result) =>
      buildMergeCompletedEvent({
        factoryId,
        runId,
        issueNumber: result.issue_number,
        repo,
        branch: result.branch,
        mergeStatus: result.merge_status,
        mergeNotes: result.merge_notes,
        pathTaken: result.path_taken,
        mergeResolver: result["hatch.merge.resolver"],
      })),
    emitDomainEventFn,
  });

  return {
    merged_results: merged,
    merge_failures: failed,
    merged_count: merged.length,
    failed_count: failed.length,
    canonical_events: canonicalEvents,
  };
}

export function splitMergeResults(raw = "[]") {
  const data = parseJson(String(raw || "[]"), []);
  const merged = [];
  const failed = [];

  for (const entry of Array.isArray(data) ? data : []) {
    let item = entry;
    if (typeof item === "string") item = parseJson(item, null);
    if (!item || typeof item !== "object") continue;
    const status = String(item.merge_status || "").trim();
    if (status === "merged" || status === "already_merged") merged.push(item);
    else failed.push(item);
  }

  return {
    merged_results: merged,
    merge_failures: failed,
    merged_count: merged.length,
    failed_count: failed.length,
  };
}
