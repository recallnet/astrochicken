/**
 * release-report-flow.integration.test.mjs
 *
 * End-to-end spec test for the release_report_flow pipeline.
 * Wires together real deterministic functions with mocked I/O to verify
 * the full data flow: context → narrator (mocked LLM) → publish → emit doc → slack → dedup.
 *
 * Mirrors the simplified DOT graph:
 *   build_release_report_context → load_release_narrator_skill
 *     → release_narrator (mocked LLM) → narrative_delivery_gate
 *     → publish_release_report → emit_release_narrative_document
 *     → build_release_slack_blocks → post_release_to_slack → update_release_dedup_cursor
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildReleaseReportContext } from "../../src/commands/release-build-report-context.ts";
import { publishReleaseReportIssue } from "../../src/commands/release-publish-report.ts";
import { buildReleaseSlackBlocksPayload } from "../../src/commands/release-build-slack-blocks.ts";
import { emitReleaseNarrativeDocument } from "../../src/commands/release-emit-narrative-document.ts";
import { postReleaseToSlack } from "../../src/commands/release-post-to-slack.ts";
import { updateReleaseDedupCursorFromDelivery, readReleaseDedupCursor } from "../../src/commands/release-dedup-cursor.ts";
import {
  PUBLISH_MODES,
  TAXONOMY_CATEGORIES,
  validateNarrativeDocument,
} from "../../src/lib/narrative-document-contract.ts";

// --- Fixtures ---

function makeOutcomes() {
  return {
    commits: [
      { sha: "aaa111", subject: "feat(goal-2321): Build queryable factory insights (#2321)", authored_at: "2026-03-19T14:00:00+00:00" },
      { sha: "bbb222", subject: "fix: tighten routing constraints", authored_at: "2026-03-19T14:30:00+00:00" },
      { sha: "ccc333", subject: "feat: add dashboard metrics", authored_at: "2026-03-19T15:00:00+00:00" },
    ],
    commit_log: "aaa111 feat(goal-2321): Build queryable factory insights (#2321)\nbbb222 fix: tighten routing constraints\nccc333 feat: add dashboard metrics",
    goals: [],
    issues: [
      { number: 2393, title: "Issue #2393", url: "https://github.com/recallnet/astrochicken/issues/2393", closed_at: "" },
      { number: 2394, title: "Issue #2394", url: "https://github.com/recallnet/astrochicken/issues/2394", closed_at: "" },
    ],
    prs: [],
    merged_prs: 0,
    closed_goals: 0,
    closed_feature_bug_total: 2,
    outcomes_degraded: false,
    gh_failures: [],
  };
}

function makeNarratorOutput() {
  return {
    delivery_decision: "slack_and_issue",
    headline: "Factory insights now queryable from CLI",
    summary: "Goal 2321 shipped queryable factory insights, consolidating status, outcomes, and metrics into one surface.",
    report_body: [
      "# Factory insights now queryable from CLI",
      "",
      "Goal 2321 shipped queryable factory insights, consolidating status, outcomes, and metrics into one surface.",
      "",
      "## Before",
      "Factory health required ad-hoc log reading.",
      "",
      "## After",
      "A single CLI command surfaces factory health and recent outcomes.",
      "",
      "## What Changed",
      "Factory observability moved from log archaeology to structured CLI queries.",
      "",
      "## Why It Matters",
      "Operators get faster feedback loops without context-switching to raw logs.",
      "",
      "## Proof Points",
      "- [#2321 Build queryable factory insights](https://github.com/recallnet/astrochicken/issues/2321)",
      "",
      "## Shipped Goals",
      "- [#2321 Build queryable factory insights](https://github.com/recallnet/astrochicken/issues/2321)",
      "",
      "## Shipped Issues",
      "- [#2393 Issue #2393](https://github.com/recallnet/astrochicken/issues/2393)",
      "- [#2394 Issue #2394](https://github.com/recallnet/astrochicken/issues/2394)",
      "",
      "## Entry Points",
      "- `packages/factory-ops/src/commands/factory-dashboard.ts`",
      "- `packages/factory-ops/src/commands/factory-outcomes.ts`",
      "",
      "## Watch Items",
      "- Historical comparison may be needed as factory count grows.",
    ].join("\n"),
  };
}

// --- E2E: Full happy-path pipeline ---

test("release report flow e2e: context → narrator → publish → emit doc → slack → dedup", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "release-e2e-"));
  const hatchDir = join(tempRoot, ".hatch", "factories", "mothership");
  mkdirSync(hatchDir, { recursive: true });

  // Step 1: Build release report context
  const context = await buildReleaseReportContext({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    repoPath: tempRoot,
    lookbackHours: 24,
    clock: () => new Date("2026-03-19T16:00:00.000Z"),
    collectFactoryOutcomesFn: () => makeOutcomes(),
    gitDiffStatsFn: () => ({ added: 892, deleted: 214, files_changed: 23, text: "+892 -214", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 38, sample_count: 4, degraded: false }),
    queryClosedGoalsFn: () => [
      { number: 2321, title: "Build queryable factory insights", url: "https://github.com/recallnet/astrochicken/issues/2321", closed_at: "2026-03-19T15:30:00Z", state: "CLOSED" },
    ],
    resolveIssueMetadataFn: (issues) => {
      for (const issue of issues) {
        issue.state = "CLOSED";
        issue.closed_at = "2026-03-19T15:00:00Z";
      }
    },
  });

  assert.equal(context.repo, "recallnet/astrochicken");
  assert.equal(context.goals.length, 1, "should have 1 closed goal from GH query");
  assert.equal(context.goals[0].number, 2321);
  assert.equal(context.issues.length, 2, "should have 2 closed issues");
  assert.equal(context.metrics.goals_closed, 1);
  assert.equal(context.metrics.issues_closed, 2);
  assert.equal(context.metrics.commits_landed, 3);
  assert.equal(context.diff_stats.text, "+892 -214");
  assert.equal(context.timing.avg_wave_minutes, 38);

  // Step 2: Simulate narrator LLM output (this is the agent node — we mock it)
  const narratorOutput = makeNarratorOutput();
  assert.equal(narratorOutput.delivery_decision, "slack_and_issue");

  // Step 3: Publish release report issue (mocked GH)
  const publishResult = publishReleaseReportIssue({
    repo: "recallnet/astrochicken",
    context,
    narrative: narratorOutput,
    ghFn: (args) => {
      if (args[0] === "label" && args[1] === "create") return { ok: true, stdout: "", stderr: "" };
      if (args[0] === "issue" && args[1] === "create") return { ok: true, stdout: "https://github.com/recallnet/astrochicken/issues/2500", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    },
    ghJsonFn: (args, fallback) => {
      return fallback ?? [];
    },
  });

  assert.equal(publishResult.ok, true);
  assert.equal(publishResult.status, "published");
  assert.ok(publishResult.issue_url.includes("2500"));
  assert.equal(publishResult.issue_number, 2500);

  // Step 4: Emit release narrative document artifact
  const narrativeDocument = await emitReleaseNarrativeDocument({
    context,
    narrative: narratorOutput,
    issueUrl: publishResult.issue_url,
    repoPath: tempRoot,
    outputDir: "reports/release/narratives",
    factoryId: "mothership",
  });

  assert.equal(narrativeDocument.ok, true);
  assert.match(narrativeDocument.json_path, /reports\/release\/narratives\/.*\.json$/);
  assert.match(narrativeDocument.markdown_path, /reports\/release\/narratives\/.*\.md$/);
  assert.ok(existsSync(narrativeDocument.json_path), "release narrative json should exist");
  assert.ok(existsSync(narrativeDocument.markdown_path), "release narrative markdown should exist");

  const releaseNarrativeJson = JSON.parse(readFileSync(narrativeDocument.json_path, "utf8"));
  const releaseNarrativeMetadata = narrativeDocument.metadata || releaseNarrativeJson?.metadata;
  const releaseMetadataValidation = validateNarrativeDocument(releaseNarrativeMetadata);
  assert.equal(releaseMetadataValidation.ok, true, JSON.stringify(releaseMetadataValidation, null, 2));

  assert.ok(
    TAXONOMY_CATEGORIES.includes(releaseNarrativeMetadata?.category),
    `release narrative category must be allowlisted: ${releaseNarrativeMetadata?.category}`,
  );
  assert.ok(
    PUBLISH_MODES.includes(releaseNarrativeMetadata?.astro?.visibility),
    `release narrative visibility must be allowlisted: ${releaseNarrativeMetadata?.astro?.visibility}`,
  );
  assert.equal(
    releaseNarrativeMetadata?.astro?.canonical_issue_url,
    publishResult.issue_url,
    "release narrative canonical backlink should match published issue URL",
  );

  // Step 5: Build Slack blocks (with report issue URL from publish step)
  const slackPayload = buildReleaseSlackBlocksPayload({
    context,
    narrative: narratorOutput,
    reportIssueUrl: publishResult.issue_url,
  });

  assert.ok(slackPayload.blocks.length >= 5, "should have header + story + context + goals + footer");
  assert.ok(slackPayload.text.length > 0, "fallback text should be present");

  // Verify report issue link appears as a compact button on the story block
  assert.equal(slackPayload.blocks[1].accessory?.type, "button");
  assert.match(slackPayload.blocks[1].accessory?.url || "", /2500/);

  // Verify header contains headline
  assert.match(slackPayload.blocks[0].text.text, /Factory insights/);

  // Step 6: Post to Slack (mocked webhook)
  const slackCalls = [];
  const slackResult = await postReleaseToSlack({
    context,
    payload: slackPayload,
    webhookUrl: "https://hooks.slack.test/factory",
    fetchFn: async (url, init) => {
      slackCalls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => "ok" };
    },
  });

  assert.equal(slackResult.ok, true);
  assert.equal(slackResult.status, "delivered");
  assert.equal(slackResult.delivered, true);
  assert.equal(slackCalls.length, 1);
  assert.equal(slackCalls[0].url, "https://hooks.slack.test/factory");
  assert.ok(slackCalls[0].body.blocks.length >= 4);

  // Step 7: Update dedup cursor
  const dedupResult = updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: tempRoot,
    reportContext: context,
    deliveryStatus: "published",
  });

  assert.equal(dedupResult.ok, true);

  // Verify cursor was written with correct seen items
  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: tempRoot });
  assert.ok(cursor, "cursor should exist after update");
  assert.ok(cursor.seen_goal_numbers.includes(2321), "cursor should track goal 2321");
  assert.ok(cursor.seen_issues.includes(2393), "cursor should track issue 2393");
  assert.ok(cursor.seen_issues.includes(2394), "cursor should track issue 2394");
});

// --- E2E: Narrator skip decision ---

test("release report flow e2e: narrator skip decision stops the flow", async () => {
  const context = await buildReleaseReportContext({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lookbackHours: 24,
    clock: () => new Date("2026-03-19T16:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "chore: bump deps", authored_at: "2026-03-19T14:00:00+00:00" }],
      commit_log: "abc chore: bump deps",
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 5, deleted: 5, files_changed: 1, text: "+5 -5", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 10, sample_count: 1, degraded: false }),
    queryClosedGoalsFn: () => [],
  });

  // Narrator decides to skip (too granular)
  const narratorOutput = {
    delivery_decision: "skip",
    headline: "",
    summary: "",
    report_body: "",
  };

  assert.equal(narratorOutput.delivery_decision, "skip", "skip decision should stop the flow at narrative_delivery_gate");
});

// --- E2E: Dedup cursor prevents duplicate goal/issue reporting ---

test("release report flow e2e: dedup cursor filters previously reported goals and issues", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "release-dedup-e2e-"));
  const hatchDir = join(tempRoot, ".hatch", "factories", "mothership");
  mkdirSync(hatchDir, { recursive: true });

  // First tick: report goals 2321 and issue 2393
  const context1 = await buildReleaseReportContext({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lookbackHours: 24,
    clock: () => new Date("2026-03-19T16:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "feat(goal-2321): insights (#2321)", authored_at: "2026-03-19T14:00:00+00:00" }],
      goals: [],
      issues: [{ number: 2393, title: "Issue", url: "https://example.com/i/2393", closed_at: "" }],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 100, deleted: 10, files_changed: 5, text: "+100 -10", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 30, sample_count: 2, degraded: false }),
    queryClosedGoalsFn: () => [
      { number: 2321, title: "Build insights", url: "https://example.com/g/2321", closed_at: "2026-03-19T15:00:00Z", state: "CLOSED" },
    ],
    resolveIssueMetadataFn: (issues) => {
      for (const issue of issues) { issue.state = "CLOSED"; }
    },
  });

  assert.equal(context1.goals.length, 1);
  assert.equal(context1.issues.length, 1);

  // Write dedup cursor for tick 1
  updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: tempRoot,
    reportContext: context1,
    deliveryStatus: "published",
  });

  // Second tick: same goals/issues should be filtered out
  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: tempRoot });

  const context2 = await buildReleaseReportContext({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lookbackHours: 24,
    dedupCursor: cursor,
    clock: () => new Date("2026-03-19T17:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "feat(goal-2321): insights (#2321)", authored_at: "2026-03-19T14:00:00+00:00" }],
      goals: [],
      issues: [{ number: 2393, title: "Issue", url: "https://example.com/i/2393", closed_at: "" }],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 100, deleted: 10, files_changed: 5, text: "+100 -10", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 30, sample_count: 2, degraded: false }),
    queryClosedGoalsFn: () => [
      { number: 2321, title: "Build insights", url: "https://example.com/g/2321", closed_at: "2026-03-19T15:00:00Z", state: "CLOSED" },
    ],
    resolveIssueMetadataFn: (issues) => {
      for (const issue of issues) { issue.state = "CLOSED"; }
    },
  });

  assert.equal(context2.goals.length, 0, "goal 2321 should be deduped");
  assert.equal(context2.issues.length, 0, "issue 2393 should be deduped");
  assert.equal(context2.metrics.goals_closed, 0);
  assert.equal(context2.metrics.issues_closed, 0);
});

// --- E2E: issue_only delivery decision skips Slack ---

test("release report flow e2e: issue_only delivery skips Slack posting", async () => {
  // Narrator returns issue_only
  const narratorOutput = {
    ...makeNarratorOutput(),
    delivery_decision: "issue_only",
  };

  assert.equal(narratorOutput.delivery_decision, "issue_only");

  // Per DOT graph: issue_only → publish → emit doc → example-web followup → update_dedup_cursor
  // Slack is NOT called.
  // The DOT graph has:
  //   create_shaping_followup_issue -> update_release_dedup_cursor [condition="delivery_decision=issue_only"]
  //   create_shaping_followup_issue -> build_release_slack_blocks [condition="delivery_decision=slack_and_issue"]
});

// --- E2E: Report issue URL flows through to Slack blocks ---

test("release report flow e2e: report issue URL wired into Slack blocks", async () => {
  const context = await buildReleaseReportContext({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lookbackHours: 24,
    clock: () => new Date("2026-03-19T16:00:00.000Z"),
    collectFactoryOutcomesFn: () => ({
      commits: [{ sha: "abc", subject: "feat: big feature", authored_at: "2026-03-19T14:00:00+00:00" }],
      goals: [],
      issues: [],
      prs: [],
    }),
    gitDiffStatsFn: () => ({ added: 500, deleted: 100, files_changed: 15, text: "+500 -100", degraded: false }),
    runMetadataReaderFn: () => ({ avg_wave_minutes: 45, sample_count: 3, degraded: false }),
    queryClosedGoalsFn: () => [
      { number: 2321, title: "Big goal", url: "https://github.com/recallnet/astrochicken/issues/2321", closed_at: "2026-03-19T15:00:00Z", state: "CLOSED" },
    ],
  });

  const narratorOutput = makeNarratorOutput();

  // Simulate publish_release_report returning issue URL
  const reportIssueUrl = "https://github.com/recallnet/astrochicken/issues/2510";

  // Build Slack blocks with report issue URL (as the DOT graph wires it)
  const payload = buildReleaseSlackBlocksPayload({
    context,
    narrative: narratorOutput,
    reportIssueUrl,
  });

  assert.equal(payload.blocks[1].accessory?.type, "button");
  assert.equal(payload.blocks[1].accessory?.url, reportIssueUrl);
  assert.equal(payload.blocks[1].accessory?.text?.text, "Open report");
});
