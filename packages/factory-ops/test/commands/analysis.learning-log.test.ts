import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendLearningItem,
  appendLearningMarkdownSection,
  applySuggestionStatusUpdates,
  getPendingSuggestions,
  markSuggestionsAdoptedFromReport,
  readLearningLog,
} from "../../src/lib/analysis/learning-log.ts";

function createFixturePaths() {
  const root = mkdtempSync(join(tmpdir(), "tmp-learning-log-"));
  return {
    root,
    jsonPath: join(root, "reports", "analysis-learnings.json"),
    markdownPath: join(root, "reports", "analysis-learnings.md"),
  };
}

test("appendLearningItem persists entries and rejects duplicate ids", async () => {
  const fixture = createFixturePaths();

  try {
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "cost-reasonableness-check",
      summary: "Track cost deltas against shipped outcomes.",
      type: "suggestion",
    });

    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "next-day-throughput-prediction",
      summary: "Predict improved merge cadence after blocker cleanup.",
      type: "prediction",
    });

    const entries = await readLearningLog({ logPath: fixture.jsonPath });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.id), [
      "cost-reasonableness-check",
      "next-day-throughput-prediction",
    ]);
    assert.equal(entries[0].status, "pending");
    assert.equal(entries[1].status, "pending");

    await assert.rejects(
      () => appendLearningItem({
        logPath: fixture.jsonPath,
        id: "cost-reasonableness-check",
        summary: "duplicate",
      }),
      /learning_log_duplicate_id/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("markSuggestionsAdoptedFromReport adopts matching pending entries and records evidence", async () => {
  const fixture = createFixturePaths();

  try {
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "failure-pattern-scan",
      summary: "Detect hidden churn patterns.",
    });
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "blocker-queue-visibility",
      summary: "Improve blocker queue visibility.",
    });

    const outcome = await markSuggestionsAdoptedFromReport({
      logPath: fixture.jsonPath,
      reportBody: "Validated adoption via marker suggestion:failure-pattern-scan in this report.",
      reportPath: "reports/daily/2026-03-07.md",
      reportDate: "2026-03-07",
      impactNotes: "Hidden failure churn is now explicitly tracked.",
    });

    assert.deepEqual(outcome.adopted_ids, ["failure-pattern-scan"]);

    const entries = await readLearningLog({ logPath: fixture.jsonPath });
    const adopted = entries.find((entry) => entry.id === "failure-pattern-scan");
    const untouched = entries.find((entry) => entry.id === "blocker-queue-visibility");

    assert.equal(adopted?.status, "adopted");
    assert.equal(adopted?.impact_notes, "Hidden failure churn is now explicitly tracked.");
    assert.deepEqual(adopted?.evidence_refs, [
      {
        report_path: "reports/daily/2026-03-07.md",
        report_date: "2026-03-07",
        marker: "suggestion:failure-pattern-scan",
      },
    ]);

    assert.equal(untouched?.status, "pending");
    assert.deepEqual(untouched?.evidence_refs, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("non-matching markers do not alter other entries", async () => {
  const fixture = createFixturePaths();

  try {
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "system-health-audit",
      summary: "Track systemic health gaps.",
    });

    const result = await markSuggestionsAdoptedFromReport({
      logPath: fixture.jsonPath,
      reportBody: "Suggestion:system-health-audit and suggestion:system-health-audit-extra were mentioned.",
      reportPath: "reports/daily/2026-03-08.md",
      reportDate: "2026-03-08",
    });

    assert.deepEqual(result.adopted_ids, []);

    const entries = await readLearningLog({ logPath: fixture.jsonPath });
    assert.equal(entries[0].status, "pending");
    assert.deepEqual(entries[0].evidence_refs, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("getPendingSuggestions returns only pending entries", async () => {
  const fixture = createFixturePaths();

  try {
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "outcome-quality-review",
      summary: "Improve outcome quality checks.",
    });
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "cost-budget-threshold",
      summary: "Add cost threshold alerts.",
    });

    await markSuggestionsAdoptedFromReport({
      logPath: fixture.jsonPath,
      reportBody: "adopted marker suggestion:cost-budget-threshold",
      reportPath: "reports/daily/2026-03-09.md",
      reportDate: "2026-03-09",
    });

    const pending = await getPendingSuggestions({ logPath: fixture.jsonPath });
    assert.deepEqual(pending.map((entry) => entry.id), ["outcome-quality-review"]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("applySuggestionStatusUpdates applies adopted and dismissed updates with merged evidence refs", async () => {
  const fixture = createFixturePaths();

  try {
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "lens-2026-03-21-003",
      summary: "triage pending suggestions",
      evidenceRefs: [{ ref: "initial:evidence" }],
    });
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "sug-2026-03-17-06",
      summary: "legacy langfuse cost suggestion",
    });
    await appendLearningItem({
      logPath: fixture.jsonPath,
      id: "already-adopted",
      summary: "already handled",
      status: "adopted",
    });

    const outcome = await applySuggestionStatusUpdates({
      logPath: fixture.jsonPath,
      updates: [
        {
          id: "lens-2026-03-21-003",
          status: "adopted",
          impactNotes: "Promoted to candidate issue.",
          evidenceRefs: [{ report_issue_number: "2529", action_id: "lens-2026-03-21-003" }],
        },
        {
          id: "sug-2026-03-17-06",
          status: "dismissed",
          impactNotes: "Superseded by lens-2026-03-21-003.",
          evidenceRefs: [{ superseded_by_action_id: "lens-2026-03-21-003" }],
        },
        {
          id: "missing-id",
          status: "dismissed",
        },
        {
          id: "already-adopted",
          status: "dismissed",
        },
      ],
    });

    assert.deepEqual(outcome.applied_ids.sort(), ["lens-2026-03-21-003", "sug-2026-03-17-06"]);
    assert.deepEqual(outcome.missing_ids, ["missing-id"]);
    assert.deepEqual(outcome.skipped_ids, ["already-adopted"]);
    assert.equal(outcome.pending_count, 0);

    const entries = await readLearningLog({ logPath: fixture.jsonPath });
    const adopted = entries.find((entry) => entry.id === "lens-2026-03-21-003");
    const dismissed = entries.find((entry) => entry.id === "sug-2026-03-17-06");

    assert.equal(adopted?.status, "adopted");
    assert.equal(adopted?.impact_notes, "Promoted to candidate issue.");
    assert.deepEqual(adopted?.evidence_refs, [
      { ref: "initial:evidence" },
      { report_issue_number: "2529", action_id: "lens-2026-03-21-003" },
    ]);

    assert.equal(dismissed?.status, "dismissed");
    assert.equal(dismissed?.impact_notes, "Superseded by lens-2026-03-21-003.");
    assert.deepEqual(dismissed?.evidence_refs, [
      { superseded_by_action_id: "lens-2026-03-21-003" },
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("appendLearningMarkdownSection appends dated sections with required headings and is idempotent per date", async () => {
  const fixture = createFixturePaths();

  try {
    const first = await appendLearningMarkdownSection({
      markdownPath: fixture.markdownPath,
      date: "2026-03-10",
      learned: ["Learned that retries hide churn without explicit metrics."],
      questions: ["Which blocker class dominates this week?"],
      skillChanges: ["Added blocker classifier prompts to self-review."],
      predictions: ["suggestion:retry-churn-metric will be adopted tomorrow."],
    });

    assert.equal(first.appended, true);

    const second = await appendLearningMarkdownSection({
      markdownPath: fixture.markdownPath,
      date: "2026-03-10",
      learned: ["This should not create a second dated section."],
      questions: ["Should not appear"],
      skillChanges: ["Should not appear"],
      predictions: ["Should not appear"],
    });

    assert.equal(second.appended, false);

    const markdown = readFileSync(fixture.markdownPath, "utf8");
    const dateHeaders = markdown.match(/^## 2026-03-10$/gm) || [];
    assert.equal(dateHeaders.length, 1);

    assert.match(markdown, /^### What I learned$/m);
    assert.match(markdown, /^### Useful questions$/m);
    assert.match(markdown, /^### Skill changes$/m);
    assert.match(markdown, /^### Predictions to check$/m);
    assert.match(markdown, /retry-churn-metric/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
