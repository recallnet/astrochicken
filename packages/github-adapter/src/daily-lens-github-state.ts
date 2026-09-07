import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  parseJsonSafe,
  toArray,
} from "@hatch/factory-core/daily-lens-collector";

function normalizeIssue(issue: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: Number(issue?.number || 0),
    title: String(issue?.title || ""),
    state: String(issue?.state || ""),
    created_at: String(issue?.createdAt || issue?.created_at || ""),
    closed_at: String(issue?.closedAt || issue?.closed_at || ""),
    labels: toArray(issue?.labels).map((label: unknown) => String((label as Record<string, unknown>)?.name || label || "")).filter(Boolean),
  };
}

function normalizePullRequest(pr: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: Number(pr?.number || 0),
    title: String(pr?.title || ""),
    state: String(pr?.state || ""),
    merged_at: String(pr?.mergedAt || pr?.merged_at || ""),
    updated_at: String(pr?.updatedAt || pr?.updated_at || ""),
    labels: toArray(pr?.labels).map((label: unknown) => String((label as Record<string, unknown>)?.name || label || "")).filter(Boolean),
  };
}

async function runGhJson(ghJsonFn: (...args: unknown[]) => unknown, args: unknown[], fallback: unknown): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const out = await Promise.resolve(ghJsonFn(args, fallback));
    return { ok: true, data: out };
  } catch (error: unknown) {
    return {
      ok: false,
      data: fallback,
      error: String((error as Record<string, unknown>)?.message || error),
    };
  }
}

export function defaultGhJson(args: unknown[], fallback: unknown = []): never {
  throw new Error(`collectGithubState requires ghJsonFn for args: ${(args as string[]).join(" ")}`);
}

export async function collectGithubState({
  windowStart,
  windowEnd,
  repo = "",
  runsDir = ".hatch/runs",
  ghJsonFn = defaultGhJson,
  buildStateSnapshotFn = () => "{}",
  evaluateOpenBugGateFn = () => ({ has_open_bugs: "false", open_bug_count: 0, issue_numbers: [], parse_error: "" }),
}: {
  windowStart?: string;
  windowEnd?: string;
  repo?: string;
  runsDir?: string;
  ghJsonFn?: (...args: unknown[]) => unknown;
  buildStateSnapshotFn?: (opts: Record<string, unknown>) => string;
  evaluateOpenBugGateFn?: (opts: Record<string, unknown>) => Record<string, unknown>;
} = {}): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown>;
  try {
    payload = createCollectorEnvelope({ source: "github_state", windowStart, windowEnd });
  } catch (error: unknown) {
    return {
      source: "github_state",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{ reason: MissingDataReason.WINDOW_INVALID, detail: String((error as Record<string, unknown>)?.message || error) }],
      issues: [],
      pull_requests: [],
      issue_counts: { created: 0, closed: 0 },
      pull_request_counts: { merged: 0, updated: 0 },
      bug_gate: { has_open_bugs: "false", open_bug_count: 0, issue_numbers: [], parse_error: "" },
      snapshot: {},
    };
  }

  const normalizedRepo = String(repo || "").trim();
  if (!normalizedRepo) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "GitHub repo is required for collector", {
      source_hint: "collectGithubState({ repo })",
    });
    return finalizeCollectorEnvelope({
      ...payload,
      issues: [],
      pull_requests: [],
      issue_counts: { created: 0, closed: 0 },
      pull_request_counts: { merged: 0, updated: 0 },
      bug_gate: { has_open_bugs: "false", open_bug_count: 0, issue_numbers: [], parse_error: "" },
      snapshot: {},
    });
  }

  let snapshotRaw = "";
  let snapshot: Record<string, unknown> = {};
  try {
    snapshotRaw = buildStateSnapshotFn({ repo: normalizedRepo, ghJsonFn, runsDir });
    snapshot = (parseJsonSafe(snapshotRaw, {}) || {}) as Record<string, unknown>;
  } catch (error: unknown) {
    addMissingData(payload, MissingDataReason.COMMAND_FAILED, "GitHub state snapshot command failed", {
      error: String((error as Record<string, unknown>)?.message || error),
    });
  }

  let bugGate: Record<string, unknown> = { has_open_bugs: "false", open_bug_count: 0, issue_numbers: [], parse_error: "" };
  try {
    bugGate = evaluateOpenBugGateFn({ snapshot: snapshotRaw || JSON.stringify(snapshot || {}) });
  } catch (error: unknown) {
    addMissingData(payload, MissingDataReason.PARSE_ERROR, "Bug gate evaluation failed", {
      error: String((error as Record<string, unknown>)?.message || error),
    });
  }

  const issueResult = await runGhJson(ghJsonFn, [
    "issue", "list",
    "--repo", normalizedRepo,
    "--state", "all",
    "--limit", "300",
    "--json", "number,title,state,createdAt,closedAt,labels",
  ], []);
  if (!issueResult.ok) {
    addMissingData(payload, MissingDataReason.COMMAND_FAILED, "gh issue list failed", {
      error: issueResult.error,
    });
  }

  const prResult = await runGhJson(ghJsonFn, [
    "pr", "list",
    "--repo", normalizedRepo,
    "--state", "all",
    "--limit", "300",
    "--json", "number,title,state,updatedAt,mergedAt,labels",
    "--search", "base:main",
  ], []);
  if (!prResult.ok) {
    addMissingData(payload, MissingDataReason.COMMAND_FAILED, "gh pr list failed", {
      error: prResult.error,
    });
  }

  const windowMs = (payload as Record<string, unknown>)._windowMs as Record<string, number>;

  const normalizedIssues = toArray(issueResult.data)
    .map((issue: unknown) => normalizeIssue(issue as Record<string, unknown>))
    .filter((issue: Record<string, unknown>) => inWindow(issue.created_at as string, windowMs.startMs, windowMs.endMs)
      || inWindow(issue.closed_at as string, windowMs.startMs, windowMs.endMs));

  const normalizedPrs = toArray(prResult.data)
    .map((pr: unknown) => normalizePullRequest(pr as Record<string, unknown>))
    .filter((pr: Record<string, unknown>) => inWindow(pr.updated_at as string, windowMs.startMs, windowMs.endMs)
      || inWindow(pr.merged_at as string, windowMs.startMs, windowMs.endMs));

  const createdCount = normalizedIssues.filter((issue: Record<string, unknown>) => inWindow(issue.created_at as string, windowMs.startMs, windowMs.endMs)).length;
  const closedCount = normalizedIssues.filter((issue: Record<string, unknown>) => inWindow(issue.closed_at as string, windowMs.startMs, windowMs.endMs)).length;
  const mergedCount = normalizedPrs.filter((pr: Record<string, unknown>) => (pr.state as string).toUpperCase() === "MERGED" || Boolean(pr.merged_at)).length;

  return finalizeCollectorEnvelope({
    ...payload,
    issues: normalizedIssues,
    pull_requests: normalizedPrs,
    issue_counts: {
      created: createdCount,
      closed: closedCount,
    },
    pull_request_counts: {
      merged: mergedCount,
      updated: normalizedPrs.length,
    },
    bug_gate: bugGate,
    snapshot: {
      action_count: Number(snapshot?.action_count || 0),
      orphan_feature_count: toArray(snapshot?.orphan_features).length,
      open_bug_count: toArray(snapshot?.open_bugs).length,
    },
  });
}
