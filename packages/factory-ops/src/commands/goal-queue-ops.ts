import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { listCanonicalIssueLifecycleForGoalSync } from "../lib/canonical-issue-lifecycle.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";

export function createLegacyReadAdapter({ repo, ghJsonFn } = {}) {
  const legacyRead = ghJsonFn;
  const [owner = "", name = ""] = String(repo || "").split("/");
  return {
    issueList({ state = "open", labels = [], limit = 100, fields = "number,title,labels" } = {}) {
      const args = ["issue", "list", "--repo", repo, "--state", state];
      if (Array.isArray(labels) && labels.length > 0) {
        args.push("--label", labels.join(","));
      }
      args.push("--limit", String(limit), "--json", fields);
      return legacyRead(args, []);
    },
    listSubIssues({ number } = {}) {
      return legacyRead(["api", `repos/${repo}/issues/${number}/sub_issues?per_page=100`], []);
    },
    issueBlockedBy({ number } = {}) {
      const payload = legacyRead([
        "api",
        "graphql",
        `query=query{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){i${number}:issue(number:${Number(number) || 0}){blockedBy(first:100){nodes{number state}}}}}`,
      ], {});
      return payload?.data?.repository?.[`i${number}`]?.blockedBy?.nodes
        || payload?.data?.repository?.issue?.blockedBy?.nodes
        || [];
    },
  };
}

function hasLabel(issue, name) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === name);
}

function normalizeIssueNumber(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isCanonicalIssueClosed(entry = {}) {
  if (entry?.shipped_to_main === true) return true;
  return String(entry?.github_close_status || "").trim().toLowerCase() === "closed";
}

function canonicalIssueNumbersByState(lifecycle = []) {
  const linked = new Set();
  const open = new Set();
  const closed = new Set();
  for (const entry of Array.isArray(lifecycle) ? lifecycle : []) {
    const issueNumber = normalizeIssueNumber(entry?.issue_number);
    if (!(issueNumber > 0)) continue;
    if (String(entry?.sub_issue_link_status || "").trim().toLowerCase() !== "linked") continue;
    linked.add(issueNumber);
    if (isCanonicalIssueClosed(entry)) closed.add(issueNumber);
    else open.add(issueNumber);
  }
  return { linked, open, closed };
}

export function reconcileCanonicalSubIssues({
  repo = "",
  factoryId = "",
  goalNumber = "",
  subIssues = [],
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
} = {}) {
  const normalizedGoalNumber = normalizeIssueNumber(goalNumber);
  if (!repo || !(normalizedGoalNumber > 0) || typeof listCanonicalIssueLifecycleFn !== "function") {
    return Array.isArray(subIssues) ? subIssues : [];
  }

  let lifecycle = [];
  try {
    lifecycle = listCanonicalIssueLifecycleFn({
      repo,
      factoryId,
      goalNumber: String(normalizedGoalNumber),
    });
  } catch {
    return Array.isArray(subIssues) ? subIssues : [];
  }
  const { linked, open, closed } = canonicalIssueNumbersByState(lifecycle);
  if (linked.size === 0) return Array.isArray(subIssues) ? subIssues : [];

  const byNumber = new Map();
  for (const issue of Array.isArray(subIssues) ? subIssues : []) {
    const issueNumber = normalizeIssueNumber(issue?.number);
    if (!(issueNumber > 0)) continue;
    byNumber.set(issueNumber, issue);
  }

  const reconciled = [];
  const included = new Set();
  for (const issueNumber of [...linked].sort((left, right) => left - right)) {
    included.add(issueNumber);
    const current = byNumber.get(issueNumber);
    if (current) {
      if (closed.has(issueNumber)) {
        reconciled.push({ ...current, state: "closed" });
      } else {
        reconciled.push(current);
      }
      continue;
    }
    if (open.has(issueNumber)) {
      reconciled.push({
        number: issueNumber,
        state: "open",
        blocked_by_count: 0,
        labels: [],
        canonical_only: true,
      });
      continue;
    }
    if (closed.has(issueNumber)) {
      reconciled.push({
        number: issueNumber,
        state: "closed",
        blocked_by_count: 0,
        labels: [],
        canonical_only: true,
      });
    }
  }

  for (const issue of Array.isArray(subIssues) ? subIssues : []) {
    const issueNumber = normalizeIssueNumber(issue?.number);
    if (!(issueNumber > 0) || included.has(issueNumber)) continue;
    // @context:integration !critical GitHub's live sub-issue graph is the
    // current parent/child truth. Canonical lifecycle can lag after manual
    // relinks or recovery repair, so dropping raw linked children here can
    // starve ready goals even though the repo graph is already correct.
    reconciled.push(issue);
  }

  return reconciled;
}

export function isBlockedByOpenRelationships(blockedByNodes = []) {
  return (Array.isArray(blockedByNodes) ? blockedByNodes : []).some((n) => String(n?.state || "").toUpperCase() === "OPEN");
}

export function listReadyGoals({
  repo,
  adapter,
  ghJsonFn,
  factoryId = "",
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
} = {}) {
  if (!repo) return [];
  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo, ghJsonFn }) : null)
    || createGhCliAdapter({ repo });
  const goals = githubAdapter.issueList({
    state: "open",
    labels: ["goal"],
    limit: 100,
    fields: "number,title,labels",
  });

  const ready = goals.filter((g) => hasLabel(g, "ready"));

  const QUARANTINED = new Set(["quarantined"]);
  return ready
    .map((g) => {
      const blockedBy = githubAdapter.issueBlockedBy({ number: g.number });
      const subIssues = reconcileCanonicalSubIssues({
        repo,
        factoryId,
        goalNumber: g.number,
        subIssues: githubAdapter.listSubIssues({ number: g.number }),
        listCanonicalIssueLifecycleFn,
      });
      const allSubIssues = Array.isArray(subIssues) ? subIssues : [];
      const openSubIssues = allSubIssues.filter(
        (item) => String(item?.state || "").toLowerCase() === "open",
      );
      // A goal is dispatchable when it either needs decomposition (no open
      // sub-issues) or has at least one open sub-issue that is unblocked and
      // not quarantined (ready for execution).
      const hasDispatchableSubIssue = openSubIssues.some((item) => {
        if (Number(item?.blocked_by_count ?? 0) > 0) return false;
        const labels = Array.isArray(item?.labels) ? item.labels : [];
        if (labels.some((l) => QUARANTINED.has(String(l?.name || l || "").toLowerCase()))) return false;
        return true;
      });
      const decomposed = allSubIssues.length > 0;
      return {
        ...g,
        blocked_by: blockedBy,
        blocked: isBlockedByOpenRelationships(blockedBy),
        is_bug: hasLabel(g, "bug"),
        decomposed,
        // Goal is eligible when: not blocked AND (needs decomposition OR has
        // dispatchable sub-issues).  Old logic excluded all decomposed goals,
        // starving goals whose sub-issues were ready for execution (e.g. Daily
        // Lens follow-ups).
        dispatchable: decomposed ? hasDispatchableSubIssue : true,
      };
    })
    .filter((g) => !g.blocked && g.dispatchable)
    .sort((a, b) => {
      // Bugs first (fast-track), then by issue number (stable order)
      if (a.is_bug !== b.is_bug) return a.is_bug ? -1 : 1;
      return a.number - b.number;
    });
}

export function evaluateGoalDecomposeBackpressure({
  repo,
  maxConcurrentGoals,
  maxConcurrentWaves,
  adapter,
  ghJsonFn,
  listSubIssuesFn,
  factoryId = "",
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
} = {}) {
  const capacityInput = maxConcurrentGoals || maxConcurrentWaves || "1";
  const max = Math.max(1, Number.parseInt(String(capacityInput), 10) || 1);
  if (!repo) {
    return {
      decompose_allowed: "true",
      decompose_skip_reason: "missing_repo",
      executable_goal_count: 0,
      max_concurrent_goals: max,
    };
  }

  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo, ghJsonFn }) : null)
    || createGhCliAdapter({ repo });
  const goals = githubAdapter.issueList({
    state: "open",
    labels: ["goal"],
    limit: 100,
    fields: "number,title,labels",
  });
  const resolveSubIssues = listSubIssuesFn || ((goalNumber) => githubAdapter.listSubIssues({ number: goalNumber }));
  const QUARANTINED = new Set(["quarantined"]);
  const executableGoalCount = (Array.isArray(goals) ? goals : []).filter((goal) => {
    const labels = (goal?.labels || []).map((label) => String(label?.name || ""));
    if (!labels.includes("ready")) return false;
    const subIssues = reconcileCanonicalSubIssues({
      repo,
      factoryId,
      goalNumber: goal.number,
      subIssues: resolveSubIssues(goal.number),
      listCanonicalIssueLifecycleFn,
    });
    return (Array.isArray(subIssues) ? subIssues : []).some((issue) => {
      if (String(issue?.state || "").toLowerCase() !== "open") return false;
      if (Number(issue?.blocked_by_count ?? 0) > 0) return false;
      const issueLabels = (Array.isArray(issue?.labels) ? issue.labels : []);
      if (issueLabels.some((l) => QUARANTINED.has(String(l?.name || l || "").toLowerCase()))) return false;
      return true;
    });
  }).length;

  if (executableGoalCount >= max) {
    return {
      decompose_allowed: "false",
      decompose_skip_reason: "goal_execution_backlog_at_or_above_capacity",
      executable_goal_count: executableGoalCount,
      max_concurrent_goals: max,
    };
  }

  return {
    decompose_allowed: "true",
    decompose_skip_reason: executableGoalCount > 0 ? "below_goal_execution_capacity" : "no_executable_goals",
    executable_goal_count: executableGoalCount,
    max_concurrent_goals: max,
  };
}

export function applyGoalDecisions({ repo, decisionsRaw = "[]", adapter } = {}) {
  const decisions = parseJson(String(decisionsRaw || "[]"), []);
  const applied = [];
  const githubAdapter = repo ? (adapter || createGhCliAdapter({ repo })) : null;

  for (const item of decisions) {
    const num = String(item?.issue_number || "").trim();
    const decision = String(item?.decision || "").trim();
    const canonical = String(item?.canonical_issue || "").trim();
    const reason = String(item?.reason || "").trim();
    if (!num || decision === "keep") continue;

    if (decision === "duplicate" && canonical && canonical !== "0") {
      githubAdapter?.issueComment({
        number: num,
        body: `Duplicate of #${canonical}. Closing in favor of the canonical goal. ${reason}`.trim(),
      });
      githubAdapter?.issueClose({ number: num, reason: "not planned" });
      applied.push({ issue_number: Number(num), decision, canonical_issue: Number(canonical) });
      continue;
    }

    if (decision === "close") {
      githubAdapter?.issueComment({
        number: num,
        body: `Closing goal as completed/obsolete. ${reason}`.trim(),
      });
      githubAdapter?.issueClose({ number: num, reason: "completed" });
      applied.push({ issue_number: Number(num), decision, canonical_issue: 0 });
    }
  }

  return { applied_count: applied.length, applied };
}

export function filterKeptGoals({ issuesRaw = "[]", decisionsRaw = "[]" } = {}) {
  const issues = parseJson(String(issuesRaw || "[]"), []);
  const decisions = parseJson(String(decisionsRaw || "[]"), []);
  const index = new Map(decisions.map((d) => [String(d?.issue_number || ""), String(d?.decision || "keep")]));

  return issues
    .filter((item) => {
      const num = String(item?.number || "");
      const decision = index.get(num) || "keep";
      return decision === "keep";
    })
    .map((item) => Number(item.number))
    .filter(Number.isFinite);
}

export function limitKeptGoalsForTick({ keptGoalsRaw = "[]", maxGoalsPerTick = "2" } = {}) {
  const goals = parseJson(String(keptGoalsRaw || "[]"), [])
    .map((n) => Number(n))
    .filter(Number.isFinite);
  const max = Math.max(1, Number.parseInt(String(maxGoalsPerTick || "2"), 10) || 2);
  return goals.slice(0, max);
}

export function computeGoalRunCloseCondition({ issueCount = "0", approvedFeatureCount = "" } = {}) {
  const issues = Number.parseInt(String(issueCount || "0"), 10) || 0;
  const approvedFeatures = Number.parseInt(String(approvedFeatureCount || "0"), 10) || 0;
  if (issues <= 0) return "false";
  if (approvedFeatures <= 0) return "false";
  return issues >= approvedFeatures ? "true" : "false";
}

// Count pre-decompose attempt markers (posted BEFORE intake_decompose runs).
// This ensures the counter increments even when intake_decompose crashes —
// fixing the infinite retry loop where keep_open was unreachable on failure.
const DECOMPOSE_ATTEMPT_MARKER = "<!-- goal-run:decompose-attempt -->";
const DECOMPOSE_EXHAUSTED_MARKER = "<!-- goal-run:decompose-exhausted -->";

export function countDecomposeAttempts({ comments } = {}) {
  const list = Array.isArray(comments) ? comments : [];
  return list.filter((c) => String(c?.body || "").includes(DECOMPOSE_ATTEMPT_MARKER)).length;
}

export function countDecomposeAttemptsFromIssue({ issue } = {}) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  const hasReady = labels.some((label) => String(label?.name || label || "") === "ready");
  const comments = Array.isArray(issue?.comments) ? issue.comments : [];
  const latestExhaustedIndex = comments.findLastIndex((comment) =>
    String(comment?.body || "").includes(DECOMPOSE_EXHAUSTED_MARKER)
  );

  if (hasReady && latestExhaustedIndex >= 0) {
    return countDecomposeAttempts({
      comments: comments.slice(latestExhaustedIndex + 1),
    });
  }

  return countDecomposeAttempts({ comments });
}

export function countDecomposeAttemptsFromGitHub({ repo, issueNumber } = {}) {
  if (!repo || !issueNumber) return "0";
  const issue = createGhCliAdapter({ repo }).issueView({ number: issueNumber, fields: "comments,labels" });
  return String(countDecomposeAttemptsFromIssue({ issue }));
}
