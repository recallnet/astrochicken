import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseReportIssueBody, buildReleaseReportIssueTitle, publishReleaseReportIssue } from "../../src/commands/release-publish-report.ts";

test("buildReleaseReportIssueBody uses narrator markdown directly as the report body", () => {
  const context = {
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    generated_at: "2026-03-17T18:00:00.000Z",
    since_iso: "2026-03-17T15:00:00.000Z",
    metrics: { goals_closed: 1, issues_closed: 4, commits_landed: 5 },
    goals: [{ number: 2297, title: "Goal: Counteract comprehension debt", url: "https://github.com/recallnet/astrochicken/issues/2297" }],
    issues: [{ number: 2364, title: "Issue: Add CLI routing provenance", url: "https://github.com/recallnet/astrochicken/issues/2364" }],
  };
  const narrative = {
    delivery_decision: "slack_and_issue",
    report_body: [
      "# Release reports now favor understanding over changelog noise",
      "",
      "Release reporting now clusters shipped changes into a single conceptual brief.",
      "",
      "## Before",
      "Release understanding required reading merges manually.",
      "",
      "## After",
      "One brief now explains the shift and where to start reading.",
      "",
      "## Shipped Goals",
      "- [#2297 Goal: Counteract comprehension debt](https://github.com/recallnet/astrochicken/issues/2297)",
      "",
      "## Shipped Issues",
      "- [#2364 Issue: Add CLI routing provenance](https://github.com/recallnet/astrochicken/issues/2364)",
    ].join("\n"),
  };

  const body = buildReleaseReportIssueBody({ context, narrative });

  // The narrator's markdown is included directly
  assert.match(body, /^# Release reports now favor understanding over changelog noise/m);
  assert.match(body, /## Before/);
  assert.match(body, /## After/);
  assert.match(body, /## Shipped Goals/);
  assert.match(body, /#2297 Goal: Counteract comprehension debt/);
  assert.match(body, /## Shipped Issues/);
  assert.match(body, /#2364/);
  // Metrics table is appended by publish step (deterministic)
  assert.match(body, /Goals closed/);
  assert.match(body, /Issues closed/);
  // Fingerprint still present for dedup
  assert.match(body, /<!-- release-report-fingerprint:/);
  // No more reconstructed sections — narrator owns the full body
  assert.doesNotMatch(body, /<!-- comprehension-json:/);
});

test("buildReleaseReportIssueBody renders all goals and issues without truncation", () => {
  const goals = Array.from({ length: 10 }, (_, i) => ({
    number: 2400 + i,
    title: `Goal ${i + 1}`,
    url: `https://github.com/recallnet/astrochicken/issues/${2400 + i}`,
  }));
  const issues = Array.from({ length: 18 }, (_, i) => ({
    number: 3000 + i,
    title: `Issue ${i + 1}`,
    url: `https://github.com/recallnet/astrochicken/issues/${3000 + i}`,
  }));
  // Narrator lists all of them in their markdown
  const goalLines = goals.map((g) => `- [#${g.number} ${g.title}](${g.url})`).join("\n");
  const issueLines = issues.map((i) => `- [#${i.number} ${i.title}](${i.url})`).join("\n");
  const narrative = {
    delivery_decision: "slack_and_issue",
    report_body: `# Big release\n\n## Shipped Goals\n${goalLines}\n\n## Shipped Issues\n${issueLines}`,
  };

  const body = buildReleaseReportIssueBody({
    context: {
      factory_id: "mothership",
      generated_at: "2026-03-20T20:31:00Z",
      since_iso: "2026-03-19T20:31:00Z",
      metrics: { goals_closed: 10, issues_closed: 18, commits_landed: 152 },
      goals,
      issues,
    },
    narrative,
  });

  // ALL 10 goals present — no .slice(0, 5) truncation
  for (const goal of goals) {
    assert.match(body, new RegExp(`#${goal.number}`), `goal #${goal.number} should be in body`);
  }
  // ALL 18 issues present
  for (const issue of issues) {
    assert.match(body, new RegExp(`#${issue.number}`), `issue #${issue.number} should be in body`);
  }
});

test("buildReleaseReportIssueTitle uses a stable factory/day identity instead of an exact timestamp", () => {
  const title = buildReleaseReportIssueTitle({
    context: {
      factory_id: "mothership",
      generated_at: "2026-03-17T18:00:00.000Z",
    },
  });

  assert.equal(title, "Release Understanding Report — mothership — 2026-03-17");
});

test("publishReleaseReportIssue updates an existing release report issue when the fingerprint already exists", () => {
  const context = {
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    generated_at: "2026-03-17T18:00:00.000Z",
    since_iso: "2026-03-17T15:00:00.000Z",
    metrics: { goals_closed: 0, issues_closed: 4, commits_landed: 5 },
    goals: [],
  };
  const narrative = {
    delivery_decision: "slack_and_issue",
    headline: "Managed factories now keep release chatter quiet",
    before_state: "Trivial release windows still produced noisy updates.",
    after_state: "The reporter now downshifts weak windows into issue-only briefs.",
    summary: "The release reporter now skips trivial merge trickles and writes fuller briefs, so real conceptual changes get durable narration.",
    conceptual_shift: "Understanding is now the release unit, not merge-level narration.",
    why_it_matters: "The team sees fewer interruptions and better catch-up material.",
    proof_points: ["Issue-heavy windows can still publish without pretending a goal closed."],
    structural_changes: ["Publish flow now expects deterministic significance context in the narrative contract."],
    behavioral_shifts: ["Issue-only windows still include comprehension sections when narrating."],
    implicit_decisions: ["Issue-only delivery remains non-blocking and signal-first."],
    entry_points: ["packages/factory-ops/src/commands/release-publish-report.ts"],
    watch_items: [],
  };
  const ghCalls = [];
  const result = publishReleaseReportIssue({
    repo: "recallnet/astrochicken",
    context,
    narrative,
    ghFn(args) {
      ghCalls.push(args);
      if (args[0] === "label" && args[1] === "create") return successfulCommandResult();
      if (args[0] === "issue" && args[1] === "edit") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/9999\n");
      }
      return successfulCommandResult();
    },
    ghJsonFn(args) {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") {
        return [{
          number: 9999,
          title: "Release Understanding Report — mothership — 2026-03-17",
          url: "https://github.com/recallnet/astrochicken/issues/9999",
          body: "<!-- release-report-fingerprint: mothership:2026-03-17:g-0:i-0:c-5:last- -->",
        }];
      }
      return [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "published");
  assert.equal(result.issue_number, 9999);
  assert.ok(ghCalls.some((args) => args[0] === "label" && args[1] === "create"));
  assert.ok(ghCalls.some((args) => args[0] === "issue" && args[1] === "edit"));
});
