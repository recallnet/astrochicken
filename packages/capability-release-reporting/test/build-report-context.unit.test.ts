import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveGoalTitles,
  resolveIssueMetadata,
  queryClosedGoals,
  buildReleaseReportContext,
} from "../src/build-report-context.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface SpawnCall {
  cmd: string;
  args: string[];
  opts: Record<string, unknown> | undefined;
}

function makeSpawnSync(responses: Record<string, SpawnResult> = {}): { fn: (cmd: string, args: string[], opts?: Record<string, unknown>) => SpawnResult; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  return {
    fn: (cmd: string, args: string[], opts?: Record<string, unknown>): SpawnResult => {
      const key = `${cmd} ${args.join(" ")}`;
      calls.push({ cmd, args, opts });
      const response =
        responses[key] || responses["*"] || { status: 0, stdout: "", stderr: "" };
      return response;
    },
    calls,
  };
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

const NOW_ISO = "2026-03-23T00:00:00.000Z";

function minimalOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repo: "owner/repo",
    factoryId: "mothership",
    repoPath: ".",
    lookbackHours: 24,
    clock: fixedClock(NOW_ISO),
    collectFactoryOutcomesFn: () => ({}),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files: 0, degraded: true, reason: "stub" }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "stub" }),
    queryClosedGoalsFn: () => [],
    resolveGoalTitlesFn: () => {},
    resolveIssueMetadataFn: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveGoalTitles
// ---------------------------------------------------------------------------

describe("resolveGoalTitles", () => {
  it("does nothing when goals array is empty", () => {
    const spy = makeSpawnSync();
    resolveGoalTitles([], "owner/repo", spy.fn);
    assert.equal(spy.calls.length, 0);
  });

  it("does nothing when repo is empty", () => {
    const spy = makeSpawnSync();
    resolveGoalTitles([{ number: 1, wave_key: "", title: "", url: "", closed_at: "" }], "", spy.fn);
    assert.equal(spy.calls.length, 0);
  });

  it("updates goal.title and goal.state on successful spawn", () => {
    const goal = { number: 42, wave_key: "", title: "", url: "", closed_at: "", state: "" };
    let callIndex = 0;
    const fn = (_cmd: string, _args: string[], _opts?: Record<string, unknown>): SpawnResult => {
      callIndex++;
      if (callIndex === 1) return { status: 0, stdout: "My Goal Title\n", stderr: "" };
      if (callIndex === 2) return { status: 0, stdout: "CLOSED\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    resolveGoalTitles([goal], "owner/repo", fn);
    assert.equal(goal.title, "My Goal Title");
    assert.equal(goal.state, "CLOSED");
  });

  it("leaves goal unchanged when spawnSync fails", () => {
    const goal = { number: 7, wave_key: "", title: "original", url: "", closed_at: "", state: "OPEN" };
    const fn = (): SpawnResult => ({ status: 1, stdout: "", stderr: "error" });
    resolveGoalTitles([goal], "owner/repo", fn);
    assert.equal(goal.title, "original");
    assert.equal(goal.state, "OPEN");
  });

  it("leaves goal unchanged when spawnSync throws", () => {
    const goal = { number: 7, wave_key: "", title: "original", url: "", closed_at: "", state: "OPEN" };
    const fn = (): SpawnResult => { throw new Error("boom"); };
    resolveGoalTitles([goal], "owner/repo", fn);
    assert.equal(goal.title, "original");
    assert.equal(goal.state, "OPEN");
  });

  it("makes two calls per goal (title + state)", () => {
    const goals = [
      { number: 1, wave_key: "", title: "", url: "", closed_at: "" },
      { number: 2, wave_key: "", title: "", url: "", closed_at: "" },
    ];
    const spy = makeSpawnSync({ "*": { status: 1, stdout: "", stderr: "" } });
    resolveGoalTitles(goals, "owner/repo", spy.fn);
    assert.equal(spy.calls.length, 4);
  });
});

// ---------------------------------------------------------------------------
// resolveIssueMetadata
// ---------------------------------------------------------------------------

describe("resolveIssueMetadata", () => {
  it("does nothing when issues array is empty", () => {
    const spy = makeSpawnSync();
    resolveIssueMetadata([], "owner/repo", spy.fn);
    assert.equal(spy.calls.length, 0);
  });

  it("does nothing when repo is empty", () => {
    const spy = makeSpawnSync();
    resolveIssueMetadata([{ number: 1, title: "", url: "", closed_at: "", state: "" }], "", spy.fn);
    assert.equal(spy.calls.length, 0);
  });

  it("updates title, state, and closed_at on success", () => {
    const issue = { number: 10, title: "", url: "", closed_at: "", state: "" };
    let callIndex = 0;
    const fn = (): SpawnResult => {
      callIndex++;
      if (callIndex === 1) return { status: 0, stdout: "Bug fix\n", stderr: "" };
      if (callIndex === 2) return { status: 0, stdout: "CLOSED\n", stderr: "" };
      if (callIndex === 3) return { status: 0, stdout: "2026-03-20T12:00:00Z\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    resolveIssueMetadata([issue], "owner/repo", fn);
    assert.equal(issue.title, "Bug fix");
    assert.equal(issue.state, "CLOSED");
    assert.equal(issue.closed_at, "2026-03-20T12:00:00.000Z");
  });

  it("leaves issue unchanged when spawnSync fails", () => {
    const issue = { number: 10, title: "orig", url: "", closed_at: "", state: "OPEN" };
    const fn = (): SpawnResult => ({ status: 1, stdout: "", stderr: "err" });
    resolveIssueMetadata([issue], "owner/repo", fn);
    assert.equal(issue.title, "orig");
    assert.equal(issue.state, "OPEN");
  });

  it("leaves issue unchanged when spawnSync throws", () => {
    const issue = { number: 10, title: "orig", url: "", closed_at: "", state: "OPEN" };
    const fn = (): SpawnResult => { throw new Error("boom"); };
    resolveIssueMetadata([issue], "owner/repo", fn);
    assert.equal(issue.title, "orig");
    assert.equal(issue.state, "OPEN");
  });

  it("makes three calls per issue (title + state + closedAt)", () => {
    const issues = [{ number: 5, title: "", url: "", closed_at: "", state: "" }];
    const spy = makeSpawnSync({ "*": { status: 1, stdout: "", stderr: "" } });
    resolveIssueMetadata(issues, "owner/repo", spy.fn);
    assert.equal(spy.calls.length, 3);
  });
});

// ---------------------------------------------------------------------------
// queryClosedGoals
// ---------------------------------------------------------------------------

describe("queryClosedGoals", () => {
  it("returns [] when repo is empty", () => {
    const result = queryClosedGoals("", "2026-03-22T00:00:00Z", makeSpawnSync().fn);
    assert.deepEqual(result, []);
  });

  it("returns [] when sinceIso is empty", () => {
    const result = queryClosedGoals("owner/repo", "", makeSpawnSync().fn);
    assert.deepEqual(result, []);
  });

  it("returns [] when spawnSync fails", () => {
    const spy = makeSpawnSync({ "*": { status: 1, stdout: "", stderr: "err" } });
    const result = queryClosedGoals("owner/repo", "2026-03-22T00:00:00Z", spy.fn);
    assert.deepEqual(result, []);
  });

  it("returns [] when spawnSync throws", () => {
    const fn = (): SpawnResult => { throw new Error("boom"); };
    const result = queryClosedGoals("owner/repo", "2026-03-22T00:00:00Z", fn);
    assert.deepEqual(result, []);
  });

  it("parses and normalizes goals on success", () => {
    const payload = JSON.stringify([
      { number: 10, title: "Goal A", url: "https://github.com/owner/repo/issues/10", closedAt: "2026-03-22T10:00:00Z" },
      { number: 20, title: "Goal B", url: "https://github.com/owner/repo/issues/20", closedAt: "2026-03-22T11:00:00Z" },
    ]);
    const spy = makeSpawnSync({ "*": { status: 0, stdout: payload, stderr: "" } });
    const result = queryClosedGoals("owner/repo", "2026-03-22T00:00:00Z", spy.fn);
    assert.equal(result.length, 2);
    assert.equal(result[0].number, 10);
    assert.equal(result[0].title, "Goal A");
    assert.equal(result[0].state, "CLOSED");
    assert.equal(result[0].closed_at, "2026-03-22T10:00:00.000Z");
    assert.equal(result[1].number, 20);
  });

  it("filters out goals with number 0", () => {
    const payload = JSON.stringify([
      { number: 0, title: "Bad" },
      { number: 5, title: "Good", url: "", closedAt: "" },
    ]);
    const spy = makeSpawnSync({ "*": { status: 0, stdout: payload, stderr: "" } });
    const result = queryClosedGoals("owner/repo", "2026-03-22T00:00:00Z", spy.fn);
    assert.equal(result.length, 1);
    assert.equal(result[0].number, 5);
  });

  it("returns [] when stdout is not valid JSON", () => {
    const spy = makeSpawnSync({ "*": { status: 0, stdout: "not json", stderr: "" } });
    const result = queryClosedGoals("owner/repo", "2026-03-22T00:00:00Z", spy.fn);
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// buildReleaseReportContext
// ---------------------------------------------------------------------------

describe("buildReleaseReportContext", () => {
  it("throws when repo is missing", async () => {
    await assert.rejects(
      () => buildReleaseReportContext({ repo: "", clock: fixedClock(NOW_ISO) }),
      { message: "missing_repo" },
    );
  });

  it("returns basic structure with all stubs", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions()) as Record<string, unknown>;
    assert.equal(ctx.repo, "owner/repo");
    assert.equal(ctx.factory_id, "mothership");
    assert.equal(ctx.generated_at, NOW_ISO);
    assert.ok(ctx.since_iso);
    assert.ok(Array.isArray(ctx.goals));
    assert.ok(Array.isArray(ctx.issues));
    assert.ok(Array.isArray(ctx.prs));
    assert.ok(Array.isArray(ctx.commits));
    assert.ok(typeof ctx.metrics === "object");
    assert.ok(typeof ctx.diff_stats === "object");
    assert.ok(typeof ctx.timing === "object");
  });

  it("computes since_iso as lookbackHours before generated_at", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({ lookbackHours: 48 })) as Record<string, unknown>;
    const expectedSince = new Date(Date.parse(NOW_ISO) - 48 * 3600_000).toISOString();
    assert.equal(ctx.since_iso, expectedSince);
  });

  it("uses default lookbackHours of 24 for invalid values", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({ lookbackHours: -5 })) as Record<string, unknown>;
    const expectedSince = new Date(Date.parse(NOW_ISO) - 24 * 3600_000).toISOString();
    assert.equal(ctx.since_iso, expectedSince);
  });

  it("surfaces collectFactoryOutcomes errors in degraded output", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => { throw new Error("network_down"); },
    })) as Record<string, unknown>;
    assert.equal(ctx.degraded, true);
    assert.ok((ctx.errors as string[]).some((e) => e.includes("outcomes_lookup_failed")));
  });

  it("populates goals from queryClosedGoalsFn", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      queryClosedGoalsFn: () => [
        { number: 1, title: "G1", wave_key: "", url: "", closed_at: "2026-03-22T10:00:00.000Z", state: "CLOSED" },
        { number: 2, title: "G2", wave_key: "", url: "", closed_at: "2026-03-22T11:00:00.000Z", state: "CLOSED" },
      ],
    })) as Record<string, unknown>;
    assert.equal((ctx.goals as unknown[]).length, 2);
    assert.equal((ctx.metrics as Record<string, number>).goals_closed, 2);
  });

  it("deduplicates goals by number", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      queryClosedGoalsFn: () => [
        { number: 1, title: "G1a", wave_key: "", url: "", closed_at: "2026-03-22T10:00:00.000Z", state: "CLOSED" },
        { number: 1, title: "G1b", wave_key: "", url: "", closed_at: "2026-03-22T11:00:00.000Z", state: "CLOSED" },
      ],
    })) as Record<string, unknown>;
    assert.equal((ctx.goals as Record<string, unknown>[]).length, 1);
    assert.equal((ctx.goals as Record<string, unknown>[])[0].title, "G1a");
  });

  it("limits goals to newest 5", async () => {
    const goals = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1, title: `G${i + 1}`, wave_key: "", url: "",
      closed_at: `2026-03-22T${String(i).padStart(2, "0")}:00:00.000Z`,
      state: "CLOSED",
    }));
    const ctx = await buildReleaseReportContext(minimalOptions({
      queryClosedGoalsFn: () => goals,
    })) as Record<string, unknown>;
    assert.equal((ctx.goals as unknown[]).length, 5);
  });

  it("respects dedupCursor.seen_goal_numbers", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      dedupCursor: { seen_goal_numbers: [1] },
      queryClosedGoalsFn: () => [
        { number: 1, title: "G1", wave_key: "", url: "", closed_at: "", state: "CLOSED" },
        { number: 2, title: "G2", wave_key: "", url: "", closed_at: "", state: "CLOSED" },
      ],
    })) as Record<string, unknown>;
    assert.equal((ctx.goals as Record<string, unknown>[]).length, 1);
    assert.equal((ctx.goals as Record<string, unknown>[])[0].number, 2);
  });

  it("populates issues from outcomes and filters OPEN issues out", async () => {
    const resolveMetadata = (issues: Array<{ number: number; state: string }>) => {
      for (const issue of issues) {
        issue.state = issue.number === 1 ? "CLOSED" : "OPEN";
      }
    };
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        issues: [
          { number: 1, title: "Bug A", url: "", state: "CLOSED" },
          { number: 2, title: "Bug B", url: "", state: "OPEN" },
        ],
      }),
      resolveIssueMetadataFn: resolveMetadata,
    })) as Record<string, unknown>;
    assert.equal((ctx.issues as Record<string, unknown>[]).length, 1);
    assert.equal((ctx.issues as Record<string, unknown>[])[0].number, 1);
  });

  it("populates prs from outcomes", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        prs: [
          { number: 100, title: "PR1", url: "", merged_at: "2026-03-22T12:00:00Z" },
        ],
      }),
    })) as Record<string, unknown>;
    assert.equal((ctx.prs as unknown[]).length, 1);
    assert.equal((ctx.prs as Record<string, unknown>[])[0].number, 100);
  });

  it("slices commits at dedupCursor.last_release_sha", async () => {
    const commits = [
      { sha: "aaa", authored_at: "2026-03-22T10:00:00Z" },
      { sha: "bbb", authored_at: "2026-03-22T09:00:00Z" },
      { sha: "ccc", authored_at: "2026-03-22T08:00:00Z" },
    ];
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({ commits }),
      dedupCursor: { last_release_sha: "bbb" },
    })) as Record<string, unknown>;
    assert.equal((ctx.commits as unknown[]).length, 1);
    assert.equal((ctx.commits as Record<string, unknown>[])[0].sha, "aaa");
    assert.equal(ctx.last_commit_sha, "aaa");
  });

  it("sets last_commit_sha to empty string when no commits", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions()) as Record<string, unknown>;
    assert.equal(ctx.last_commit_sha, "");
  });

  it("diff_stats degrades when no commits exist", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions()) as Record<string, unknown>;
    assert.equal((ctx.diff_stats as Record<string, unknown>).degraded, true);
    assert.equal((ctx.diff_stats as Record<string, unknown>).reason, "no_commits_in_window");
  });

  it("normalizes diff_stats from gitDiffStatsFn", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        commits: [{ sha: "aaa", authored_at: "2026-03-22T10:00:00Z" }],
      }),
      gitDiffStatsFn: () => ({ added: 50, deleted: 10, files: 3 }),
    })) as Record<string, unknown>;
    assert.equal((ctx.diff_stats as Record<string, unknown>).added, 50);
    assert.equal((ctx.diff_stats as Record<string, unknown>).deleted, 10);
    assert.equal((ctx.diff_stats as Record<string, unknown>).files_changed, 3);
    assert.equal((ctx.diff_stats as Record<string, unknown>).degraded, false);
  });

  it("handles gitDiffStatsFn exception gracefully", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        commits: [{ sha: "aaa", authored_at: "2026-03-22T10:00:00Z" }],
      }),
      gitDiffStatsFn: () => { throw new Error("git_failed"); },
    })) as Record<string, unknown>;
    assert.equal((ctx.diff_stats as Record<string, unknown>).degraded, true);
    assert.ok((ctx.errors as string[]).some((e) => e.includes("diff_stats_unavailable")));
  });

  it("normalizes timing from runMetadataReaderFn", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      runMetadataReaderFn: () => ({ avg_wave_minutes: 12.5, sample_count: 3 }),
    })) as Record<string, unknown>;
    assert.equal((ctx.timing as Record<string, unknown>).avg_wave_minutes, 12.5);
    assert.equal((ctx.timing as Record<string, unknown>).sample_count, 3);
    assert.equal((ctx.timing as Record<string, unknown>).degraded, false);
  });

  it("handles runMetadataReaderFn exception gracefully", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      runMetadataReaderFn: () => { throw new Error("timing_boom"); },
    })) as Record<string, unknown>;
    assert.equal((ctx.timing as Record<string, unknown>).degraded, true);
    assert.ok((ctx.errors as string[]).some((e) => e.includes("timing_unavailable")));
  });

  it("surfaces outcomes.error in errors array", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({ error: "something broke" }),
    })) as Record<string, unknown>;
    assert.ok((ctx.errors as string[]).some((e) => e.includes("outcomes_error:something broke")));
  });

  it("surfaces outcomes.gh_failures in errors array", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        gh_failures: [{ query: "goals", reason: "rate_limit" }],
      }),
    })) as Record<string, unknown>;
    assert.ok((ctx.errors as string[]).some((e) => e.includes("outcomes_gh_failure:goals:rate_limit")));
  });

  it("surfaces outcomes_degraded flag", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({ outcomes_degraded: true }),
    })) as Record<string, unknown>;
    assert.ok((ctx.errors as string[]).includes("outcomes_degraded"));
    assert.equal(ctx.degraded, true);
  });

  it("sets degraded=false when no errors and no degraded subsystems", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        commits: [{ sha: "aaa", authored_at: "2026-03-22T10:00:00Z" }],
      }),
      gitDiffStatsFn: () => ({ added: 1, deleted: 0, files: 1 }),
      runMetadataReaderFn: () => ({ avg_wave_minutes: 5, sample_count: 1 }),
    })) as Record<string, unknown>;
    assert.equal(ctx.degraded, false);
    assert.equal((ctx.errors as string[]).length, 0);
  });

  it("deduplicates errors", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        error: "dup",
        gh_failures: [],
        outcomes_degraded: true,
      }),
    })) as Record<string, unknown>;
    const dupCount = (ctx.errors as string[]).filter((e) => e === "outcomes_degraded").length;
    assert.equal(dupCount, 1);
  });

  it("collects commit_log from outcomes", async () => {
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({ commit_log: "abc123 fix stuff" }),
    })) as Record<string, unknown>;
    assert.equal(ctx.commit_log, "abc123 fix stuff");
  });

  it("uses alternative outcome keys (closed_goals, closed_features_items, etc.)", async () => {
    const resolveMetadata = (issues: Array<{ state: string }>) => {
      for (const issue of issues) issue.state = "CLOSED";
    };
    const ctx = await buildReleaseReportContext(minimalOptions({
      collectFactoryOutcomesFn: () => ({
        closed_features_items: [{ number: 3, title: "Feat", url: "", state: "CLOSED" }],
        closed_bugs_items: [{ number: 4, title: "Bug", url: "", state: "CLOSED" }],
        merged_prs_items: [{ number: 50, title: "PR", url: "", merged_at: "2026-03-22T12:00:00Z" }],
      }),
      resolveIssueMetadataFn: resolveMetadata,
    })) as Record<string, unknown>;
    assert.equal((ctx.issues as unknown[]).length, 2);
    assert.equal((ctx.prs as unknown[]).length, 1);
  });
});
