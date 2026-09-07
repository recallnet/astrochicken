function trimLocal(value = "") {
  return String(value || "").trim();
}

function compactGraphLabel(graph = "") {
  const raw = String(graph || "");
  if (!raw) return "";
  const parts = raw.replace(/\\/g, "/").split("/");
  const label = parts[parts.length - 1] || raw;
  return label.endsWith(".workflow-source.mjs")
    ? label.replace(/\.workflow-source\.mjs$/u, ".dot")
    : label;
}

function parseIssueNumber(value = "") {
  const normalized = String(value || "").trim().replace(/^#/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeDashboardFilters(filters = {}) {
  const source = filters && typeof filters === "object" ? filters : {};
  const issue = parseIssueNumber(source.issue);
  return {
    run_id: trimLocal(source.run_id || source.runId || ""),
    graph: compactGraphLabel(trimLocal(source.graph || "")),
    node: trimLocal(source.node || ""),
    issue: issue > 0 ? issue : null,
  };
}

function hasDashboardFilters(filters = {}) {
  return Boolean(
    trimLocal(filters.run_id || "")
    || trimLocal(filters.graph || "")
    || trimLocal(filters.node || "")
    || Number.isFinite(filters.issue),
  );
}

function normalizeRunIdentity(identity = {}) {
  const source = identity && typeof identity === "object" ? identity : {};
  const runId = trimLocal(source.run_id || source.runId || "");
  const graph = compactGraphLabel(trimLocal(source.graph || ""));
  const node = trimLocal(source.node || "");
  const issueNumber = parseIssueNumber(source.issue_number || source.issue || "");
  if (!runId && !graph && !node && issueNumber <= 0) return null;
  return {
    run_id: runId,
    graph,
    node,
    issue_number: issueNumber > 0 ? issueNumber : null,
  };
}

function collectRowFilterFields(row = {}) {
  const refs = row?.refs && typeof row.refs === "object" ? row.refs : {};
  const runIdentity = normalizeRunIdentity(row?.runIdentity || null) || {};

  const runIds = new Set([
    trimLocal(runIdentity.run_id || ""),
    trimLocal(refs.run_id || ""),
    trimLocal(refs.trace_run_id || ""),
    trimLocal(refs.wave_run_id || ""),
    trimLocal(refs.tick_run_id || ""),
  ].filter(Boolean));

  const graphs = new Set([
    compactGraphLabel(trimLocal(runIdentity.graph || "")),
    compactGraphLabel(trimLocal(refs.graph || "")),
  ].filter(Boolean));

  const nodes = new Set([
    trimLocal(runIdentity.node || ""),
    trimLocal(refs.node || ""),
  ].filter(Boolean));

  const issues = new Set([
    parseIssueNumber(row.issue || ""),
    parseIssueNumber(runIdentity.issue_number || ""),
    parseIssueNumber(refs.issue_number || ""),
    parseIssueNumber(refs.current_issue_number || ""),
    parseIssueNumber(refs.goal_number || ""),
    parseIssueNumber(refs.goal_issue_number || ""),
    parseIssueNumber(refs.linked_goal_number || ""),
  ].filter((value) => value > 0));

  return { runIds, graphs, nodes, issues };
}

function rowMatchesDashboardFilters(row = {}, filters = {}) {
  if (!hasDashboardFilters(filters)) return true;
  const fields = collectRowFilterFields(row);
  const runIdFilter = trimLocal(filters.run_id || "");
  if (runIdFilter && !fields.runIds.has(runIdFilter)) return false;

  const graphFilter = compactGraphLabel(trimLocal(filters.graph || ""));
  if (graphFilter && !fields.graphs.has(graphFilter)) return false;

  const nodeFilter = trimLocal(filters.node || "");
  if (nodeFilter && !fields.nodes.has(nodeFilter)) return false;

  const issueFilter = Number.isFinite(filters.issue) ? Number(filters.issue) : 0;
  if (issueFilter > 0 && !fields.issues.has(issueFilter)) return false;

  return true;
}

function applyDashboardFiltersToTabs(tabs = [], filters = {}) {
  if (!hasDashboardFilters(filters)) return tabs;
  return (Array.isArray(tabs) ? tabs : []).map((tab) => ({
    ...tab,
    rows: (Array.isArray(tab.rows) ? tab.rows : []).filter((row) => rowMatchesDashboardFilters(row, filters)),
  }));
}

function withRunIdentity(row = {}, identity = null) {
  return {
    ...row,
    runIdentity: normalizeRunIdentity(identity),
  };
}

export {
  applyDashboardFiltersToTabs,
  compactGraphLabel,
  normalizeDashboardFilters,
  normalizeRunIdentity,
  withRunIdentity,
};
