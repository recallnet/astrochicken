import { ensureHumanBlockerIssue, parseHumanBlocker } from "./human-blocker.ts";
import { syncBlockedBy } from "./triage-sync-blocked-by.ts";
import { trim, parseJson, gh } from "../lib/cli-helpers.ts";

/**
 * Apply human_blocker and control_plane_blocker from approved features
 * to the created GitHub issues. Replaces triage's per-item blocker application.
 */
export function applyFeatureBlockers({
  repo = "",
  goalIssueNumber = 0,
  featureIssueMap = "[]",
  ensureHumanBlockerFn = ensureHumanBlockerIssue,
  syncBlockedByFn = syncBlockedBy,
  runGhFn = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return { ok: false, error: "repo is required" };
  }

  const goalNumber = Number(goalIssueNumber || 0);
  const items = parseJson(String(featureIssueMap || "[]"), []);
  if (!Array.isArray(items)) {
    return { ok: false, error: "featureIssueMap must be a JSON array" };
  }

  let humanBlockersApplied = 0;
  let controlPlaneBlockersApplied = 0;
  const errors = [];

  for (const item of items) {
    const feature = item?.feature;
    const issueNumber = Number(item?.issue_number || 0);
    if (!feature || !issueNumber) continue;

    // Apply human_blocker
    if (feature.human_blocker && typeof feature.human_blocker === "object") {
      const blocker = parseHumanBlocker(feature.human_blocker, null);
      if (blocker) {
        const result = ensureHumanBlockerFn({
          repo: normalizedRepo,
          issueNumber,
          goalIssueNumber: goalNumber,
          humanBlockerRaw: JSON.stringify(blocker),
          blockedByRaw: "[]",
        });

        if (result?.ok) {
          humanBlockersApplied += 1;
          // Sync the blocked_by relationship
          if (result.effective_blocked_by) {
            syncBlockedByFn({
              repo: normalizedRepo,
              issueNumber,
              blockedByRaw: result.effective_blocked_by,
            });
          }
        } else {
          errors.push({ issue_number: issueNumber, type: "human_blocker", error: result?.error || "failed" });
        }
      }
    }

    // Apply control_plane_blocker
    if (feature.control_plane_blocker && typeof feature.control_plane_blocker === "object") {
      const cpb = feature.control_plane_blocker;
      const kind = trim(cpb.kind);
      const blockerRef = trim(cpb.blockerRef);
      const unblockCondition = trim(cpb.unblockCondition);

      if (kind && unblockCondition) {
        // Add a comment with the control plane blocker details
        const comment = [
          `Control-plane blocker: ${kind}`,
          blockerRef ? `Blocker ref: ${blockerRef}` : "",
          `Unblock condition: ${unblockCondition}`,
          `Status: blocked`,
        ].filter(Boolean).join("\n");

        runGhFn([
          "issue", "comment", String(issueNumber),
          "--repo", normalizedRepo,
          "--body", comment,
        ]);

        controlPlaneBlockersApplied += 1;
      }
    }
  }

  return {
    ok: true,
    human_blockers_applied: humanBlockersApplied,
    control_plane_blockers_applied: controlPlaneBlockersApplied,
    errors,
  };
}
