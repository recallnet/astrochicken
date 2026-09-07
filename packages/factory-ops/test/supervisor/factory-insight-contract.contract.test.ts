import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_INSIGHT_EVENTS,
  FACTORY_INSIGHT_SCHEMA_VERSION,
  REQUIRED_FIELDS,
  assertRequiredFields,
  canonicalEventName,
  classifySemanticEvent,
  normalizeLifecycleEvent,
  normalizeOutcomeEvent,
} from "../../src/lib/factory-insight-contract.ts";

test("factory insight contract exports stable schema version and required fields", () => {
  assert.equal(FACTORY_INSIGHT_SCHEMA_VERSION, "factory_insight_event/v1");
  assert.deepEqual(REQUIRED_FIELDS, [
    "schemaVersion",
    "eventName",
    "runId",
    "goalId",
    "graphId",
    "nodeName",
    "semanticFamily",
    "semanticTarget",
    "status",
    "timestamp",
    "attempt",
    "payload",
  ]);
});

test("canonicalEventName resolves each canonical event type", () => {
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.RUN_START), "factory.run.start");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.NODE_CHANGE), "factory.run.node_change");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.COMPLETE), "factory.run.complete");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.FAIL), "factory.run.fail");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.MERGE), "factory.run.merge");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.ARTIFACT), "factory.run.artifact");
  assert.equal(canonicalEventName(FACTORY_INSIGHT_EVENTS.PROGRESS), "factory.progress.heartbeat");

  // Telemetry vocabulary compatibility fallback.
  assert.equal(canonicalEventName("stage", "start"), "stage.start");
  assert.equal(canonicalEventName("stage", "finish"), "stage.finish");
  assert.equal(canonicalEventName("stage", "error"), "stage.error");
  assert.equal(canonicalEventName("pipeline", "heartbeat"), "pipeline.heartbeat");
});

test("normalizeLifecycleEvent emits contract-compliant records with deterministic fallbacks", () => {
  const state = {
    runId: "run-123",
    pipeline: "wave_issue_execute.dot",
    currentNode: "review",
    context: {
      issue_number: "2390",
      milestone_title: "goal-2321-wave-2",
      review_verdict: "approve",
      review_failed: "false",
      review_attempt: "2",
    },
  };

  const record = normalizeLifecycleEvent({
    event: FACTORY_INSIGHT_EVENTS.NODE_CHANGE,
    prevNode: "build",
    ts: "2026-03-19T16:00:00.000Z",
  }, { state });

  assert.equal(record.schemaVersion, FACTORY_INSIGHT_SCHEMA_VERSION);
  assert.equal(record.event, FACTORY_INSIGHT_EVENTS.NODE_CHANGE);
  assert.equal(record.eventName, "factory.run.node_change");
  assert.equal(record.runId, "run-123");
  assert.equal(record.goalId, "goal-2321-wave-2");
  assert.equal(record.graphId, "wave_issue_execute");
  assert.equal(record.nodeName, "review");
  assert.equal(record.semanticFamily, "review");
  assert.equal(record.semanticTarget, "next-review");
  assert.equal(record.status, "in_progress");
  assert.equal(record.timestamp, "2026-03-19T16:00:00.000Z");
  assert.equal(record.attempt, "2");
  assert.equal(typeof record.payload, "object");
  assert.equal(record.payload.review_verdict, "approve");

  assert.doesNotThrow(() => assertRequiredFields(record));
});

test("normalizeOutcomeEvent emits contract-compliant outcome records", () => {
  const state = {
    runId: "run-merge-1",
    pipeline: "wave_execute.dot",
    currentNode: "set_wave_merged",
    context: {
      merged_count: "3",
      failed_count: "1",
      merge_status: "merged",
      milestone_title: "goal-2321-wave-3",
      issue_number: "2390",
    },
  };

  const record = normalizeOutcomeEvent({
    event: FACTORY_INSIGHT_EVENTS.COMPLETE,
    ts: "2026-03-19T16:10:00.000Z",
    merged_count: "3",
    failed_count: "1",
    merge_status: "merged",
  }, { state });

  assert.equal(record.eventName, "factory.run.complete");
  assert.equal(record.semanticFamily, "merge");
  assert.equal(record.semanticTarget, "next-merge");
  assert.equal(record.status, "succeeded");
  assert.equal(record.payload.outcome_event, "true");
  assert.equal(record.payload.merge_status, "merged");
  assert.doesNotThrow(() => assertRequiredFields(record));
});

test("classifySemanticEvent preserves semantic family + targets used by subscriptions", () => {
  const review = classifySemanticEvent({
    event: FACTORY_INSIGHT_EVENTS.NODE_CHANGE,
    graph: "goal_issue_execute",
    node: "review",
  });
  assert.equal(review.semantic_family, "review");
  assert.deepEqual(review.semantic_targets, ["next-review", "next-goal-progress"]);

  const merge = classifySemanticEvent({
    event: FACTORY_INSIGHT_EVENTS.MERGE,
    graph: "merge_item",
    mergeStatus: "completed",
  });
  assert.equal(merge.semantic_family, "merge");
  assert.deepEqual(merge.semantic_targets, ["next-merge", "next-goal-progress"]);
});

test("assertRequiredFields throws descriptive error when required field is missing", () => {
  const record = normalizeLifecycleEvent({
    event: FACTORY_INSIGHT_EVENTS.RUN_START,
    runId: "run-abc",
    graph: "goal_execute",
    node: "start",
    issue: "2390",
    milestone: "goal-2321",
  }, { state: {} });

  const broken = {
    ...record,
    runId: "",
  };

  assert.throws(
    () => assertRequiredFields(broken),
    /factory insight contract violation: missing required field\(s\): runId/,
  );
});
