import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildReleaseReportContext, queryClosedGoals, resolveGoalTitles, resolveIssueMetadata } from "../../src/commands/release-build-report-context.ts";
import { computeDiffStats, parseGitShortStat } from "../../src/lib/git-diff-stats.ts";
import { collectWaveTimingMetadata } from "../../src/lib/run-metadata-reader.ts";

test("buildReleaseReportContext defaults to 24h lookback", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({ goals: [], issues: [], prs: [] }),
    runMetadataReaderFn: () => ({ degraded: true, reason: "no_data" }),
    resolveGoalTitlesFn: () => {},
  });

  assert.equal(output.since_iso, "2026-03-08T20:00:00.000Z");
});

test("buildReleaseReportContext filters out already-reported items via dedupCursor", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    dedupCursor: {
      seen_goal_numbers: [1517],
      seen_issues: [],
      seen_prs: [800],
    },
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "feat: stuff", authored_at: "2026-03-09T18:00:00+00:00" }],
      goals: [],
      issues: [{ number: 1530, title: "Issue", url: "https://example.com/i/1530", closed_at: "2026-03-09T18:15:00.000Z" }],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [
      { number: 1517, title: "Old Goal", url: "https://example.com/g/1517", closed_at: "2026-03-09T18:00:00.000Z", state: "CLOSED" },
      { number: 1600, title: "New Goal", url: "https://example.com/g/1600", closed_at: "2026-03-09T19:00:00.000Z", state: "CLOSED" },
    ],
  });

  assert.equal(output.goals.length, 1);
  assert.equal(output.goals[0].number, 1600);
  assert.equal(output.issues.length, 1);
  assert.equal(output.prs.length, 0);
  assert.equal(output.metrics.goals_closed, 1);
  assert.equal(output.metrics.commits_landed, 1);
});

test("buildReleaseReportContext passes all items through when no dedupCursor", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    dedupCursor: null,
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "Merge branch 'wave/goal-1517-wave-1'", authored_at: "2026-03-09T18:00:00+00:00" }],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [
      { number: 1517, title: "Goal", url: "https://example.com/g/1517", closed_at: "2026-03-09T18:00:00.000Z", state: "CLOSED" },
    ],
  });

  assert.equal(output.goals.length, 1);
  assert.equal(output.metrics.goals_closed, 1);
});

test("buildReleaseReportContext assembles deterministic release context from injected dependencies", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "abc123", subject: "feat: add thing (Closes #1530)", authored_at: "2026-03-09T18:00:00+00:00" },
        { sha: "def456", subject: "Merge branch 'wave/goal-1517-wave-1'", authored_at: "2026-03-09T18:30:00+00:00" },
      ],
      goals: [],
      issues: [{ number: 1530, title: "Issue", url: "https://example.com/i/1530", closed_at: "2026-03-09T18:15:00.000Z" }],
      prs: [],
      merged_prs: 0,
      closed_goals: 0,
      closed_feature_bug_total: 1,
      outcomes_degraded: false,
    }),
    gitDiffStatsFn: () => ({
      added: 19,
      deleted: 7,
      files_changed: 3,
      text: "+19 -7",
      degraded: false,
      reason: null,
    }),
    runMetadataReaderFn: () => ({
      avg_wave_minutes: 38,
      sample_count: 2,
      degraded: false,
      reason: null,
    }),
    queryClosedGoalsFn: () => [
      { number: 1517, title: "Goal", url: "https://example.com/g/1517", closed_at: "2026-03-09T18:00:00.000Z", state: "CLOSED" },
    ],
  });

  assert.equal(output.repo, "acme/platform");
  assert.equal(output.factory_id, "mothership");
  assert.equal(output.generated_at, "2026-03-09T20:00:00.000Z");
  assert.equal(output.since_iso, "2026-03-08T20:00:00.000Z");
  assert.equal(output.degraded, false);
  assert.deepEqual(output.errors, []);
  assert.equal(output.metrics.goals_closed, 1);
  assert.equal(output.metrics.issues_closed, 1);
  assert.equal(output.metrics.commits_landed, 2);
  assert.equal(output.diff_stats.text, "+19 -7");
  assert.equal(output.timing.avg_wave_minutes, 38);
  assert.equal(output.timing.sample_count, 2);
});

test("buildReleaseReportContext keeps structured output when outcomes lookup fails", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => {
      throw new Error("gh authentication required");
    },
    runMetadataReaderFn: () => ({
      avg_wave_minutes: 42,
      sample_count: 1,
      degraded: false,
      reason: null,
    }),
    resolveGoalTitlesFn: () => {},
  });

  assert.equal(output.degraded, true);
  assert.equal(Array.isArray(output.errors), true);
  assert.ok(output.errors.some((entry) => entry.includes("outcomes_lookup_failed:gh authentication required")));
  assert.equal(Array.isArray(output.goals), true);
  assert.equal(Array.isArray(output.issues), true);
  assert.equal(Array.isArray(output.prs), true);
  assert.equal(typeof output.diff_stats.degraded, "boolean");
});

test("computeDiffStats parses git shortstat output and reports deterministic degraded modes", () => {
  const parsed = parseGitShortStat(" 3 files changed, 10 insertions(+), 4 deletions(-)");
  assert.deepEqual(parsed, {
    added: 10,
    deleted: 4,
    files_changed: 3,
    text: "+10 -4",
  });

  const okStats = computeDiffStats({
    repoPath: "/tmp/repo",
    sinceIso: "2026-03-08T20:00:00.000Z",
    nowIso: "2026-03-09T20:00:00.000Z",
    spawnSyncFn: (_command, args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") {
        return { status: 0, stdout: "true\n", stderr: "" };
      }
      if (key === "rev-parse main") {
        return { status: 0, stdout: "head123\n", stderr: "" };
      }
      if (key.startsWith("rev-list -1 --before=2026-03-08T20:00:00.000Z")) {
        return { status: 0, stdout: "base456\n", stderr: "" };
      }
      if (key === "diff --shortstat base456..head123") {
        return { status: 0, stdout: " 2 files changed, 8 insertions(+), 3 deletions(-)\n", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unsupported" };
    },
  });

  assert.equal(okStats.degraded, false);
  assert.equal(okStats.added, 8);
  assert.equal(okStats.deleted, 3);
  assert.equal(okStats.files_changed, 2);
  assert.equal(okStats.text, "+8 -3");

  const degraded = computeDiffStats({
    repoPath: "/tmp/not-repo",
    sinceIso: "2026-03-08T20:00:00.000Z",
    nowIso: "2026-03-09T20:00:00.000Z",
    spawnSyncFn: () => ({ status: 1, stdout: "", stderr: "fatal: not a git repository" }),
  });

  assert.equal(degraded.degraded, true);
  assert.equal(degraded.reason, "git_repo_unavailable");
});

test("collectWaveTimingMetadata reads merged wave timings and degrades when run metadata is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "release-context-timing-"));
  const hatchRoot = join(root, ".hatch");
  const runsDir = join(hatchRoot, "mothership", "runs", "run-1");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, "state.json"), JSON.stringify({
    runId: "run-1",
    pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    status: "completed",
    startedAt: "2026-03-09T18:00:00.000Z",
    updatedAt: "2026-03-09T18:45:00.000Z",
    context: {
      merged_count: "1",
    },
  }, null, 2));

  const timing = collectWaveTimingMetadata({
    factoryId: "mothership",
    sinceIso: "2026-03-09T00:00:00.000Z",
    nowIso: "2026-03-10T00:00:00.000Z",
    hatchRoot,
  });

  assert.equal(timing.degraded, false);
  assert.equal(timing.sample_count, 1);
  assert.equal(timing.merged_wave_count, 1);
  assert.equal(timing.avg_wave_minutes, 45);

  const missingTiming = collectWaveTimingMetadata({
    factoryId: "missing-factory",
    sinceIso: "2026-03-09T00:00:00.000Z",
    nowIso: "2026-03-10T00:00:00.000Z",
    hatchRoot,
  });

  assert.equal(missingTiming.degraded, true);
  assert.equal(missingTiming.reason, "runs_dir_missing");
  assert.equal(missingTiming.sample_count, 0);
});

test("buildReleaseReportContext deduplicates goals by number", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "feat: stuff", authored_at: "2026-03-09T18:00:00+00:00" }],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [
      { number: 1852, title: "Goal #1852", url: "https://example.com/g/1852", closed_at: "2026-03-09T18:00:00Z", state: "CLOSED" },
      { number: 1900, title: "Goal #1900", url: "https://example.com/g/1900", closed_at: "2026-03-09T19:00:00Z", state: "CLOSED" },
    ],
  });

  assert.equal(output.goals.length, 2);
  assert.equal(output.goals[0].number, 1900);
  assert.equal(output.goals[1].number, 1852);
  assert.equal(output.metrics.goals_closed, 2);
});

test("buildReleaseReportContext keeps only the newest shipped goal and issue anchors", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "c1", subject: "feat: first", authored_at: "2026-03-09T17:00:00+00:00" },
        { sha: "c2", subject: "feat: second", authored_at: "2026-03-09T18:00:00+00:00" },
      ],
      issues: Array.from({ length: 8 }, (_, index) => ({
        number: 2000 + index,
        title: `Issue ${index + 1}`,
        url: `https://example.com/i/${2000 + index}`,
        closed_at: `2026-03-09T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
      })),
      goals: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 12, deleted: 3, files_changed: 2, text: "+12 -3", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 10, sample_count: 1, degraded: false }),
    queryClosedGoalsFn: () => Array.from({ length: 8 }, (_, index) => ({
      number: 1500 + index,
      title: `Goal ${index + 1}`,
      url: `https://example.com/g/${1500 + index}`,
      closed_at: `2026-03-09T${String(10 + index).padStart(2, "0")}:30:00.000Z`,
      state: "CLOSED",
    })),
    resolveIssueMetadataFn: (issues) => {
      for (const issue of issues) issue.state = "CLOSED";
    },
  });

  assert.equal(output.metrics.goals_closed, 8);
  assert.equal(output.metrics.issues_closed, 8);
  assert.equal(output.goals.length, 5);
  assert.equal(output.issues.length, 5);
  assert.deepEqual(output.goals.map((goal) => goal.number), [1507, 1506, 1505, 1504, 1503]);
  assert.deepEqual(output.issues.map((issue) => issue.number), [2007, 2006, 2005, 2004, 2003]);
});

test("buildReleaseReportContext filters commits after last_release_sha from dedup cursor", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    dedupCursor: {
      seen_goal_numbers: [],
      seen_issues: [],
      seen_prs: [],
      last_release_sha: "sha_old",
    },
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "sha_new", subject: "feat: new thing", authored_at: "2026-03-09T18:00:00+00:00" },
        { sha: "sha_old", subject: "feat: already reported", authored_at: "2026-03-09T16:00:00+00:00" },
        { sha: "sha_older", subject: "feat: even older", authored_at: "2026-03-09T15:00:00+00:00" },
      ],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [],
  });

  // Only commits after last_release_sha should be counted
  assert.equal(output.metrics.commits_landed, 1);
  assert.equal(output.commits.length, 1);
  assert.equal(output.commits[0].sha, "sha_new");
});

test("buildReleaseReportContext records last_commit_sha for dedup cursor consumption", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "head_sha", subject: "feat: latest", authored_at: "2026-03-09T19:00:00+00:00" },
        { sha: "older_sha", subject: "feat: older", authored_at: "2026-03-09T18:00:00+00:00" },
      ],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 10, deleted: 5, files_changed: 2, text: "+10 -5", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [],
  });

  // Should record the most recent commit SHA for cursor tracking
  assert.equal(output.last_commit_sha, "head_sha");
});

test("queryClosedGoals parses GH JSON response into normalized goals", () => {
  const mockSpawnSync = (_cmd, args) => {
    assert.ok(args.includes("--label"), "should query by label");
    assert.ok(args.includes("goal"), "label should be 'goal'");
    assert.ok(args.includes("--state"), "should filter by state");
    assert.ok(args.includes("closed"), "state should be 'closed'");
    return {
      status: 0,
      stdout: JSON.stringify([
        { number: 2321, title: "Build queryable factory insights", url: "https://github.com/acme/platform/issues/2321", closedAt: "2026-03-09T18:30:00Z" },
        { number: 2322, title: "Consolidate routing", url: "https://github.com/acme/platform/issues/2322", closedAt: "2026-03-09T19:00:00Z" },
      ]),
    };
  };
  const goals = queryClosedGoals("acme/platform", "2026-03-08T20:00:00.000Z", mockSpawnSync);
  assert.equal(goals.length, 2);
  assert.equal(goals[0].number, 2321);
  assert.equal(goals[0].title, "Build queryable factory insights");
  assert.equal(goals[0].state, "CLOSED");
  assert.equal(goals[1].number, 2322);
});

test("queryClosedGoals returns empty array on GH failure", () => {
  const goals = queryClosedGoals("acme/platform", "2026-03-08T20:00:00.000Z", () => ({ status: 1, stdout: "" }));
  assert.deepEqual(goals, []);
});

test("queryClosedGoals returns empty array when repo is missing", () => {
  const goals = queryClosedGoals("", "2026-03-08T20:00:00.000Z", () => { throw new Error("should not call"); });
  assert.deepEqual(goals, []);
});

test("resolveGoalTitles updates goal titles from mock spawnSync", () => {
  const goals = [
    { number: 1852, title: "Goal #1852", url: "" },
    { number: 1900, title: "Goal #1900", url: "" },
  ];
  const mockSpawnSync = (_cmd, args) => {
    const num = args[2];
    const titles = { "1852": "Add feature dependency resolution", "1900": "Improve review metrics" };
    return { status: 0, stdout: titles[num] || "" };
  };
  resolveGoalTitles(goals, "acme/platform", mockSpawnSync);
  assert.equal(goals[0].title, "Add feature dependency resolution");
  assert.equal(goals[1].title, "Improve review metrics");
});

test("resolveGoalTitles keeps stub title on failure", () => {
  const goals = [{ number: 999, title: "Goal #999", url: "" }];
  resolveGoalTitles(goals, "acme/platform", () => ({ status: 1, stdout: "" }));
  assert.equal(goals[0].title, "Goal #999");
});

test("resolveGoalTitles no-ops on empty repo", () => {
  const goals = [{ number: 1, title: "Goal #1", url: "" }];
  resolveGoalTitles(goals, "", () => { throw new Error("should not be called"); });
  assert.equal(goals[0].title, "Goal #1");
});

test("resolveIssueMetadata updates issue titles and states from mock spawnSync", () => {
  const issues = [
    { number: 2363, title: "Issue #2363", url: "" },
    { number: 2364, title: "Issue #2364", url: "" },
  ];
  const mockSpawnSync = (_cmd, args) => {
    const number = args[2];
    const field = args[args.length - 1];
    const responses = {
      "2363:.title": "Document canonical Hatch graph transition/convergence contract",
      "2363:.state": "CLOSED",
      "2363:.closedAt": "2026-03-18T18:53:27Z",
      "2364:.title": "Add CLI introspection for effective LLM routing with provenance",
      "2364:.state": "OPEN",
      "2364:.closedAt": "",
    };
    return { status: 0, stdout: responses[`${number}:${field}`] || "" };
  };

  resolveIssueMetadata(issues, "acme/platform", mockSpawnSync);
  assert.equal(issues[0].title, "Document canonical Hatch graph transition/convergence contract");
  assert.equal(issues[0].state, "CLOSED");
  assert.equal(issues[1].title, "Add CLI introspection for effective LLM routing with provenance");
  assert.equal(issues[1].state, "OPEN");
});

test("buildReleaseReportContext sources goals from GH query not commit parsing", async () => {
  // Goals should come from a direct GH query (label:goal, state:closed, since window)
  // NOT from parsing commit messages. The outcomes may report goal stubs, but
  // buildReleaseReportContext should use queryClosedGoalsFn as the authoritative source.
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "abc", subject: "feat(goal-2321): goal-2321 (#2321)", authored_at: "2026-03-09T18:00:00+00:00" },
        { sha: "def", subject: "feat(goal-9999): goal-9999 (#9999)", authored_at: "2026-03-09T18:30:00+00:00" },
      ],
      // outcomes produces goal stubs from commit messages — these should be IGNORED
      goals: [
        { number: 2321, title: "Goal #2321", url: "https://example.com/g/2321" },
        { number: 9999, title: "Goal #9999", url: "https://example.com/g/9999" },
      ],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    // GH query returns only goal 2321 as closed — 9999 doesn't exist or isn't closed
    queryClosedGoalsFn: () => [
      { number: 2321, title: "Build queryable factory insights", url: "https://github.com/acme/platform/issues/2321", closed_at: "2026-03-09T18:30:00Z", state: "CLOSED" },
    ],
  });

  assert.equal(output.goals.length, 1, "goals should come from GH query, not commit parsing");
  assert.equal(output.goals[0].number, 2321);
  assert.equal(output.goals[0].title, "Build queryable factory insights");
  assert.equal(output.metrics.goals_closed, 1);
});

test("buildReleaseReportContext degrades gracefully when GH goal query returns empty", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [
        { sha: "abc", subject: "feat(goal-2321): goal-2321 (#2321)", authored_at: "2026-03-09T18:00:00+00:00" },
      ],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 0, deleted: 0, files_changed: 0, text: "+0 -0", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    queryClosedGoalsFn: () => [],
  });

  assert.equal(output.goals.length, 0, "no goals when GH query returns empty");
  assert.equal(output.metrics.goals_closed, 0);
});

test("buildReleaseReportContext filters open issues out of shipped issue evidence after metadata resolution", async () => {
  const output = await buildReleaseReportContext({
    repo: "acme/platform",
    factoryId: "mothership",
    repoPath: "/tmp/acme/platform",
    lookbackHours: 24,
    clock: () => new Date("2026-03-09T20:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc123", subject: "fix: tighten routing (Closes #2363) (Closes #2364)", authored_at: "2026-03-09T18:00:00+00:00" }],
      goals: [],
      issues: [
        { number: 2363, title: "Issue #2363", url: "https://example.com/i/2363", closed_at: "" },
        { number: 2364, title: "Issue #2364", url: "https://example.com/i/2364", closed_at: "" },
      ],
      prs: [],
      merged_prs: 0,
      closed_goals: 0,
      closed_feature_bug_total: 2,
      outcomes_degraded: false,
    }),
    gitDiffStatsFn: () => ({ added: 19, deleted: 7, files_changed: 3, text: "+19 -7", degraded: false, reason: null }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 0, sample_count: 0, degraded: true, reason: "no_data" }),
    resolveGoalTitlesFn: () => {},
    resolveIssueMetadataFn(issues) {
      issues[0].title = "Document canonical Hatch graph transition/convergence contract";
      issues[0].state = "CLOSED";
      issues[0].closed_at = "2026-03-09T18:15:00.000Z";
      issues[1].title = "Add CLI introspection for effective LLM routing with provenance";
      issues[1].state = "OPEN";
      issues[1].closed_at = "";
    },
  });

  assert.equal(output.issues.length, 1);
  assert.equal(output.issues[0].number, 2363);
  assert.equal(output.issues[0].title, "Document canonical Hatch graph transition/convergence contract");
  assert.equal(output.metrics.issues_closed, 1);
});
