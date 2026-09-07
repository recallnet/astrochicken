import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackDefectActionItems,
  FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD,
} from "../../src/lib/fallback-defect-snapshot.ts";

const CANONICAL_RECURRENCE_KEY = "goal_intake_decompose::fallback::decompose_retry_exhausted";

function makeSignal({ runId = "test-run", emittedAtMs = Date.now() } = {}) {
  return {
    schema: "fallback_defect/v1",
    fallback_node: "fallback",
    pipeline: "goal_intake_decompose",
    run_id: runId,
    trigger_reason: "decompose_retry_exhausted",
    contradiction: {},
    classification: "llm_output_empty",
    severity: "medium",
    goal_issue: 1581,
    emitted_at_ms: emittedAtMs,
  };
}

test("fallback defect threshold export is pinned to 2", () => {
  assert.equal(FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD, 2);
});

test("buildFallbackDefectActionItems returns no actions for zero signals", () => {
  const items = buildFallbackDefectActionItems({
    nowMs: Date.parse("2026-03-10T21:00:00.000Z"),
    signals: [],
  });

  assert.deepEqual(items, []);
});

test("decompose_retry_exhausted remains monitor_retry at counts 1 and 2", () => {
  const nowMs = Date.parse("2026-03-10T21:00:00.000Z");

  const items1 = buildFallbackDefectActionItems({
    nowMs,
    signals: [
      makeSignal({ runId: "run-1", emittedAtMs: Date.parse("2026-03-10T20:50:00.000Z") }),
    ],
  });

  assert.equal(items1.length, 1);
  assert.equal(items1[0].diagnostics?.recurrence_key, CANONICAL_RECURRENCE_KEY);
  assert.equal(items1[0].suggested_action, "monitor_retry");
  assert.equal(items1[0].diagnostics?.escalated, false);
  assert.equal(items1[0].diagnostics?.recurrence_24h_count, 1);

  const items2 = buildFallbackDefectActionItems({
    nowMs,
    signals: [
      makeSignal({ runId: "run-1", emittedAtMs: Date.parse("2026-03-10T20:50:00.000Z") }),
      makeSignal({ runId: "run-2", emittedAtMs: Date.parse("2026-03-10T20:40:00.000Z") }),
    ],
  });

  assert.equal(items2.length, 2);
  for (const item of items2) {
    assert.equal(item.diagnostics?.recurrence_key, CANONICAL_RECURRENCE_KEY);
    assert.equal(item.suggested_action, "monitor_retry");
    assert.equal(item.diagnostics?.escalated, false);
    assert.equal(item.diagnostics?.recurrence_24h_count, 2);
  }
});

test("decompose_retry_exhausted escalates above threshold and locks canonical recurrence key", () => {
  const nowMs = Date.parse("2026-03-10T21:00:00.000Z");
  const items = buildFallbackDefectActionItems({
    nowMs,
    signals: [
      makeSignal({ runId: "run-1", emittedAtMs: Date.parse("2026-03-10T20:50:00.000Z") }),
      makeSignal({ runId: "run-2", emittedAtMs: Date.parse("2026-03-10T20:40:00.000Z") }),
      makeSignal({ runId: "run-3", emittedAtMs: Date.parse("2026-03-10T20:30:00.000Z") }),
    ],
  });

  const canonical = items.filter((item) => item.diagnostics?.recurrence_key === CANONICAL_RECURRENCE_KEY);
  assert.equal(canonical.length, 3);

  for (const item of canonical) {
    assert.equal(item.suggested_action, "file_bug");
    assert.equal(item.diagnostics?.escalated, true);
    assert.equal(item.diagnostics?.recurrence_24h_count, 3);
    assert.match(String(item.diagnostics?.escalation_reason || ""), /llm_recurrence_24h>2/);
  }
});
