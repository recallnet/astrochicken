import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackDefectActionItems,
  FORCE_MERGE_ESCALATE_THRESHOLD,
} from "../../src/lib/fallback-defect-snapshot.ts";

test("buildFallbackDefectActionItems carries recurrence_key into evidence for stable bug dedupe", () => {
  const items = buildFallbackDefectActionItems({
    nowMs: Date.parse("2026-03-10T19:00:00.000Z"),
    signals: [
      {
        schema: "fallback_defect/v1",
        fallback_node: "normalize_features",
        pipeline: "goal_intake_decompose",
        run_id: "run-a",
        trigger_reason: "feature_count_zero_after_normalize",
        contradiction: {
          approved: true,
          decompose_parse_status: "valid_json",
          pre_normalize_feature_count: 3,
          post_normalize_feature_count: 0,
          issues_created: 0,
        },
        classification: "pipeline_transport_defect",
        severity: "high",
        goal_issue: 1613,
        emitted_at: "2026-03-10T18:52:00.000Z",
        emitted_at_ms: Date.parse("2026-03-10T18:52:00.000Z"),
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(
    items[0].evidence?.recurrence_key,
    "goal_intake_decompose::normalize_features::feature_count_zero_after_normalize",
  );
});

test("FORCE_MERGE_ESCALATE_THRESHOLD stays pinned at 3", () => {
  assert.equal(FORCE_MERGE_ESCALATE_THRESHOLD, 3);
});

test("buildFallbackDefectActionItems keeps low-rate review_retry_exhausted_force_merge as monitor-only telemetry", () => {
  const items = buildFallbackDefectActionItems({
    nowMs: Date.parse("2026-03-10T21:00:00.000Z"),
    signals: [
      {
        schema: "fallback_defect/v1",
        fallback_node: "report_approved",
        pipeline: "wave_issue_execute",
        run_id: "run-review-low",
        trigger_reason: "review_retry_exhausted_force_merge",
        contradiction: {},
        classification: "contract_violation",
        severity: "high",
        goal_issue: 1565,
        emitted_at: "2026-03-10T20:59:00.000Z",
        emitted_at_ms: Date.parse("2026-03-10T20:59:00.000Z"),
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].diagnostics?.recurrence_24h_count, 1);
  assert.equal(items[0].suggested_action, "log_and_monitor");
  assert.equal(items[0].diagnostics?.escalated, false);
  assert.equal(items[0].diagnostics?.escalation_reason, "force_merge_degraded_mode_expected");
});

test("buildFallbackDefectActionItems escalates high-rate review_retry_exhausted_force_merge to file_bug", () => {
  const nowMs = Date.parse("2026-03-10T21:00:00.000Z");
  const signals = Array.from({ length: 10 }, (_, index) => ({
    schema: "fallback_defect/v1",
    fallback_node: "report_approved",
    pipeline: "wave_issue_execute",
    run_id: `run-review-high-${index + 1}`,
    trigger_reason: "review_retry_exhausted_force_merge",
    contradiction: {},
    classification: "contract_violation",
    severity: "high",
    goal_issue: 1565,
    emitted_at: "2026-03-10T20:59:00.000Z",
    emitted_at_ms: Date.parse("2026-03-10T20:59:00.000Z"),
  }));

  const items = buildFallbackDefectActionItems({ nowMs, signals });

  assert.equal(items.length, 10);
  for (const item of items) {
    assert.equal(item.diagnostics?.recurrence_24h_count, 10);
    assert.equal(item.suggested_action, "file_bug");
    assert.equal(item.diagnostics?.escalated, true);
    assert.equal(item.diagnostics?.escalation_reason, "force_merge_rate_exceeds_threshold");
  }
});

test("buildFallbackDefectActionItems escalates decompose_retry_exhausted recurrence above 24h threshold", () => {
  const nowMs = Date.parse("2026-03-10T21:00:00.000Z");
  const signals = [
    {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "run-1",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {},
      classification: "llm_output_malformed",
      severity: "medium",
      goal_issue: 1581,
      emitted_at: "2026-03-10T20:50:00.000Z",
      emitted_at_ms: Date.parse("2026-03-10T20:50:00.000Z"),
    },
    {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "run-2",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {},
      classification: "llm_output_malformed",
      severity: "medium",
      goal_issue: 1581,
      emitted_at: "2026-03-10T20:40:00.000Z",
      emitted_at_ms: Date.parse("2026-03-10T20:40:00.000Z"),
    },
    {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "run-3",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {},
      classification: "llm_output_malformed",
      severity: "medium",
      goal_issue: 1581,
      emitted_at: "2026-03-10T20:30:00.000Z",
      emitted_at_ms: Date.parse("2026-03-10T20:30:00.000Z"),
    },
  ];

  const items = buildFallbackDefectActionItems({ nowMs, signals });

  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.evidence?.recurrence_key, "goal_intake_decompose::fallback::decompose_retry_exhausted");
    assert.equal(item.diagnostics?.recurrence_24h_count, 3);
    assert.equal(item.diagnostics?.escalated, true);
    assert.match(String(item.diagnostics?.escalation_reason || ""), /llm_recurrence_24h>2/);
  }
});

test("buildFallbackDefectActionItems suppresses recurrence items when all signals predate the latest closed bug", () => {
  const nowMs = Date.parse("2026-03-11T07:30:00.000Z");
  const signals = [
    {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "run-1",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {},
      classification: "llm_output_empty",
      severity: "medium",
      goal_issue: 1561,
      emitted_at: "2026-03-11T05:12:06.000Z",
      emitted_at_ms: Date.parse("2026-03-11T05:12:06.000Z"),
    },
    {
      schema: "fallback_defect/v1",
      fallback_node: "fallback",
      pipeline: "goal_intake_decompose",
      run_id: "run-2",
      trigger_reason: "decompose_retry_exhausted",
      contradiction: {},
      classification: "contract_violation",
      severity: "high",
      goal_issue: 1569,
      emitted_at: "2026-03-11T05:41:41.000Z",
      emitted_at_ms: Date.parse("2026-03-11T05:41:41.000Z"),
    },
  ];

  const items = buildFallbackDefectActionItems({
    nowMs,
    signals,
    closedBugHistory: [
      {
        recurrence_key: "goal_intake_decompose::fallback::decompose_retry_exhausted",
        closed_at: "2026-03-11T05:56:29.000Z",
      },
    ],
  });

  assert.equal(items.length, 0);
});

test("buildFallbackDefectActionItems keeps recurrence items when a newer signal arrives after the latest closed bug", () => {
  const nowMs = Date.parse("2026-03-11T07:30:00.000Z");
  const items = buildFallbackDefectActionItems({
    nowMs,
    signals: [
      {
        schema: "fallback_defect/v1",
        fallback_node: "fallback",
        pipeline: "goal_intake_decompose",
        run_id: "run-post-close",
        trigger_reason: "decompose_retry_exhausted",
        contradiction: {},
        classification: "llm_output_empty",
        severity: "medium",
        goal_issue: 1561,
        emitted_at: "2026-03-11T06:05:00.000Z",
        emitted_at_ms: Date.parse("2026-03-11T06:05:00.000Z"),
      },
    ],
    closedBugHistory: [
      {
        recurrence_key: "goal_intake_decompose::fallback::decompose_retry_exhausted",
        closed_at: "2026-03-11T05:56:29.000Z",
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].evidence?.recurrence_key, "goal_intake_decompose::fallback::decompose_retry_exhausted");
});
