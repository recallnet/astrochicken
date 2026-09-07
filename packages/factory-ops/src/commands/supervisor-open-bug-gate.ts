import { resolveSupervisorGhJsonFn } from "./supervisor-backend-query-seams.ts";
import { trim } from "../lib/cli-helpers.ts";

function parseJsonSafe(raw = "", fallback = null) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return fallback;
  }
}


function asPositiveInt(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseRepo(repo = "") {
  const [owner, name] = String(repo || "").split("/");
  return {
    owner: trim(owner),
    name: trim(name),
  };
}

function parseWorkflowRunIdFromBugBody(body = "") {
  const match = String(body || "").match(/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/(\d+)/i);
  return match ? String(match[1]) : "";
}

function isCiFailureBug(bug = {}) {
  return /^CI:\s*failures on main @/i.test(String(bug?.title || ""));
}

function normalizeRunTerminalConclusion(value = "") {
  return trim(value).toLowerCase();
}

function isBlockingWorkflowRunStatus(run = {}) {
  const status = trim(run?.status).toLowerCase();
  if (!status || status !== "completed") return false;
  const conclusion = normalizeRunTerminalConclusion(run?.conclusion);
  if (!conclusion) return true;
  return !["success", "neutral", "skipped", "cancelled"].includes(conclusion);
}

function shouldKeepOpenBugAsBlocking(bug = {}, { repo = "", ghJsonFn } = {}) {
  if (!isCiFailureBug(bug)) return true;
  const runId = parseWorkflowRunIdFromBugBody(bug?.body || "");
  if (!runId || !trim(repo)) return true;
  try {
    // @context:regression !critical CI bug issues are filed before the referenced run
    // has settled. Treating in-progress runs as blocking starves the supervisor bug-fast
    // lane on speculative incidents instead of verified failures.
    const run = ghJsonFn(["run", "view", runId, "--repo", trim(repo), "--json", "status,conclusion"], null);
    if (!run || typeof run !== "object" || Array.isArray(run)) return true;
    const status = trim(run?.status).toLowerCase();
    if (!status || status !== "completed") return false;
    return isBlockingWorkflowRunStatus(run);
  } catch {
    return true;
  }
}

export function filterSnapshotVisibleOpenBugs(openBugs = [], { repo = "", ghJsonFn } = {}) {
  return (Array.isArray(openBugs) ? openBugs : [])
    .filter((bug) => bug && typeof bug === "object")
    .filter((bug) => shouldKeepOpenBugAsBlocking(bug, { repo, ghJsonFn }));
}

export function filterBlockingOpenBugs(openBugs = [], { repo = "", labelFilters = [], ghJsonFn } = {}) {
  return filterSnapshotVisibleOpenBugs(openBugs, { repo, ghJsonFn })
    .filter((bug) => !isNonBlockingOpenBug(bug))
    .filter((bug) => !isBlockedByOpenDependency(bug))
    .filter((bug) => bugMatchesLabelFilters(bug, labelFilters))
}


function extractBugClassificationFromBody(body = "") {
  const text = String(body || "");
  if (!text.trim()) return "";

  const fenced = Array.from(text.matchAll(/```json\s*([\s\S]*?)\s*```/gi));
  for (const block of fenced) {
    const parsed = parseJsonSafe(block?.[1] || "", null);
    const classification = trim(
      parsed?.classification
      || parsed?.evidence?.classification
      || parsed?.ownership_hint
      || parsed?.evidence?.ownership_hint,
    ).toLowerCase();
    if (classification) return classification;
  }

  const inlineMatch = text.match(/"classification"\s*:\s*"([^"]+)"/i);
  return trim(inlineMatch?.[1] || "").toLowerCase();
}

function extractBugClassification(bug = {}) {
  const direct = trim(bug?.classification || bug?.evidence?.classification || bug?.payload?.classification || bug?.payload?.evidence?.classification).toLowerCase();
  if (direct) return direct;
  return extractBugClassificationFromBody(String(bug?.body || ""));
}

function hasNeedsTriageLabel(bug = {}) {
  const issueLabels = (Array.isArray(bug?.labels) ? bug.labels : [])
    .map((label) => String(label?.name || label || "").trim().toLowerCase())
    .filter(Boolean);
  return issueLabels.includes("needs-triage");
}

function resolveGoalMilestone(bug = {}) {
  const title = String(bug?.milestone?.title || bug?.milestone || "").trim();
  return /^goal-\d+-wave-/.test(title) ? title : "";
}

function isWaveManagedBug(bug = {}) {
  return resolveGoalMilestone(bug) !== "";
}

function isGoalManagedBug(bug = {}) {
  return bug?.goal_managed === true;
}

function isNonBlockingOpenBug(bug = {}) {
  if (isWaveManagedBug(bug)) return true;
  if (isGoalManagedBug(bug)) return true;
  const title = String(bug?.title || "");
  if (/^\[bug\]\s*wave-issue-giveup-/i.test(title)) return true;
  if (hasNeedsTriageLabel(bug)) return true;
  return extractBugClassification(bug) === "needs-triage";
}

function resolveBlockedByNodes(bug = {}) {
  if (Array.isArray(bug?.blocked_by)) return bug.blocked_by;
  if (Array.isArray(bug?.blockedBy)) return bug.blockedBy;
  if (Array.isArray(bug?.blockedBy?.nodes)) return bug.blockedBy.nodes;
  return [];
}

export function isBlockedByOpenRelationships(blockedByNodes = []) {
  return (Array.isArray(blockedByNodes) ? blockedByNodes : []).some((node) => String(node?.state || "").toUpperCase() === "OPEN");
}

function isBlockedByOpenDependency(bug = {}) {
  return isBlockedByOpenRelationships(resolveBlockedByNodes(bug));
}

function normalizeLabelFilters(labelFilters = []) {
  return Array.from(new Set(
    (Array.isArray(labelFilters) ? labelFilters : [])
      .map((label) => trim(label))
      .filter(Boolean),
  ));
}

function extractIssueLabels(bug = {}) {
  return (Array.isArray(bug?.labels) ? bug.labels : [])
    .map((label) => String(label?.name || label || "").trim())
    .filter(Boolean);
}

function bugMatchesLabelFilters(bug = {}, labelFilters = []) {
  const filters = normalizeLabelFilters(labelFilters);
  if (filters.length === 0) return true;
  const issueLabels = extractIssueLabels(bug);
  if (issueLabels.length === 0) return false;
  const issueLabelSet = new Set(issueLabels);
  return filters.every((label) => issueLabelSet.has(label));
}

export function extractSnapshotOpenBugs(parsed = {}, { labelFilters = [] } = {}) {
  const fromOpenBugs = Array.isArray(parsed?.open_bugs) ? parsed.open_bugs : [];
  const fromOpenBugBatch = Array.isArray(parsed?.open_bug_batch?.bugs) ? parsed.open_bug_batch.bugs : [];
  const merged = fromOpenBugs.length > 0 ? fromOpenBugs : fromOpenBugBatch;
  return filterBlockingOpenBugs(merged, { labelFilters });
}

function normalizeIssueNumbers(openBugs = []) {
  const issueNumbers = openBugs
    .map((bug) => asPositiveInt(bug?.number))
    .filter((number) => number > 0);
  return Array.from(new Set(issueNumbers)).sort((a, b) => a - b);
}

function queryOpenBugsWithDiagnostics(args = [], ghJsonFn) {
  const payload = ghJsonFn(args, null);
  if (payload === null) {
    return {
      payload: null,
      parseError: "gh_issue_list_failed",
    };
  }
  if (!Array.isArray(payload)) {
    return {
      payload: null,
      parseError: "open_bugs_malformed_payload",
    };
  }
  return { payload, parseError: "" };
}

export function fetchBugBlockedBy({ repo = "", issueNumber = 0, ghJsonFn } = {}) {
  const batch = fetchBugBlockedByBatch({ repo, issueNumbers: [issueNumber], ghJsonFn });
  return batch[normalizedIssueNumber(issueNumber)] || [];
}

function normalizedIssueNumber(value) {
  return asPositiveInt(value);
}

export function fetchBugBlockedByBatch({ repo = "", issueNumbers = [], ghJsonFn } = {}) {
  const { owner, name } = parseRepo(repo);
  const normalizedIssueNumbers = Array.from(new Set(
    (Array.isArray(issueNumbers) ? issueNumbers : [])
      .map((issueNumber) => normalizedIssueNumber(issueNumber))
      .filter((issueNumber) => issueNumber > 0),
  ));
  if (!owner || !name || normalizedIssueNumbers.length === 0) return {};
  const issueSelections = normalizedIssueNumbers
    .map((issueNumber) => `i${issueNumber}: issue(number:${issueNumber}){ blockedBy(first:100){ nodes{ number state } } }`)
    .join(" ");
  const query = `query{ repository(owner:\"${owner}\", name:\"${name}\"){ ${issueSelections} } }`;
  try {
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], null);
    const repository = out?.data?.repository && typeof out.data.repository === "object"
      ? out.data.repository
      : {};
    return normalizedIssueNumbers.reduce((acc, issueNumber) => {
      acc[issueNumber] = repository?.[`i${issueNumber}`]?.blockedBy?.nodes || [];
      return acc;
    }, {});
  } catch {
    return normalizedIssueNumbers.reduce((acc, issueNumber) => {
      acc[issueNumber] = [];
      return acc;
    }, {});
  }
}

function listOpenBugsFromRepo({ repo = "", labelFilters = [], ghJsonFn } = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return { openBugs: [], parseError: "missing_repo" };
  }

  const effectiveFilters = normalizeLabelFilters(labelFilters);
  if (effectiveFilters.length === 0) {
    effectiveFilters.push("bug");
  }
  const args = [
    "issue", "list", "--repo", normalizedRepo, "--state", "open", "--limit", "200", "--json", "number,title,labels,body,milestone",
  ];
  for (const label of effectiveFilters) {
    args.push("--label", label);
  }

  let payload;
  try {
    const queried = queryOpenBugsWithDiagnostics(args, ghJsonFn);
    if (queried.parseError) {
      return { openBugs: [], parseError: queried.parseError };
    }
    payload = queried.payload;
  } catch (error) {
    return {
      openBugs: [],
      parseError: String(error?.message || error || "open_bug_gate_query_failed"),
    };
  }

  const candidates = payload
    .filter((bug) => bug && typeof bug === "object")
    .filter((bug) => !isNonBlockingOpenBug(bug))
  const blockedByByIssue = fetchBugBlockedByBatch({
    repo: normalizedRepo,
    issueNumbers: candidates.map((bug) => bug?.number),
    ghJsonFn,
  });
  const openBugs = candidates
    .map((bug) => ({
      ...bug,
      blocked_by: blockedByByIssue[normalizedIssueNumber(bug?.number)] || [],
    }))
  return {
    openBugs: filterBlockingOpenBugs(openBugs, {
      repo: normalizedRepo,
      ghJsonFn,
    }),
    parseError: "",
  };
}

export function evaluateOpenBugGate({
  snapshot = "",
  snapshotOverride,
  repo = "",
  controlPlaneRepo = "",
  labelFilters = [],
  ghJsonFn,
  backendAdapter,
} = {}) {
  const safeResult = (parseError = "") => ({
    has_open_bugs: "false",
    open_upstream_bugs: "false",
    open_bug_count: 0,
    issue_numbers: [],
    parse_error: String(parseError || ""),
  });

  if (snapshotOverride === undefined && !String(snapshot || "").trim()) {
    // @context:regression !critical open_bug_gate owns target-repo bug checks inside
    // managed delivery flows. controlPlaneRepo belongs to upstream_bug_gate; preferring it
    // here starves factory work on unrelated control-plane bugs.
    const queryRepo = trim(repo) || trim(controlPlaneRepo);
    const resolvedGhJsonFn = resolveSupervisorGhJsonFn({
      ghJsonFn,
      backendAdapter,
      repo: queryRepo,
    });
    const live = listOpenBugsFromRepo({ repo: queryRepo, labelFilters, ghJsonFn: resolvedGhJsonFn });
    if (live.parseError) return safeResult(live.parseError);
    const issueNumbers = normalizeIssueNumbers(live.openBugs);
    const hasOpenBugs = issueNumbers.length > 0 ? "true" : "false";
    return {
      has_open_bugs: hasOpenBugs,
      open_upstream_bugs: hasOpenBugs,
      open_bug_count: issueNumbers.length,
      issue_numbers: issueNumbers,
      parse_error: "",
    };
  }

  let parsed = null;

  if (snapshotOverride !== undefined) {
    parsed = snapshotOverride;
  } else {
    const raw = String(snapshot || "").trim();
    if (!raw) return safeResult("empty_snapshot");
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return safeResult(String(error?.message || error || "invalid_snapshot_json"));
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return safeResult("invalid_snapshot_shape");
  }

  const upstreamError = String(parsed.error || "").trim();
  if (upstreamError) {
    return safeResult(upstreamError);
  }

  const snapshotErrors = Array.isArray(parsed.snapshot_errors)
    ? parsed.snapshot_errors.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (snapshotErrors.length > 0) {
    return safeResult(snapshotErrors.join(";"));
  }

  const blockingOpenBugs = extractSnapshotOpenBugs(parsed, { labelFilters });
  const issueNumbers = normalizeIssueNumbers(blockingOpenBugs);
  const hasOpenBugs = issueNumbers.length > 0 ? "true" : "false";
  return {
    has_open_bugs: hasOpenBugs,
    open_upstream_bugs: hasOpenBugs,
    open_bug_count: issueNumbers.length,
    issue_numbers: issueNumbers,
    parse_error: "",
  };
}
