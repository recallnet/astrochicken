import { listGoalSubIssues } from "./goal-sub-issues.ts";
import { fetchGoalIssue } from "./milestone-fetch-goal-issue.ts";
import { ghJson, parseJson } from "../lib/cli-helpers.ts";
import { parseGoalExecutionStickyState } from "../lib/goal-execution-path-packet.ts";

const QUARANTINED_LABELS = new Set(["quarantined"]);

function isQuarantined(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => QUARANTINED_LABELS.has(String(l?.name || l || "").toLowerCase()));
}

/**
 * Topologically sort sub-issues by their blocked_by relationships.
 *
 * Computes a fixed execution order at the start of a goal_execute run.
 * The plan is invariant for the entire run — no live re-querying.
 *
 * @param {{ subIssues: Array, blockedByMap: Object, completedIssues: string[] }} opts
 * @returns {{ execution_plan: Array<{issue_number: string, issue_title: string}>, total: number, planned: number, cycle_blocked: number, quarantined: number }}
 */
export function buildExecutionPlan({
  subIssues = [],
  blockedByMap = {},
  completedIssues = [],
} = {}) {
  const completed = new Set((Array.isArray(completedIssues) ? completedIssues : []).map(String));

  // Filter to open, not-yet-completed, not-quarantined sub-issues
  const allOpen = (Array.isArray(subIssues) ? subIssues : [])
    .filter((i) => i && typeof i === "object")
    .filter((i) => String(i.state || "").toLowerCase() === "open")
    .filter((i) => !completed.has(String(i.number)));

  const quarantined = allOpen.filter((i) => isQuarantined(i));
  const pending = allOpen.filter((i) => !isQuarantined(i));
  const pendingSet = new Set(pending.map((i) => i.number));

  // Build in-degree map from blocked_by relationships.
  // Only count blockers that are (a) within the pending set and (b) OPEN.
  const inDegree = new Map();
  const dependents = new Map(); // blocker -> [issues it blocks]

  for (const issue of pending) {
    inDegree.set(issue.number, 0);
  }

  for (const issue of pending) {
    const blockers = Array.isArray(blockedByMap[issue.number]) ? blockedByMap[issue.number] : [];
    for (const blocker of blockers) {
      const blockerNum = Number(blocker.number);
      const blockerState = String(blocker.state || "").toUpperCase();
      if (!pendingSet.has(blockerNum)) continue; // external or already completed
      if (blockerState !== "OPEN") continue; // already resolved
      inDegree.set(issue.number, (inDegree.get(issue.number) || 0) + 1);
      if (!dependents.has(blockerNum)) dependents.set(blockerNum, []);
      dependents.get(blockerNum).push(issue.number);
    }
  }

  // Kahn's algorithm — stable by issue number (lowest first)
  const queue = pending
    .filter((i) => (inDegree.get(i.number) || 0) === 0)
    .sort((a, b) => a.number - b.number);

  const order = [];
  const visited = new Set();

  while (queue.length > 0) {
    const issue = queue.shift();
    if (visited.has(issue.number)) continue;
    visited.add(issue.number);
    order.push(issue);

    const deps = dependents.get(issue.number) || [];
    // Collect newly-unblocked, then sort for stable insertion
    const newlyUnblocked = [];
    for (const depNum of deps) {
      const newDeg = (inDegree.get(depNum) || 1) - 1;
      inDegree.set(depNum, newDeg);
      if (newDeg === 0 && !visited.has(depNum)) {
        const depIssue = pending.find((i) => i.number === depNum);
        if (depIssue) newlyUnblocked.push(depIssue);
      }
    }
    newlyUnblocked.sort((a, b) => a.number - b.number);
    for (const dep of newlyUnblocked) {
      // Insert in sorted position within queue
      const idx = queue.findIndex((q) => q.number > dep.number);
      if (idx === -1) queue.push(dep);
      else queue.splice(idx, 0, dep);
    }
  }

  return {
    execution_plan: order.map((i) => ({
      issue_number: String(i.number),
      issue_title: String(i.title || ""),
    })),
    total: pending.length,
    planned: order.length,
    cycle_blocked: pending.length - order.length,
    quarantined: quarantined.length,
  };
}

/**
 * Batch-fetch blockedBy relationships for multiple issues via GraphQL.
 *
 * Returns a map: { [issueNumber]: [{ number, state }] }
 *
 * @param {{ repo: string, issueNumbers: number[], ghJsonFn?: Function }} opts
 */
export function fetchSubIssueBlockedBy({
  repo = "",
  issueNumbers = [],
  ghJsonFn = ghJson,
} = {}) {
  const nums = (Array.isArray(issueNumbers) ? issueNumbers : []).filter((n) => n > 0);
  if (!repo || nums.length === 0) return {};

  const [owner, name] = String(repo).split("/");
  if (!owner || !name) return {};

  // Build a single GraphQL query with aliased fields per issue
  const fields = nums
    .map((n) => `i${n}: issue(number:${n}){ blockedBy(first:50){ nodes{ number state } } }`)
    .join(" ");
  const query = `query{ repository(owner:\\"${owner}\\", name:\\"${name}\\"){ ${fields} } }`;

  try {
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], null);
    const repoData = out?.data?.repository || {};
    const result = {};
    for (const n of nums) {
      result[n] = repoData[`i${n}`]?.blockedBy?.nodes || [];
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Build execution plan from a goal's sub-issues (IO wrapper).
 *
 * Queries sub-issues and their blocked_by relationships, then toposorts.
 *
 * @param {{
 *   repo: string,
 *   goalNumber: string|number,
 *   completedIssues?: string[],
 *   directExecution?: string|boolean,
 *   directExecutionPath?: string,
 *   goalRoutingState?: string|object,
 *   goalExecutionPathVersion?: string,
 *   goalExecutionPathPacketId?: string,
 *   listSubIssuesFn?: Function,
 *   fetchBlockedByFn?: Function,
 *   fetchGoalIssueFn?: Function,
 * }} opts
 */
export function buildExecutionPlanFromGoal({
  repo = "",
  goalNumber = "",
  completedIssues = [],
  directExecution = "",
  directExecutionPath = "",
  goalRoutingState = {},
  goalExecutionPathVersion = "",
  goalExecutionPathPacketId = "",
  listSubIssuesFn = listGoalSubIssues,
  fetchBlockedByFn = fetchSubIssueBlockedBy,
  fetchGoalIssueFn = fetchGoalIssue,
} = {}) {
  if (!repo || !goalNumber) {
    return {
      execution_plan: [],
      total: 0,
      planned: 0,
      cycle_blocked: 0,
      quarantined: 0,
      direct_execution: false,
      plan_type: "goal_decomposed_execute",
    };
  }

  const normalizedPath = String(directExecutionPath || "").trim().toLowerCase();
  const directFlag = String(directExecution || "").trim().toLowerCase();
  const goalRoutingStateObject = goalRoutingState && typeof goalRoutingState === "object" && !Array.isArray(goalRoutingState)
    ? { ...goalRoutingState }
    : parseJson(String(goalRoutingState || "{}"), {});
  const stickyState = parseGoalExecutionStickyState({
    decompositionState: goalRoutingStateObject?.decomposition_state,
    planningState: goalRoutingStateObject?.planning_state,
  });
  const planningRequired = String(stickyState?.planning_state || "").trim().toLowerCase() === "required";
  const routeVersion = String(goalExecutionPathVersion || "").trim();
  const routePacketId = String(goalExecutionPathPacketId || "").trim();
  const directRequested = directFlag === "true"
    || directExecution === true
    || (normalizedPath === "easy" && !planningRequired && Boolean(routeVersion) && Boolean(routePacketId));

  if (directRequested) {
    let goalIssue = {};
    try {
      goalIssue = fetchGoalIssueFn({ repo, goalNumber }) || {};
    } catch {
      goalIssue = {};
    }
    return {
      execution_plan: [{
        issue_number: String(goalNumber),
        issue_title: String(goalIssue?.title || ""),
        plan_type: "goal_issue_execute",
        direct_execution: true,
      }],
      total: 1,
      planned: 1,
      cycle_blocked: 0,
      quarantined: 0,
      direct_execution: true,
      plan_type: "goal_issue_execute",
    };
  }

  const subIssues = listSubIssuesFn({ repo, goalNumber });
  const openNumbers = subIssues
    .filter((i) => String(i.state || "").toLowerCase() === "open")
    .map((i) => i.number);

  const blockedByMap = openNumbers.length > 0
    ? fetchBlockedByFn({ repo, issueNumbers: openNumbers })
    : {};

  const plan = buildExecutionPlan({ subIssues, blockedByMap, completedIssues });
  return {
    ...plan,
    direct_execution: false,
    plan_type: "goal_decomposed_execute",
  };
}

/**
 * Pick the next issue from a pre-computed execution plan by index.
 *
 * @param {{ executionPlanRaw: string, planIndex: number|string }} opts
 */
export function pickPlanIssue({
  executionPlanRaw = "[]",
  planIndex = 0,
} = {}) {
  const plan = parseJson(String(executionPlanRaw || "[]"), []);
  const arr = Array.isArray(plan) ? plan : [];
  const idx = Number.parseInt(String(planIndex ?? "0"), 10) || 0;

  if (idx >= arr.length || arr.length === 0) {
    return {
      has_next: false,
      next_issue_number: "",
      next_issue_title: "",
      plan_index: idx,
      remaining_count: 0,
    };
  }

  const item = arr[idx];
  return {
    has_next: true,
    next_issue_number: String(item?.issue_number || ""),
    next_issue_title: String(item?.issue_title || ""),
    plan_index: idx,
    remaining_count: arr.length - idx,
  };
}
