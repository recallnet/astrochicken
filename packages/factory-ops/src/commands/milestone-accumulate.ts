import { trim, parseJson } from "../lib/cli-helpers.ts";

export function accumulateMilestoneResult({
  implResultsRaw = "[]",
  completedRaw = "[]",
  processedRaw = "[]",
  itemRaw = "{}",
  fallbackIssueNumber = "",
  fallbackIssueTitle = "",
  consecutiveFailCountRaw = "0",
} = {}) {
  const impl = parseJson(String(implResultsRaw || "[]"), []);
  const completed = parseJson(String(completedRaw || "[]"), []);
  const processed = parseJson(String(processedRaw || "[]"), []);
  let item = parseJson(String(itemRaw || "{}"), {});
  if (typeof item === "string") item = parseJson(item, {});

  const fallbackIssue = String(fallbackIssueNumber || "").trim();
  const fallbackTitle = String(fallbackIssueTitle || "").trim();
  const rawItemIssue = String(item?.issue_number || "").trim();
  const staleIssueMismatch = fallbackIssue && rawItemIssue && rawItemIssue !== fallbackIssue;

  if (staleIssueMismatch) {
    const staleNotes = String(item?.review_notes || "").trim();
    item = {
      issue_number: fallbackIssue,
      issue_title: fallbackTitle || String(item?.issue_title || "").trim(),
      review_failed: "true",
      review_notes: staleNotes
        ? `Stale impl_result for issue ${rawItemIssue} while processing issue ${fallbackIssue}. ${staleNotes}`
        : `Stale impl_result for issue ${rawItemIssue} while processing issue ${fallbackIssue}; marked failed to prevent cross-issue replay corruption.`,
      stale_impl_result_issue_number: rawItemIssue,
    };
  }

  let issue = String(item?.issue_number || "").trim();
  if (!issue) issue = fallbackIssue;

  if (issue) {
    if (!item || typeof item !== "object") item = {};
    if (!item.issue_number) item.issue_number = issue;
    if (!item.issue_title && fallbackTitle) item.issue_title = fallbackTitle;

    const hasReviewFailed = Object.prototype.hasOwnProperty.call(item, "review_failed");
    const hasRealWork = item.branch || item.worktree_dir || item.review_evidence_path;

    if (!hasReviewFailed && !hasRealWork) {
      // No review_failed AND no execution evidence (branch, worktree, evidence path).
      // The coder subpipeline never ran for this issue — it was not attempted,
      // NOT a review failure. Do NOT stamp as failed. Do NOT add to impl_results.
      // This prevents handle_review_failures from quarantining issues that were
      // simply not reached in the current wave iteration.
    } else {
      if (!hasReviewFailed) {
        // Has some execution evidence but no review_failed — coder ran but
        // review step was skipped or crashed. Mark as failed.
        item.review_failed = "true";
        item.review_notes = item.review_notes || "Missing impl_result payload from issue execution; marked failed to prevent loop.";
      }

      impl.push(item);

      const failed = String(item?.review_failed || "").toLowerCase() === "true";
      if (!processed.includes(issue)) processed.push(issue);
      if (!failed && !completed.includes(issue)) completed.push(issue);
    }
  }

  const priorBranch = impl
    .map((entry) => String(entry?.branch || "").trim())
    .find((value) => value.length > 0) || "";
  const priorWorktreeDir = impl
    .map((entry) => String(entry?.worktree_dir || "").trim())
    .find((value) => value.length > 0) || "";
  const priorReviewEvidencePath = impl
    .map((entry) => String(entry?.review_evidence_path || "").trim())
    .find((value) => value.length > 0) || "";

  const reviewEvidencePath = String(item?.review_evidence_path || "").trim();

  const prevFailCount = Number.parseInt(String(consecutiveFailCountRaw || "0"), 10) || 0;
  const failed = issue ? String(item?.review_failed || "").toLowerCase() === "true" : false;
  const consecutiveFailCount = failed ? prevFailCount + 1 : 0;

  return {
    impl_results: impl,
    completed_issues: completed,
    processed_issues: processed,
    last_review_failed: issue ? (failed ? "true" : "false") : "false",
    last_review_notes: String(item?.review_notes || "").trim(),
    last_issue_number: issue || "",
    last_branch: String(item?.branch || "").trim(),
    branch: String(item?.branch || "").trim() || priorBranch,
    worktree_dir: String(item?.worktree_dir || "").trim() || priorWorktreeDir,
    last_review_evidence_path: reviewEvidencePath || priorReviewEvidencePath,
    consecutive_fail_count: consecutiveFailCount,
  };
}

export function accumulateMilestoneBatchResults({
  implResultsRaw = "[]",
  completedRaw = "[]",
  processedRaw = "[]",
  itemsRaw = "[]",
} = {}) {
  const items = parseJson(String(itemsRaw || "[]"), []);
  const queue = Array.isArray(items) ? items : [];

  let state = {
    impl_results: parseJson(String(implResultsRaw || "[]"), []),
    completed_issues: parseJson(String(completedRaw || "[]"), []),
    processed_issues: parseJson(String(processedRaw || "[]"), []),
    last_review_failed: "false",
    last_review_notes: "",
    last_issue_number: "",
    last_branch: "",
    branch: "",
    worktree_dir: "",
    last_review_evidence_path: "",
  };

  let firstFailed = null;

  for (const item of queue) {
    const out = accumulateMilestoneResult({
      implResultsRaw: JSON.stringify(state.impl_results || []),
      completedRaw: JSON.stringify(state.completed_issues || []),
      processedRaw: JSON.stringify(state.processed_issues || []),
      itemRaw: JSON.stringify(item || {}),
      fallbackIssueNumber: String(item?.issue_number || item?.number || ""),
      fallbackIssueTitle: String(item?.issue_title || item?.title || ""),
    });

    state = out;

    if (!firstFailed && String(out.last_review_failed || "").toLowerCase() === "true") {
      firstFailed = {
        last_review_failed: out.last_review_failed,
        last_review_notes: out.last_review_notes,
        last_issue_number: out.last_issue_number,
        last_branch: out.last_branch,
        last_review_evidence_path: out.last_review_evidence_path,
      };
    }
  }

  if (firstFailed) {
    return {
      ...state,
      ...firstFailed,
    };
  }

  return state;
}
