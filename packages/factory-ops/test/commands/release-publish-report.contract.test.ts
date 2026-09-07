import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_REPORT_LABEL,
  buildReleaseReportIssueBody,
  publishReleaseReportIssue,
} from "../../src/commands/release-publish-report.ts";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("buildReleaseReportIssueBody uses narrator report_body directly as issue body", () => {
  const reportBody = [
    "# Release reports now favor understanding over changelog noise",
    "",
    "Release reporting now clusters shipped changes into a single conceptual brief.",
    "",
    "## Before",
    "Catching up required reading merge output.",
    "",
    "## After",
    "One brief now explains the shift and where to start reading.",
    "",
    "## Shipped Goals",
    "- [#2297 Goal: Counteract comprehension debt](https://github.com/recallnet/astrochicken/issues/2297)",
  ].join("\n");

  const body = buildReleaseReportIssueBody({
    context: {
      repo: "recallnet/astrochicken",
      factory_id: "mothership",
      generated_at: "2026-03-17T18:00:00.000Z",
      since_iso: "2026-03-17T15:00:00.000Z",
      metrics: { goals_closed: 1, issues_closed: 4, commits_landed: 5 },
      goals: [{ number: 2297, title: "Goal: Counteract comprehension debt", url: "https://github.com/recallnet/astrochicken/issues/2297" }],
    },
    narrative: {
      delivery_decision: "slack_and_issue",
      report_body: reportBody,
    },
  });

  assert.match(body, /^# Release reports now favor understanding over changelog noise/m);
  assert.match(body, /## Before/);
  assert.match(body, /## After/);
  assert.match(body, /Goal: Counteract comprehension debt/);
  assert.match(body, /Goals closed/);
  assert.match(body, /<!-- release-report-fingerprint:/);
  assert.doesNotMatch(body, /<!-- comprehension-json:/);
});

test("publishReleaseReportIssue ensures dedicated label and creates issue", () => {
  const calls = [];
  const ghFn = (args) => {
    calls.push(args);
    if (args[0] === "label" && args[1] === "create") {
      return { ok: true, status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "create") {
      return { ok: true, status: 0, stdout: "https://github.com/recallnet/astrochicken/issues/9999\n", stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "list") {
      return { ok: true, status: 0, stdout: "[]", stderr: "" };
    }
    return { ok: false, status: 1, stdout: "", stderr: `unexpected:${args.join(" ")}` };
  };

  const ghJsonFn = (args, fallback = []) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return [];
    return fallback;
  };

  const result = publishReleaseReportIssue({
    repo: "recallnet/astrochicken",
    context: {
      repo: "recallnet/astrochicken",
      factory_id: "mothership",
      generated_at: "2026-03-17T18:00:00.000Z",
      since_iso: "2026-03-17T15:00:00.000Z",
      metrics: { goals_closed: 1, issues_closed: 3, commits_landed: 4 },
      goals: [],
    },
    narrative: {
      delivery_decision: "slack_and_issue",
      headline: "Managed factories now keep release chatter quiet",
      before_state: "Low-signal release windows still interrupted people.",
      after_state: "The reporter now keeps weaker windows in GitHub without broadcasting them to Slack.",
      summary: "The release reporter now skips trivial merge trickles and writes fuller briefs, so real conceptual changes get durable narration.",
      conceptual_shift: "Understanding is now the release unit, not merge-level narration.",
      why_it_matters: "The team sees fewer interruptions and better catch-up material.",
      proof_points: ["Issue-heavy release windows can still produce durable reports."],
      structural_changes: ["Publish flow now expects deterministic significance context in the narrative contract."],
      behavioral_shifts: ["Issue-only windows still include comprehension sections when narrating."],
      implicit_decisions: ["Issue-only delivery remains non-blocking and signal-first."],
      entry_points: ["packages/factory-ops/src/commands/release-publish-report.ts"],
      watch_items: [],
    },
    ghFn,
    ghJsonFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "published");
  assert.equal(result.issue_number, 9999);
  assert.equal(result.issue_url, "https://github.com/recallnet/astrochicken/issues/9999");
  assert.ok(calls.some((args) => args[0] === "label" && args.includes(RELEASE_REPORT_LABEL)));
  assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "create" && args.includes(RELEASE_REPORT_LABEL)));
});

test("publishReleaseReportIssue updates an existing report when the fingerprint matches even if the title changed", () => {
  const calls = [];
  const result = publishReleaseReportIssue({
    repo: "recallnet/astrochicken",
    context: {
      repo: "recallnet/astrochicken",
      factory_id: "mothership",
      generated_at: "2026-03-19T21:31:28.000Z",
      since_iso: "2026-03-18T21:31:28.000Z",
      metrics: { goals_closed: 1, issues_closed: 4, commits_landed: 12 },
      goals: [{ number: 2355, title: "Goal: Example", url: "https://github.com/recallnet/astrochicken/issues/2355" }],
      issues: [],
      last_commit_sha: "abc123",
    },
    narrative: {
      delivery_decision: "slack_and_issue",
      headline: "Factory identity now standardizes on target_repo",
      before_state: "Repo identity came from multiple aliases.",
      after_state: "Repo identity now resolves through target_repo.",
      summary: "The report identity should update instead of creating a fresh issue.",
      conceptual_shift: "Identity uses one canonical source.",
      why_it_matters: "Release chatter should not spam duplicate issues.",
      proof_points: ["Goal #2355 unified the identity contract."],
      entry_points: ["apps/hatch/src/factory/context-resolver.ts"],
      watch_items: [],
    },
    ghFn(args) {
      calls.push(args);
      if (args[0] === "label" && args[1] === "create") return { ok: true, status: 0, stdout: "", stderr: "" };
      if (args[0] === "issue" && args[1] === "edit") return { ok: true, status: 0, stdout: "", stderr: "" };
      return { ok: false, status: 1, stdout: "", stderr: `unexpected:${args.join(" ")}` };
    },
    ghJsonFn(args) {
      calls.push(args);
      if (args[0] === "issue" && args[1] === "list") {
        return [{
          number: 2410,
          title: "Release Understanding Report — old title",
          url: "https://github.com/recallnet/astrochicken/issues/2410",
          body: "<!-- release-report-fingerprint: mothership:2026-03-19:g-2355:i-0:c-12:last-abc123 -->",
        }];
      }
      return [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.issue_number, 2410);
  assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "edit"));
});

test("release report flow publishes through the typed action contract", () => {
  const dot = readFileSync(
    join(repoRoot, "docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot"),
    "utf8",
  );
  assert.ok(dot.includes('action_id="release.publish_report"'));
});

test("release publish-report CLI supports raw and base64 transport with parity", () => {
  const context = {
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    generated_at: "2026-03-17T18:00:00.000Z",
    since_iso: "2026-03-17T15:00:00.000Z",
    metrics: { goals_closed: 1, issues_closed: 3, commits_landed: 4 },
    goals: [],
    issues: [],
    prs: [],
    diff_stats: {},
    timing: {},
    errors: [],
  };
  const narrative = {
    delivery_decision: "slack_and_issue",
    headline: "Managed factories now keep release chatter quiet",
    before_state: "Low-signal release windows still interrupted people.",
    after_state: "The reporter now keeps weaker windows in GitHub without broadcasting them to Slack.",
    summary: "The release reporter now skips trivial merge trickles and writes fuller briefs, so real conceptual changes get durable narration.",
    conceptual_shift: "Understanding is now the release unit, not merge-level narration.",
    why_it_matters: "The team sees fewer interruptions and better catch-up material.",
    proof_points: ["Issue-heavy release windows can still produce durable reports."],
    structural_changes: ["Publish flow now expects deterministic significance context in the narrative contract."],
    behavioral_shifts: ["Issue-only windows still include comprehension sections when narrating."],
    implicit_decisions: ["Issue-only delivery remains non-blocking and signal-first."],
    entry_points: ["packages/factory-ops/src/commands/release-publish-report.ts"],
    watch_items: [],
  };

  const tempBinDir = join(repoRoot, ".tmp-test-bin");
  const ghStub = join(tempBinDir, "gh");
  mkdirSync(tempBinDir, { recursive: true });
  writeFileSync(ghStub, `#!/bin/sh
set -eu
cmd="$1"
sub="$2"
shift 2
if [ "$cmd" = "label" ] && [ "$sub" = "create" ]; then
  exit 0
fi
if [ "$cmd" = "issue" ] && [ "$sub" = "list" ]; then
  printf '[]'
  exit 0
fi
if [ "$cmd" = "issue" ] && [ "$sub" = "create" ]; then
  printf 'https://github.com/recallnet/astrochicken/issues/9999\\n'
  exit 0
fi
if [ "$cmd" = "issue" ] && [ "$sub" = "edit" ]; then
  printf 'https://github.com/recallnet/astrochicken/issues/9999\\n'
  exit 0
fi
echo "unexpected gh call: $cmd $sub $*" >&2
exit 1
`, { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${tempBinDir}:${process.env.PATH}`,
  };

  const rawRun = spawnSync("node", [
    opsCliPath,
    "release",
    "publish-report",
    "--context",
    JSON.stringify(context),
    "--narrative",
    JSON.stringify(narrative),
    "--repo",
    "recallnet/astrochicken",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  assert.equal(rawRun.status, 0, rawRun.stderr || rawRun.stdout);
  const rawOut = JSON.parse(rawRun.stdout || "{}");

  const b64Run = spawnSync("node", [
    opsCliPath,
    "release",
    "publish-report",
    "--context-b64",
    Buffer.from(JSON.stringify(context), "utf8").toString("base64"),
    "--narrative-b64",
    Buffer.from(JSON.stringify(narrative), "utf8").toString("base64"),
    "--repo",
    "recallnet/astrochicken",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  assert.equal(b64Run.status, 0, b64Run.stderr || b64Run.stdout);
  const b64Out = JSON.parse(b64Run.stdout || "{}");

  assert.equal(rawOut.status, "published");
  assert.equal(rawOut.issue_number, 9999);
  assert.deepEqual(rawOut, b64Out);
});

test("release publish-report CLI fails closed when narrative transport is missing", () => {
  const context = {
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    generated_at: "2026-03-17T18:00:00.000Z",
    since_iso: "2026-03-17T15:00:00.000Z",
    metrics: { goals_closed: 1, issues_closed: 3, commits_landed: 4 },
    goals: [],
  };

  const run = spawnSync("node", [
    opsCliPath,
    "release",
    "publish-report",
    "--context",
    JSON.stringify(context),
    "--repo",
    "recallnet/astrochicken",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /release publish-report requires one transport: --narrative or --narrative-b64/);
});
