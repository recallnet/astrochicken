import { spawnSync } from "node:child_process";

import { collectFactoryOutcomes } from "../../../packages/factory-ops/src/commands/factory-outcomes.ts";
import { trim } from "../../../packages/factory-ops/src/lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../../../packages/factory-ops/src/lib/factory-label-contract.ts";
import { computeDiffStats } from "../../../packages/factory-ops/src/lib/git-diff-stats.ts";
import { collectWaveTimingMetadata } from "../../../packages/factory-ops/src/lib/run-metadata-reader.ts";

const GOAL_LABEL_NAME = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.GOAL);

type SpawnSyncFn = (cmd: string, args: string[], opts?: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string };

interface RawItem {
  number?: unknown;
  title?: unknown;
  url?: unknown;
  wave_key?: unknown;
  closed_at?: unknown;
  closedAt?: unknown;
  merged_at?: unknown;
  mergedAt?: unknown;
  state?: unknown;
  issue_state?: unknown;
  issueState?: unknown;
  sha?: string;
  authored_at?: unknown;
}

interface NormalizedGoal {
  number: number;
  wave_key: string;
  title: string;
  url: string;
  closed_at: string;
  state?: string;
}

interface NormalizedIssue {
  number: number;
  title: string;
  url: string;
  closed_at: string;
  state: string;
}

interface NormalizedPr {
  number: number;
  title: string;
  url: string;
  merged_at: string;
}

interface DiffStats {
  added: number;
  deleted: number;
  files_changed: number;
  text: string;
  degraded: boolean;
  reason: string | null;
}

interface Timing {
  avg_wave_minutes: number;
  sample_count: number;
  degraded: boolean;
  reason: string | null;
}

interface DedupCursor {
  seen_goal_numbers?: number[];
  seen_issues?: number[];
  seen_prs?: number[];
  last_release_sha?: string;
}

interface BuildOptions {
  repo?: string;
  factoryId?: string;
  repoPath?: string;
  lookbackHours?: number;
  dedupCursor?: DedupCursor | null;
  clock?: (() => Date) | undefined;
  collectFactoryOutcomesFn?: (opts: Record<string, unknown>) => unknown;
  gitDiffStatsFn?: (opts: Record<string, unknown>) => unknown;
  runMetadataReaderFn?: (opts: Record<string, unknown>) => unknown;
  queryClosedGoalsFn?: (repo: string, sinceIso: string) => NormalizedGoal[];
  resolveGoalTitlesFn?: (goals: NormalizedGoal[], repo: string) => void;
  resolveIssueMetadataFn?: (issues: NormalizedIssue[], repo: string) => void;
}

function parseIsoMs(value: unknown = ""): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toPositiveNumber(value: unknown, fallback: number = 24): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toNonNegativeInteger(value: unknown, fallback: number = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function asIso(value: unknown = ""): string {
  const parsed = parseIsoMs(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeGoal(raw: RawItem = {}): NormalizedGoal {
  return {
    number: toNonNegativeInteger(raw?.number, 0),
    wave_key: String(raw?.wave_key || ""),
    title: String(raw?.title || ""),
    url: String(raw?.url || ""),
    closed_at: asIso(raw?.closed_at || raw?.closedAt),
  };
}

function normalizeIssue(raw: RawItem = {}): NormalizedIssue {
  return {
    number: toNonNegativeInteger(raw?.number, 0),
    title: String(raw?.title || ""),
    url: String(raw?.url || ""),
    closed_at: asIso(raw?.closed_at || raw?.closedAt),
    state: trim(raw?.state || raw?.issue_state || raw?.issueState).toUpperCase(),
  };
}

function normalizePr(raw: RawItem = {}): NormalizedPr {
  return {
    number: toNonNegativeInteger(raw?.number, 0),
    title: String(raw?.title || ""),
    url: String(raw?.url || ""),
    merged_at: asIso(raw?.merged_at || raw?.mergedAt),
  };
}

function normalizeDiffStats(raw: unknown = {}): DiffStats {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const added = toNonNegativeInteger(value.added, toNonNegativeInteger(value.add, 0));
  const deleted = toNonNegativeInteger(value.deleted, toNonNegativeInteger(value.del, 0));
  const filesChanged = toNonNegativeInteger(value.files_changed, toNonNegativeInteger(value.files, 0));
  const degraded = value.degraded === true;
  const reason = degraded ? (trim(value.reason) || "diff_unavailable") : null;

  return {
    added,
    deleted,
    files_changed: filesChanged,
    text: trim(value.text) || `+${added} -${deleted}`,
    degraded,
    reason,
  };
}

function normalizeTiming(raw: unknown = {}): Timing {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const degraded = value.degraded === true;
  const reason = degraded ? (trim(value.reason) || "timing_unavailable") : null;
  return {
    avg_wave_minutes: Number.isFinite(Number(value.avg_wave_minutes)) ? Number(value.avg_wave_minutes) : 0,
    sample_count: toNonNegativeInteger(value.sample_count, 0),
    degraded,
    reason,
  };
}

function createNowIso(clock: (() => Date) | undefined): string {
  const nowCandidate = typeof clock === "function" ? clock() : new Date();
  const nowDate = nowCandidate instanceof Date ? nowCandidate : new Date(nowCandidate as string);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("invalid_clock_time");
  return new Date(nowMs).toISOString();
}

function uniqueErrorPush(target: string[] = [], message: unknown = ""): void {
  const normalized = trim(message);
  if (!normalized) return;
  if (!target.includes(normalized)) target.push(normalized);
}

function collectOutcomeItems(outcomes: Record<string, unknown> = {}): { goals: NormalizedGoal[]; issues: NormalizedIssue[]; prs: NormalizedPr[] } {
  const value = outcomes && typeof outcomes === "object" ? outcomes : {};

  const goalsRaw = Array.isArray(value.goals)
    ? value.goals
    : (Array.isArray(value.closed_goals) ? value.closed_goals : []);

  const issuesRaw = Array.isArray(value.issues)
    ? value.issues
    : [
      ...(Array.isArray(value.closed_features_items) ? value.closed_features_items : []),
      ...(Array.isArray(value.closed_bugs_items) ? value.closed_bugs_items : []),
    ];

  const prsRaw = Array.isArray(value.prs)
    ? value.prs
    : (Array.isArray(value.merged_prs_items) ? value.merged_prs_items : []);

  return {
    goals: goalsRaw.map((item: RawItem) => normalizeGoal(item)).filter((item) => item.number > 0),
    issues: issuesRaw.map((item: RawItem) => normalizeIssue(item)).filter((item) => item.number > 0),
    prs: prsRaw.map((item: RawItem) => normalizePr(item)).filter((item) => item.number > 0),
  };
}

function deduplicateGoalsByNumber(goals: NormalizedGoal[] = []): NormalizedGoal[] {
  const byNumber = new Map<number, NormalizedGoal>();
  for (const goal of goals) {
    if (!byNumber.has(goal.number)) {
      byNumber.set(goal.number, { ...goal });
    }
  }
  return [...byNumber.values()];
}

function compareNewestFirst(left: Record<string, unknown> = {}, right: Record<string, unknown> = {}): number {
  const leftMs = parseIsoMs(left?.closed_at || left?.merged_at);
  const rightMs = parseIsoMs(right?.closed_at || right?.merged_at);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return rightMs - leftMs;
  return toNonNegativeInteger(right?.number, 0) - toNonNegativeInteger(left?.number, 0);
}

function newestAnchors<T extends Record<string, unknown>>(items: T[] = [], limit: number = 5): T[] {
  return [...items].sort(compareNewestFirst).slice(0, limit);
}

export function resolveGoalTitles(goals: NormalizedGoal[] = [], repo: string = "", shellRunner: SpawnSyncFn = spawnSync as unknown as SpawnSyncFn): void {
  if (!repo || goals.length === 0) return;
  for (const goal of goals) {
    try {
      const titleResult = shellRunner("gh", ["issue", "view", String(goal.number), "--repo", repo, "--json", "title", "-q", ".title"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const stateResult = shellRunner("gh", ["issue", "view", String(goal.number), "--repo", repo, "--json", "state", "-q", ".state"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const title = String(titleResult.stdout || "").trim();
      const state = String(stateResult.stdout || "").trim().toUpperCase();
      if (titleResult.status === 0 && title) goal.title = title;
      if (stateResult.status === 0 && state) goal.state = state;
    } catch {}
  }
}

export function resolveIssueMetadata(issues: NormalizedIssue[] = [], repo: string = "", shellRunner: SpawnSyncFn = spawnSync as unknown as SpawnSyncFn): void {
  if (!repo || issues.length === 0) return;
  for (const issue of issues) {
    try {
      const titleResult = shellRunner("gh", ["issue", "view", String(issue.number), "--repo", repo, "--json", "title", "-q", ".title"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const stateResult = shellRunner("gh", ["issue", "view", String(issue.number), "--repo", repo, "--json", "state", "-q", ".state"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const closedAtResult = shellRunner("gh", ["issue", "view", String(issue.number), "--repo", repo, "--json", "closedAt", "-q", ".closedAt"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const title = String(titleResult.stdout || "").trim();
      const state = String(stateResult.stdout || "").trim().toUpperCase();
      const closedAt = String(closedAtResult.stdout || "").trim();
      if (titleResult.status === 0 && title) issue.title = title;
      if (stateResult.status === 0 && state) issue.state = state;
      if (closedAtResult.status === 0 && closedAt) issue.closed_at = asIso(closedAt);
    } catch {}
  }
}

export function queryClosedGoals(repo: string = "", sinceIso: string = "", shellRunner: SpawnSyncFn = spawnSync as unknown as SpawnSyncFn): NormalizedGoal[] {
  if (!repo || !sinceIso) return [];
  try {
    const result = shellRunner("gh", [
      "issue", "list",
      "--repo", repo,
      "--label", GOAL_LABEL_NAME,
      "--state", "closed",
      "--search", `closed:>${sinceIso}`,
      "--json", "number,title,url,closedAt",
      "--limit", "100",
    ], { encoding: "utf8", timeout: 15000 });

    if (result.status !== 0) return [];
    const parsed = JSON.parse(String(result.stdout || "[]"));
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: RawItem) => ({
      number: toNonNegativeInteger(item?.number, 0),
      title: String(item?.title || ""),
      url: String(item?.url || ""),
      closed_at: asIso(item?.closedAt),
      state: "CLOSED" as const,
    })).filter((g) => g.number > 0);
  } catch {
    return [];
  }
}

function earliestCommitIso(commits: RawItem[] = []): string {
  const timestamps = commits
    .map((c) => asIso(c?.authored_at))
    .filter(Boolean)
    .map((iso) => ({ iso, ms: parseIsoMs(iso) }))
    .filter((entry) => Number.isFinite(entry.ms))
    .sort((a, b) => a.ms - b.ms);

  return timestamps.length > 0 ? timestamps[0].iso : "";
}

export async function buildReleaseReportContext(options: BuildOptions = {}): Promise<Record<string, unknown>> {
  const {
    repo = "",
    factoryId = "",
    repoPath = ".",
    lookbackHours = 24,
    dedupCursor = null,
    clock,
    collectFactoryOutcomesFn = collectFactoryOutcomes,
    gitDiffStatsFn = computeDiffStats,
    runMetadataReaderFn = collectWaveTimingMetadata,
    queryClosedGoalsFn = queryClosedGoals,
    resolveGoalTitlesFn = resolveGoalTitles,
    resolveIssueMetadataFn = resolveIssueMetadata,
  } = options;

  const normalizedRepo = trim(repo);
  if (!normalizedRepo) throw new Error("missing_repo");

  const lookback = toPositiveNumber(lookbackHours, 24);
  const generatedAt = createNowIso(clock);
  const sinceIso = new Date(parseIsoMs(generatedAt) - (lookback * 3600_000)).toISOString();

  const errors: string[] = [];
  const output: Record<string, unknown> = {
    factory_id: trim(factoryId),
    repo: normalizedRepo,
    repo_path: String(repoPath || "."),
    since_iso: sinceIso,
    generated_at: generatedAt,
    degraded: false,
    errors,
    commits: [] as RawItem[],
    goals: [] as NormalizedGoal[],
    issues: [] as NormalizedIssue[],
    prs: [] as NormalizedPr[],
    metrics: { goals_closed: 0, issues_closed: 0, commits_landed: 0 },
    diff_stats: { added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false, reason: null } as DiffStats,
    timing: { avg_wave_minutes: 0, sample_count: 0, degraded: false, reason: null } as Timing,
  };

  let outcomes: Record<string, unknown> = {};
  try {
    outcomes = await Promise.resolve(collectFactoryOutcomesFn({
      repo: normalizedRepo,
      repoPath,
      lookbackHours: lookback,
      nowMs: parseIsoMs(generatedAt),
    })) as Record<string, unknown> || {};
  } catch (error: unknown) {
    uniqueErrorPush(errors, `outcomes_lookup_failed:${trim((error as Error)?.message || error) || "unknown_error"}`);
    outcomes = {};
  }

  const outcomeItems = collectOutcomeItems(outcomes);
  let allCommits: RawItem[] = Array.isArray(outcomes?.commits) ? outcomes.commits as RawItem[] : [];
  output.commit_log = String(outcomes?.commit_log || "");

  const cursor = dedupCursor && typeof dedupCursor === "object" ? dedupCursor : null;
  const seenGoalNumbers = new Set<number>(Array.isArray(cursor?.seen_goal_numbers) ? cursor.seen_goal_numbers : []);
  const seenIssues = new Set<number>(Array.isArray(cursor?.seen_issues) ? cursor.seen_issues : []);
  const seenPrs = new Set<number>(Array.isArray(cursor?.seen_prs) ? cursor.seen_prs : []);

  const lastReleaseSha = trim(cursor?.last_release_sha);
  if (lastReleaseSha && allCommits.length > 0) {
    const cursorIdx = allCommits.findIndex((c) => c.sha === lastReleaseSha);
    if (cursorIdx >= 0) {
      allCommits = allCommits.slice(0, cursorIdx);
    }
  }
  output.commits = allCommits;
  output.last_commit_sha = allCommits.length > 0 ? trim(allCommits[0].sha) : "";

  const ghGoals = queryClosedGoalsFn(normalizedRepo, sinceIso);
  const filteredGoals = ghGoals.filter((g) => !seenGoalNumbers.has(g.number));
  const deduplicatedGoals = deduplicateGoalsByNumber(filteredGoals);
  output.goals = newestAnchors(deduplicatedGoals as unknown as Record<string, unknown>[], 5);

  output.issues = outcomeItems.issues.filter((i) => !seenIssues.has(i.number));
  output.prs = newestAnchors(outcomeItems.prs as unknown as Record<string, unknown>[], 5).filter((p: Record<string, unknown>) => !seenPrs.has(p.number as number));

  resolveGoalTitlesFn(output.goals as NormalizedGoal[], normalizedRepo);
  resolveIssueMetadataFn(output.issues as NormalizedIssue[], normalizedRepo);
  output.issues = (output.issues as NormalizedIssue[]).filter((issue) => issue.state !== "OPEN");
  const closedIssueCount = (output.issues as NormalizedIssue[]).length;
  output.issues = newestAnchors(output.issues as unknown as Record<string, unknown>[], 5);

  if (outcomes?.error) uniqueErrorPush(errors, `outcomes_error:${trim(outcomes.error)}`);
  if (Array.isArray(outcomes?.gh_failures) && (outcomes.gh_failures as unknown[]).length > 0) {
    for (const failure of outcomes.gh_failures as Record<string, unknown>[]) {
      const query = trim(failure?.query) || "unknown_query";
      const reason = trim(failure?.reason) || "unknown_reason";
      uniqueErrorPush(errors, `outcomes_gh_failure:${query}:${reason}`);
    }
  }
  if (outcomes?.outcomes_degraded === true) uniqueErrorPush(errors, "outcomes_degraded");

  output.metrics = {
    goals_closed: deduplicatedGoals.length,
    issues_closed: closedIssueCount,
    commits_landed: (output.commits as RawItem[]).length,
  };

  const diffSinceIso = earliestCommitIso(output.commits as RawItem[]);
  if (!diffSinceIso) {
    output.diff_stats = {
      added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: true, reason: "no_commits_in_window",
    };
    uniqueErrorPush(errors, "diff_stats_unavailable:no_commits_in_window");
  } else {
    try {
      const diffResult = await Promise.resolve(gitDiffStatsFn({ repoPath, sinceIso: diffSinceIso, nowIso: generatedAt }));
      output.diff_stats = normalizeDiffStats(diffResult);
      if ((output.diff_stats as DiffStats).degraded) uniqueErrorPush(errors, `diff_stats_unavailable:${(output.diff_stats as DiffStats).reason}`);
    } catch (error: unknown) {
      output.diff_stats = {
        added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: true, reason: "diff_stats_exception",
      };
      uniqueErrorPush(errors, `diff_stats_unavailable:${trim((error as Error)?.message || error) || "diff_stats_exception"}`);
    }
  }

  try {
    const timingResult = await Promise.resolve(runMetadataReaderFn({
      factoryId: trim(factoryId),
      sinceIso,
      nowIso: generatedAt,
    }));
    output.timing = normalizeTiming(timingResult);
    if ((output.timing as Timing).degraded) uniqueErrorPush(errors, `timing_unavailable:${(output.timing as Timing).reason}`);
  } catch (error: unknown) {
    output.timing = {
      avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "timing_exception",
    };
    uniqueErrorPush(errors, `timing_unavailable:${trim((error as Error)?.message || error) || "timing_exception"}`);
  }

  output.degraded = errors.length > 0 || (output.diff_stats as DiffStats).degraded || (output.timing as Timing).degraded;
  return output;
}
