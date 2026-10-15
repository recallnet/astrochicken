import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCatchupFileBasename, buildTopEntryPoints, collectReleaseReportIssues, parseReleaseReportIssue, rankComprehensionEntries, renderComprehensionCatchupMarkdown, runReleaseComprehensionCatchup, sanitizeRepoForFileName, scoreComprehensionEntry } from "../../src/commands/release-comprehension-catchup.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");


function fixtureBody() {
  return readFileSync(
    join(repoRoot, "packages/factory-ops/test/commands/fixtures/release/comprehension-report.typical.md"),
    "utf8",
  );
}

test("parseReleaseReportIssue extracts metrics and comprehension sections from release report body", () => {
  const parsed = parseReleaseReportIssue({
    number: 4312,
    title: "Release Understanding Report — 2026-03-18 20:00 UTC",
    url: "https://github.com/recallnet/astrochicken/issues/4312",
    updated_at: "2026-03-18T20:04:55Z",
    body: fixtureBody(),
  });

  assert.equal(parsed.issue_number, 4312);
  assert.equal(parsed.metrics.goals_closed, 1);
  assert.equal(parsed.metrics.issues_closed, 4);
  assert.equal(parsed.metrics.commits_landed, 7);
  assert.equal(parsed.conceptual_shift, "Release reporting moved from per-merge narration to significance-ranked comprehension batches.");
  assert.equal(parsed.why_it_matters, "Operators can now orient on conceptual movement without replaying every merged PR.");
  assert.deepEqual(parsed.entry_points, [
    "packages/factory-ops/src/commands/release-comprehension-catchup.ts",
    "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
  ]);
  assert.deepEqual(parsed.watch_items, [
    "Threshold calibration may require tuning after broader operator feedback.",
    "Missing sections in legacy release issues should remain non-fatal.",
  ]);
});

test("parseReleaseReportIssue tolerates missing narrative sections", () => {
  const parsed = parseReleaseReportIssue({
    number: 12,
    title: "Bare report",
    updated_at: "2026-03-10T00:00:00Z",
    body: "# Report\n\n| Metric | Value |\n| --- | --- |\n| Goals closed | 0 |\n| Issues closed | 1 |\n| Commits landed | 2 |\n",
  });

  assert.equal(parsed.conceptual_shift, null);
  assert.equal(parsed.why_it_matters, null);
  assert.deepEqual(parsed.entry_points, []);
  assert.deepEqual(parsed.watch_items, []);
  assert.equal(parsed.metrics.goals_closed, 0);
  assert.equal(parsed.metrics.issues_closed, 1);
  assert.equal(parsed.metrics.commits_landed, 2);
});

test("parseReleaseReportIssue falls back to comprehension-json metadata when sections are absent", () => {
  const parsed = parseReleaseReportIssue({
    number: 13,
    title: "Comment-backed report",
    updated_at: "2026-03-10T00:00:00Z",
    body: [
      "# Report",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| Goals closed | 2 |",
      "| Issues closed | 0 |",
      "| Commits landed | 1 |",
      "",
      "<!-- comprehension-json: {\"conceptual_shift\":\"Moved durability checks into shared release parser.\",\"why_it_matters\":\"Catch-up remains useful even if markdown headings drift.\",\"entry_points\":[\"packages/factory-ops/src/commands/release-comprehension-catchup.ts\"],\"watch_items\":[\"Keep comment payload schema stable.\"]} -->",
      "",
    ].join("\n"),
  });

  assert.equal(parsed.conceptual_shift, "Moved durability checks into shared release parser.");
  assert.equal(parsed.why_it_matters, "Catch-up remains useful even if markdown headings drift.");
  assert.deepEqual(parsed.entry_points, ["packages/factory-ops/src/commands/release-comprehension-catchup.ts"]);
  assert.deepEqual(parsed.watch_items, ["Keep comment payload schema stable."]);
  assert.equal(parsed.metrics.goals_closed, 2);
  assert.equal(parsed.metrics.issues_closed, 0);
  assert.equal(parsed.metrics.commits_landed, 1);
});

test("rankComprehensionEntries is deterministic with score then updated_at tie-break", () => {
  const ranked = rankComprehensionEntries([
    {
      issue_number: 100,
      updated_at: "2026-03-18T12:00:00.000Z",
      metrics: { goals_closed: 0, issues_closed: 2, commits_landed: 4 },
      entry_points: [],
    },
    {
      issue_number: 101,
      updated_at: "2026-03-18T12:10:00.000Z",
      metrics: { goals_closed: 0, issues_closed: 2, commits_landed: 4 },
      entry_points: [],
    },
    {
      issue_number: 102,
      updated_at: "2026-03-18T11:00:00.000Z",
      metrics: { goals_closed: 1, issues_closed: 0, commits_landed: 0 },
      entry_points: [],
    },
  ], 3);

  assert.deepEqual(ranked.map((entry) => entry.issue_number), [101, 100, 102]);
  assert.equal(scoreComprehensionEntry(ranked[0]), 8);
  assert.equal(ranked[0].score, 8);
});

test("buildTopEntryPoints collapses ranked entry points by weighted order", () => {
  const top = buildTopEntryPoints([
    { entry_points: ["a.mjs", "b.mjs"] },
    { entry_points: ["b.mjs", "c.mjs"] },
    { entry_points: ["b.mjs"] },
  ]);

  assert.deepEqual(top, ["b.mjs", "a.mjs", "c.mjs"]);
});

test("runReleaseComprehensionCatchup writes json and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-catchup-"));
  const outDir = join(root, "reports", "comprehension");

  try {
    const result = await runReleaseComprehensionCatchup({
      repo: "recallnet/astrochicken",
      lookbackDays: 7,
      limit: 2,
      outDir,
      clock: () => new Date("2026-03-18T21:00:00.000Z"),
      ghJsonFn: () => [
        {
          number: 4311,
          title: "Release Understanding Report — older",
          url: "https://github.com/recallnet/astrochicken/issues/4311",
          updatedAt: "2026-03-18T20:00:00Z",
          body: fixtureBody(),
        },
        {
          number: 4312,
          title: "Release Understanding Report — newest",
          url: "https://github.com/recallnet/astrochicken/issues/4312",
          updatedAt: "2026-03-18T20:10:00Z",
          body: fixtureBody().replace("| Commits landed | 7 |", "| Commits landed | 8 |"),
        },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.entries_ranked, 2);
    assert.equal(result.no_release_reports, false);
    assert.match(result.json_path, /reports\/comprehension\/catchup-/);
    assert.match(result.markdown_path, /reports\/comprehension\/catchup-/);

    const jsonPayload = JSON.parse(readFileSync(result.json_path, "utf8"));
    assert.equal(jsonPayload.entries.length, 2);
    assert.equal(jsonPayload.entries[0].issue_number, 4312);
    assert.ok(Array.isArray(jsonPayload.top_entry_points));
    assert.ok(jsonPayload.top_entry_points.includes("packages/factory-ops/src/commands/release-comprehension-catchup.ts"));

    const markdown = readFileSync(result.markdown_path, "utf8");
    assert.match(markdown, /# Release Comprehension Catch-up/);
    assert.match(markdown, /## Top Entry Points/);
    assert.match(markdown, /## Ranked Conceptual Shifts/);
    assert.match(markdown, /#4312/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runReleaseComprehensionCatchup succeeds with zero release-report issues", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-catchup-empty-"));
  const outDir = join(root, "reports", "comprehension");

  try {
    const result = await runReleaseComprehensionCatchup({
      repo: "recallnet/astrochicken",
      outDir,
      clock: () => new Date("2026-03-18T21:00:00.000Z"),
      ghJsonFn: () => [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.no_release_reports, true);
    assert.equal(result.entries_ranked, 0);

    const jsonPayload = JSON.parse(readFileSync(result.json_path, "utf8"));
    assert.deepEqual(jsonPayload.entries, []);

    const markdown = readFileSync(result.markdown_path, "utf8");
    assert.match(markdown, /No release-report issues were found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderComprehensionCatchupMarkdown includes expected sections", () => {
  const markdown = renderComprehensionCatchupMarkdown({
    repo: "recallnet/astrochicken",
    generated_at: "2026-03-18T21:00:00.000Z",
    catchup_window: {
      since_iso: "2026-03-11T21:00:00.000Z",
      now_iso: "2026-03-18T21:00:00.000Z",
    },
    top_entry_points: ["x.mjs"],
    entries: [
      {
        issue_number: 4312,
        title: "Sample report",
        url: "https://example.com",
        updated_at: "2026-03-18T20:00:00.000Z",
        score: 17,
        metrics: { goals_closed: 1, issues_closed: 3, commits_landed: 7 },
        conceptual_shift: "shift",
        why_it_matters: "why",
        entry_points: ["x.mjs"],
        watch_items: ["watch"],
      },
    ],
  });

  assert.match(markdown, /## Top Entry Points/);
  assert.match(markdown, /## Ranked Conceptual Shifts/);
  assert.match(markdown, /Score: 17/);
});

test("sanitizeRepoForFileName produces deterministic slug", () => {
  assert.equal(sanitizeRepoForFileName("RecallNet/AstroChicken"), "recallnet-astrochicken");
  assert.equal(sanitizeRepoForFileName(""), "repo");
});

test("buildCatchupFileBasename uses deterministic timestamp + repo slug", () => {
  const out = buildCatchupFileBasename({
    generatedAt: "2026-03-19T03:50:41.548Z",
    repo: "recallnet/astrochicken",
  });
  assert.equal(out, "catchup-20260319T035041548Z-recallnet-astrochicken");
});

test("collectReleaseReportIssues requests release-report issues with since filter", async () => {
  const calls = [];
  const issues = await collectReleaseReportIssues({
    repo: "recallnet/astrochicken",
    sinceIso: "2026-03-18T00:00:00.000Z",
    ghJsonFn(args) {
      calls.push(args);
      return [
        {
          number: 7,
          title: "Release report",
          url: "https://github.com/recallnet/astrochicken/issues/7",
          updatedAt: "2026-03-18T02:00:00.000Z",
          body: fixtureBody(),
        },
      ];
    },
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].issue_number, 7);
  assert.ok(Array.isArray(calls));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("--label"));
  assert.ok(calls[0].includes("release-report"));
  assert.ok(calls[0].includes("--since"));
  assert.ok(calls[0].includes("2026-03-18T00:00:00.000Z"));
});

test("release comprehension-catchup CLI handles flags and prints summary json", () => {
  const root = mkdtempSync(join(tmpdir(), "release-catchup-cli-gh-"));
  const ghPath = join(root, "gh");
  const runOutDir = mkdtempSync(join(tmpdir(), "release-catchup-cli-out-"));

  try {
    writeFileSync(ghPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "list") {
  process.stdout.write("[]");
  process.exit(0);
}
process.stderr.write("unexpected gh call: " + args.join(" "));
process.exit(1);
`, { mode: 0o755 });

    const run = spawnOpsCli([
      "release",
      "comprehension-catchup",
      "--repo",
      "recallnet/astrochicken",
      "--lookback-days",
      "1",
      "--limit",
      "2",
      "--out-dir",
      runOutDir
    ], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
      }
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}").trim());
    assert.equal(out.ok, true);
    assert.equal(out.repo, "recallnet/astrochicken");
    assert.equal(out.no_release_reports, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(runOutDir, { recursive: true, force: true });
  }
});
