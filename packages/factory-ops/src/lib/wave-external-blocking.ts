import {
  describeUnblockCondition,
  isControlPlaneBlocked,
  isControlPlaneResolved,
  parseControlPlaneBlocker,
} from "./control-plane-blocker.ts";

function normalizeRepo(repo = "") {
  const [owner, name] = String(repo || "").split("/");
  return { owner: owner || "", name: name || "" };
}

function normalizeIssueLabels(issue) {
  return (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((label) => String(label?.name || label?.get?.("name") || "").trim())
    .filter(Boolean);
}

function isWaveMarker(issue) {
  return String(issue?.title || "").startsWith("Wave Ready:");
}

function isOpenExternalBlocker(blocker, milestoneTitle) {
  const state = String(blocker?.state || "").toUpperCase();
  const blockerMilestone = String(blocker?.milestone?.title || "").trim();
  return state === "OPEN" && blockerMilestone && blockerMilestone !== milestoneTitle;
}

function normalizeControlPlaneBlockedIssue(issueNumber, blocker = {}) {
  const normalized = parseControlPlaneBlocker(blocker);
  return {
    issue_number: issueNumber,
    blockerKind: normalized.kind || "",
    blockerRef: normalized.blockerRef || "",
    unblockCondition: describeUnblockCondition(normalized) || "",
    status: normalized.status || "",
  };
}

export function createGithubBlockedByLoader({ repo = "", ghJsonFn, adapter } = {}) {
  const { owner, name } = normalizeRepo(repo);
  return (issueNumber) => {
    if (adapter && issueNumber) {
      return adapter.issueBlockedBy({ number: issueNumber });
    }
    if (!owner || !name || !issueNumber || typeof ghJsonFn !== "function") return [];
    const query = `query { repository(owner:"${owner}", name:"${name}") { i: issue(number:${issueNumber}) { blockedBy(first:100){nodes{number state milestone{title}}} } } }`;
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`]);
    return out?.data?.repository?.i?.blockedBy?.nodes || [];
  };
}

export function evaluateMilestoneExternalBlocking({
  milestoneTitle = "",
  issues = [],
  getBlockedBy,
  getControlPlaneBlocker,
} = {}) {
  const title = String(milestoneTitle || "").trim();
  const activeIssues = (Array.isArray(issues) ? issues : []).filter((issue) => !isWaveMarker(issue));
  const blockedBy = [];
  const externallyBlockedIssueNumbers = [];
  const controlPlaneBlockedIssues = [];
  let hasRunnableIssue = false;

  for (const issue of activeIssues) {
    const issueNumber = Number(issue?.number);
    if (!Number.isFinite(issueNumber)) continue;

    const blockers = (typeof getBlockedBy === "function" ? getBlockedBy(issueNumber) : []) || [];
    blockedBy.push({ issue_number: issueNumber, blocked_by: blockers });

    const labels = normalizeIssueLabels(issue);
    if (labels.includes("quarantined")) continue;

    const controlPlaneBlocker = typeof getControlPlaneBlocker === "function"
      ? getControlPlaneBlocker(issue)
      : parseControlPlaneBlocker(issue);
    if (isControlPlaneBlocked(controlPlaneBlocker) && !isControlPlaneResolved(controlPlaneBlocker)) {
      controlPlaneBlockedIssues.push(normalizeControlPlaneBlockedIssue(issueNumber, controlPlaneBlocker));
      continue;
    }

    const openExternal = blockers.filter((blocker) => isOpenExternalBlocker(blocker, title));
    if (openExternal.length > 0) {
      externallyBlockedIssueNumbers.push(issueNumber);
      continue;
    }

    hasRunnableIssue = true;
  }

  return {
    has_runnable_issue: hasRunnableIssue,
    all_runnable_issues_externally_blocked: !hasRunnableIssue && externallyBlockedIssueNumbers.length > 0,
    all_runnable_issues_control_plane_blocked: !hasRunnableIssue && controlPlaneBlockedIssues.length > 0,
    externally_blocked_issue_numbers: externallyBlockedIssueNumbers.sort((a, b) => a - b),
    blocked_by: blockedBy.sort((a, b) => a.issue_number - b.issue_number),
    control_plane_blocked_issues: controlPlaneBlockedIssues.sort((a, b) => a.issue_number - b.issue_number),
  };
}
