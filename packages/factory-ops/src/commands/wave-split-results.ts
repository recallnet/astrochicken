import { readFileSync } from "node:fs";
import { join } from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";


function readImplResultsFromState(runId, runsDir = ".hatch/runs") {
  if (!runId) return "";
  try {
    const statePath = join(runsDir, runId, "state.json");
    const state = parseJson(readFileSync(statePath, "utf8"), null);
    return String(state?.context?.impl_results || "");
  } catch {
    return "";
  }
}

export function splitWaveImplResults(raw) {
  const data = parseJson(String(raw || ""), []);
  const latestByIssue = new Map();

  for (const entry of Array.isArray(data) ? data : []) {
    if (!entry) continue;
    let item = entry;
    if (typeof item === "string") item = parseJson(item, null);
    if (!item || typeof item !== "object") continue;
    const issueNumber = String(item.issue_number || "").trim();
    if (!issueNumber) continue;
    latestByIssue.set(issueNumber, item);
  }

  const merge = [];
  const failures = [];

  for (const item of latestByIssue.values()) {
    const disposition = String(item.disposition || "").trim().toLowerCase();
    if (disposition === "infra_failure") continue;
    if (disposition === "done_elsewhere") continue;
    const flag = item.review_failed;
    const failed = flag === true || ["true", "1", "yes"].includes(String(flag || "").trim().toLowerCase());
    if (failed) {
      // Only count as a real failure if execution evidence exists.
      // Items with no branch/worktree/evidence were never attempted —
      // they must NOT feed into handle_review_failures → quarantine.
      const hasEvidence = item.branch || item.worktree_dir || item.review_evidence_path;
      if (hasEvidence) {
        failures.push(item);
      }
      // Items without evidence are silently dropped — they stay in the
      // backlog for the next wave cycle.
      continue;
    }
    // Skip items already merged inline by wave_issue_execute
    const alreadyMerged = item.merged === true || ["true", "1", "yes"].includes(String(item.merged || "").trim().toLowerCase());
    if (alreadyMerged) continue;
    merge.push(item);
  }

  return { merge_candidates: merge, review_failures: failures };
}

export function checkMergeCandidates(mergeCandidatesRaw = "[]") {
  const data = parseJson(String(mergeCandidatesRaw || "[]"), []);
  const arr = Array.isArray(data) ? data : [];
  const count = arr.filter(Boolean).length;
  return { has_merge_candidates: count > 0 ? "true" : "false", merge_candidate_count: String(count) };
}

export function splitWaveImplResultsFromSources({ runId = "", runsDir = ".hatch/runs", stdinRaw = "", fallbackRaw = "" } = {}) {
  const fromState = readImplResultsFromState(runId, runsDir).trim();
  const fromStdin = String(stdinRaw || "").trim();
  const fromFallback = String(fallbackRaw || "").trim();
  const chosen = fromState || fromStdin || fromFallback;
  return splitWaveImplResults(chosen);
}
