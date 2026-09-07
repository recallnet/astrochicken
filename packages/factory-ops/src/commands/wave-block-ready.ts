
import { syncBlockedBy } from "./triage-sync-blocked-by.ts";
import { releaseReadyWaveClaim } from "./wave-claim.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { trim } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
} from "../lib/factory-label-contract.ts";

export function blockReadyWaveIssue({
  repo,
  readyIssueNumber,
  milestoneTitle,
  reason = "blocked",
  runId = "",
  pipeline = "wave_execute",
  adapter,
  execGh,
  listMilestoneOpenIssuesFn,
  syncBlockedByFn = syncBlockedBy,
  releaseReadyWaveClaimFn = releaseReadyWaveClaim,
} = {}) {
  const issueNumber = Number(readyIssueNumber || 0);
  if (!repo || !issueNumber) {
    return { ok: false, issue_number: issueNumber, blocked_by: [], blocked_without_relationship: true, reason: "missing_repo_or_issue", failures: ["missing_repo_or_issue"] };
  }

  const githubAdapter = adapter || createGhCliAdapter({ repo });
  const executeMutation = execGh || ((args) => {
    const [entity, action, issueNumberArg, ...rest] = args;
    if (entity !== "issue") return { ok: false, stderr: "unsupported_command" };
    if (action === "comment") {
      const bodyIndex = rest.indexOf("--body");
      return githubAdapter.issueComment({
        number: issueNumberArg,
        body: bodyIndex >= 0 ? String(rest[bodyIndex + 1] || "") : "",
      });
    }
    if (action === "close") {
      const reasonIndex = rest.indexOf("--reason");
      return githubAdapter.issueClose({
        number: issueNumberArg,
        reason: reasonIndex >= 0 ? String(rest[reasonIndex + 1] || "completed") : "completed",
      });
    }
    if (action === "edit") {
      const removeLabelIndex = rest.indexOf("--remove-label");
      const removeLabels = removeLabelIndex >= 0
        ? String(rest[removeLabelIndex + 1] || "").split(",").filter(Boolean)
        : [];
      return githubAdapter.issueEdit({ number: issueNumberArg, removeLabels });
    }
    return { ok: false, stderr: "unsupported_command" };
  });
  const allInMilestone = adapter
    ? githubAdapter.issueList({
      state: "open",
      milestone: String(milestoneTitle || "").trim(),
      limit: 300,
      fields: "number,title,labels",
    })
    : (typeof listMilestoneOpenIssuesFn === "function"
      ? listMilestoneOpenIssuesFn(repo, String(milestoneTitle || "").trim())
      : githubAdapter.issueList({
      state: "open",
      milestone: String(milestoneTitle || "").trim(),
      limit: 300,
      fields: "number,title,labels",
    }));
  const blockers = allInMilestone
    .filter((i) => Number(i?.number) !== issueNumber)
    .filter((i) => !String(i?.title || "").startsWith("Wave Ready:"))
    .map((i) => Number(i?.number))
    .filter(Number.isFinite);

  const labelEdit = executeMutation(buildIssueLabelEditArgs({
    repo,
    issueNumber,
    factoryId: "mothership",
    removeKeys: [
      FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS,
      FACTORY_LABEL_KEYS.READY,
      FACTORY_LABEL_KEYS.BLOCKED,
    ],
  }));

  const releaseClaim = releaseReadyWaveClaimFn({
    repo,
    readyIssueNumber: issueNumber,
    milestoneTitle,
    runId,
    pipeline,
    reason,
  });

  const relationshipSync = syncBlockedByFn({
    repo,
    issueNumber,
    blockedByRaw: JSON.stringify(blockers),
  });

  const blockedWithoutRelationship = blockers.length === 0;
  const reasonText = reason === "judge_failed"
    ? "Wave failed judge. Removing ready marker until blockers are resolved."
    : "Wave run produced no merge candidates. Removing ready marker until code changes are submitted.";
  const blockerText = blockers.length > 0
    ? `Blocking relationships set to: ${blockers.map((n) => `#${n}`).join(", ")}.`
    : "BLOCKED_WITHOUT_BLOCKER_RELATIONSHIP: no in-milestone blocking issue found.";

  const commentResult = executeMutation(["issue", "comment", String(issueNumber), "--repo", repo, "--body", `${reasonText}\n\n${blockerText}`]);

  const closeResult = executeMutation(["issue", "close", String(issueNumber), "--repo", repo, "--reason", "not planned"]);

  const failures = [];
  if (!labelEdit?.ok) failures.push("label_edit_failed");
  if (!releaseClaim?.ok) failures.push("lease_release_failed");
  if (!commentResult?.ok) failures.push("comment_failed");
  if (!closeResult?.ok) failures.push("close_failed");

  return {
    ok: failures.length === 0,
    issue_number: issueNumber,
    reason,
    blocked_by: blockers,
    blocked_without_relationship: blockedWithoutRelationship,
    relationship_sync: relationshipSync,
    lease_release: releaseClaim,
    label_edit: labelEdit,
    comment: commentResult,
    close: closeResult,
    failures,
  };
}
