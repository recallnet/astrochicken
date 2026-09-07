import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FACTORY_INSIGHT_SCHEMA_VERSION,
  REQUIRED_FIELDS,
  FACTORY_INSIGHT_EVENTS,
  FACTORY_INSIGHT_EVENT_TYPES,
  FACTORY_INSIGHT_TARGETS,
  normalizeGraphLabel,
  normalizeInsightTarget,
  resolveInsightEventType,
  canonicalEventName,
  classifySemanticEvent,
  listMissingRequiredFields,
  assertRequiredFields,
  normalizeLifecycleEvent,
  normalizeOutcomeEvent,
} from "../../src/lib/factory-insight-contract.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("FACTORY_INSIGHT_SCHEMA_VERSION is factory_insight_event/v1", () => {
    assert.equal(FACTORY_INSIGHT_SCHEMA_VERSION, "factory_insight_event/v1");
  });

  it("REQUIRED_FIELDS is a frozen array with expected entries", () => {
    assert.ok(Object.isFrozen(REQUIRED_FIELDS));
    assert.ok(Array.isArray(REQUIRED_FIELDS));
    assert.ok(REQUIRED_FIELDS.includes("schemaVersion"));
    assert.ok(REQUIRED_FIELDS.includes("eventName"));
    assert.ok(REQUIRED_FIELDS.includes("runId"));
    assert.ok(REQUIRED_FIELDS.includes("goalId"));
    assert.ok(REQUIRED_FIELDS.includes("graphId"));
    assert.ok(REQUIRED_FIELDS.includes("nodeName"));
    assert.ok(REQUIRED_FIELDS.includes("semanticFamily"));
    assert.ok(REQUIRED_FIELDS.includes("semanticTarget"));
    assert.ok(REQUIRED_FIELDS.includes("status"));
    assert.ok(REQUIRED_FIELDS.includes("timestamp"));
    assert.ok(REQUIRED_FIELDS.includes("attempt"));
    assert.ok(REQUIRED_FIELDS.includes("payload"));
  });

  it("FACTORY_INSIGHT_EVENTS is a frozen object with canonical event keys", () => {
    assert.ok(Object.isFrozen(FACTORY_INSIGHT_EVENTS));
    assert.equal(FACTORY_INSIGHT_EVENTS.RUN_START, "run-start");
    assert.equal(FACTORY_INSIGHT_EVENTS.NODE_CHANGE, "node-change");
    assert.equal(FACTORY_INSIGHT_EVENTS.COMPLETE, "complete");
    assert.equal(FACTORY_INSIGHT_EVENTS.FAIL, "fail");
    assert.equal(FACTORY_INSIGHT_EVENTS.MERGE, "merge");
    assert.equal(FACTORY_INSIGHT_EVENTS.ARTIFACT, "artifact");
    assert.equal(FACTORY_INSIGHT_EVENTS.PROGRESS, "progress");
  });

  it("FACTORY_INSIGHT_EVENT_TYPES is a frozen array of event type values", () => {
    assert.ok(Object.isFrozen(FACTORY_INSIGHT_EVENT_TYPES));
    assert.ok(FACTORY_INSIGHT_EVENT_TYPES.includes("run-start"));
    assert.ok(FACTORY_INSIGHT_EVENT_TYPES.includes("complete"));
    assert.ok(FACTORY_INSIGHT_EVENT_TYPES.includes("fail"));
  });

  it("FACTORY_INSIGHT_TARGETS is a frozen array of subscription targets", () => {
    assert.ok(Object.isFrozen(FACTORY_INSIGHT_TARGETS));
    assert.deepEqual(FACTORY_INSIGHT_TARGETS, [
      "next-goal-progress",
      "next-issue",
      "next-review",
      "next-merge",
      "next-release-report",
    ]);
  });
});

// ---------------------------------------------------------------------------
// normalizeGraphLabel
// ---------------------------------------------------------------------------
describe("normalizeGraphLabel", () => {
  it("extracts base name from full path", () => {
    assert.equal(
      normalizeGraphLabel("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"),
      "factory_supervisor_tick",
    );
  });

  it("strips .dot extension from simple filename", () => {
    assert.equal(normalizeGraphLabel("tick.dot"), "tick");
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeGraphLabel(""), "");
  });

  it("returns empty string for undefined input", () => {
    assert.equal(normalizeGraphLabel(), "");
  });

  it("normalizes backslashes to forward slashes", () => {
    assert.equal(
      normalizeGraphLabel("factories\\mothership\\graphs\\tick.dot"),
      "tick",
    );
  });

  it("handles .DOT extension case-insensitively", () => {
    assert.equal(normalizeGraphLabel("tick.DOT"), "tick");
  });

  it("handles name without .dot extension", () => {
    assert.equal(normalizeGraphLabel("some_graph"), "some_graph");
  });

  it("trims whitespace", () => {
    assert.equal(normalizeGraphLabel("  tick.dot  "), "tick");
  });
});

// ---------------------------------------------------------------------------
// normalizeInsightTarget
// ---------------------------------------------------------------------------
describe("normalizeInsightTarget", () => {
  it("returns valid target unchanged", () => {
    assert.equal(normalizeInsightTarget("next-goal-progress"), "next-goal-progress");
  });

  it("lowercases input to match", () => {
    assert.equal(normalizeInsightTarget("NEXT-ISSUE"), "next-issue");
  });

  it("returns empty string for invalid target", () => {
    assert.equal(normalizeInsightTarget("invalid"), "");
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeInsightTarget(""), "");
  });

  it("returns empty string for undefined input", () => {
    assert.equal(normalizeInsightTarget(), "");
  });

  it("trims whitespace before matching", () => {
    assert.equal(normalizeInsightTarget("  next-review  "), "next-review");
  });

  it("accepts all valid targets", () => {
    for (const target of FACTORY_INSIGHT_TARGETS) {
      assert.equal(normalizeInsightTarget(target), target);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveInsightEventType
// ---------------------------------------------------------------------------
describe("resolveInsightEventType", () => {
  it("returns canonical type for known type", () => {
    assert.equal(resolveInsightEventType("run-start"), "run-start");
    assert.equal(resolveInsightEventType("complete"), "complete");
    assert.equal(resolveInsightEventType("fail"), "fail");
    assert.equal(resolveInsightEventType("merge"), "merge");
    assert.equal(resolveInsightEventType("artifact"), "artifact");
    assert.equal(resolveInsightEventType("progress"), "progress");
    assert.equal(resolveInsightEventType("node-change"), "node-change");
  });

  it("resolves alias factory.run.start to run-start", () => {
    assert.equal(resolveInsightEventType("factory.run.start"), "run-start");
  });

  it("resolves alias factory.run.complete to complete", () => {
    assert.equal(resolveInsightEventType("factory.run.complete"), "complete");
  });

  it("resolves alias factory.run.fail to fail", () => {
    assert.equal(resolveInsightEventType("factory.run.fail"), "fail");
  });

  it("resolves alias factory.run.merge to merge", () => {
    assert.equal(resolveInsightEventType("factory.run.merge"), "merge");
  });

  it("resolves alias factory.run.artifact to artifact", () => {
    assert.equal(resolveInsightEventType("factory.run.artifact"), "artifact");
  });

  it("resolves alias factory.progress.heartbeat to progress", () => {
    assert.equal(resolveInsightEventType("factory.progress.heartbeat"), "progress");
  });

  it("resolves alias factory.run.node_change to node-change", () => {
    assert.equal(resolveInsightEventType("factory.run.node_change"), "node-change");
  });

  it("returns empty string for unknown type", () => {
    assert.equal(resolveInsightEventType("bogus"), "");
  });

  it("returns empty string for empty input", () => {
    assert.equal(resolveInsightEventType(""), "");
  });

  it("returns empty string for undefined input", () => {
    assert.equal(resolveInsightEventType(), "");
  });

  it("is case-insensitive", () => {
    assert.equal(resolveInsightEventType("RUN-START"), "run-start");
    assert.equal(resolveInsightEventType("FACTORY.RUN.START"), "run-start");
  });
});

// ---------------------------------------------------------------------------
// canonicalEventName
// ---------------------------------------------------------------------------
describe("canonicalEventName", () => {
  it("maps run-start to factory.run.start", () => {
    assert.equal(canonicalEventName("run-start"), "factory.run.start");
  });

  it("maps node-change to factory.run.node_change", () => {
    assert.equal(canonicalEventName("node-change"), "factory.run.node_change");
  });

  it("maps complete to factory.run.complete", () => {
    assert.equal(canonicalEventName("complete"), "factory.run.complete");
  });

  it("maps fail to factory.run.fail", () => {
    assert.equal(canonicalEventName("fail"), "factory.run.fail");
  });

  it("maps merge to factory.run.merge", () => {
    assert.equal(canonicalEventName("merge"), "factory.run.merge");
  });

  it("maps artifact to factory.run.artifact", () => {
    assert.equal(canonicalEventName("artifact"), "factory.run.artifact");
  });

  it("maps progress to factory.progress.heartbeat", () => {
    assert.equal(canonicalEventName("progress"), "factory.progress.heartbeat");
  });

  it("resolves aliases before mapping", () => {
    assert.equal(canonicalEventName("factory.run.start"), "factory.run.start");
    assert.equal(canonicalEventName("factory.run.fail"), "factory.run.fail");
  });

  it("falls back to telemetry stage.start for (stage, start)", () => {
    assert.equal(canonicalEventName("stage", "start"), "stage.start");
  });

  it("falls back to telemetry stage.finish for (stage, finish)", () => {
    assert.equal(canonicalEventName("stage", "finish"), "stage.finish");
  });

  it("falls back to telemetry stage.error for (stage, error)", () => {
    assert.equal(canonicalEventName("stage", "error"), "stage.error");
  });

  it("falls back to pipeline.heartbeat for (pipeline, heartbeat)", () => {
    assert.equal(canonicalEventName("pipeline", "heartbeat"), "pipeline.heartbeat");
  });

  it("constructs factory.{type}.{subtype} for unknown combos", () => {
    assert.equal(canonicalEventName("custom", "action"), "factory.custom.action");
  });

  it("constructs factory.{type} when no subtype given for unknown type", () => {
    assert.equal(canonicalEventName("custom"), "factory.custom");
  });

  it("returns factory.event.unknown for empty input", () => {
    assert.equal(canonicalEventName(""), "factory.event.unknown");
    assert.equal(canonicalEventName(), "factory.event.unknown");
  });
});

// ---------------------------------------------------------------------------
// classifySemanticEvent
// ---------------------------------------------------------------------------
describe("classifySemanticEvent", () => {
  it("classifies merge event type as merge family", () => {
    const result = classifySemanticEvent({ event: "merge", graph: "some.dot" });
    assert.equal(result.semantic_family, "merge");
    assert.equal(result.semantic_target, "next-merge");
    assert.ok(result.semantic_targets.includes("next-merge"));
    assert.ok(result.semantic_targets.includes("next-goal-progress"));
  });

  it("classifies merge_item graph as merge family", () => {
    const result = classifySemanticEvent({ graph: "merge_item.dot" });
    assert.equal(result.semantic_family, "merge");
    assert.equal(result.semantic_target, "next-merge");
  });

  it("classifies wave_execute with mergeStatus as merge family", () => {
    const result = classifySemanticEvent({ graph: "wave_execute.dot", mergeStatus: "merged" });
    assert.equal(result.semantic_family, "merge");
  });

  it("classifies release_report_flow as release family", () => {
    const result = classifySemanticEvent({ graph: "release_report_flow.dot" });
    assert.equal(result.semantic_family, "release");
    assert.equal(result.semantic_target, "next-release-report");
    assert.deepEqual(result.semantic_targets, ["next-release-report"]);
  });

  it("classifies goal_issue_execute with review node as review family", () => {
    const result = classifySemanticEvent({ graph: "goal_issue_execute.dot", node: "review", event: "node-change" });
    assert.equal(result.semantic_family, "review");
    assert.equal(result.semantic_target, "next-review");
    assert.ok(result.semantic_targets.includes("next-review"));
    assert.ok(result.semantic_targets.includes("next-goal-progress"));
  });

  it("classifies goal_issue_execute review complete as review with next-issue target", () => {
    const result = classifySemanticEvent({ graph: "goal_issue_execute.dot", node: "review", event: "complete" });
    assert.equal(result.semantic_family, "review");
    assert.ok(result.semantic_targets.includes("next-issue"));
  });

  it("classifies goal_issue_execute with review_verdict (non-node-change) as review", () => {
    const result = classifySemanticEvent({ graph: "goal_issue_execute.dot", event: "complete", review_verdict: "approve" });
    assert.equal(result.semantic_family, "review");
  });

  it("classifies wave_issue_execute as issue execution graph", () => {
    const result = classifySemanticEvent({ graph: "wave_issue_execute.dot", event: "complete" });
    assert.equal(result.semantic_family, "issue");
    assert.equal(result.semantic_target, "next-issue");
  });

  it("classifies goal_issue_execute complete without review as issue family", () => {
    const result = classifySemanticEvent({ graph: "goal_issue_execute.dot", event: "complete", node: "build" });
    assert.equal(result.semantic_family, "issue");
    assert.equal(result.semantic_target, "next-issue");
    assert.ok(result.semantic_targets.includes("next-goal-progress"));
  });

  it("classifies goal_execute complete as goal family", () => {
    const result = classifySemanticEvent({ graph: "goal_execute.dot", event: "complete" });
    assert.equal(result.semantic_family, "goal");
    assert.equal(result.semantic_target, "next-goal-progress");
  });

  it("classifies goal_execute fail as goal family", () => {
    const result = classifySemanticEvent({ graph: "goal_execute.dot", event: "fail" });
    assert.equal(result.semantic_family, "goal");
  });

  it("defaults to infra family for unrecognized graph", () => {
    const result = classifySemanticEvent({ graph: "random_graph.dot", event: "run-start" });
    assert.equal(result.semantic_family, "infra");
    assert.equal(result.semantic_target, "");
    assert.deepEqual(result.semantic_targets, []);
  });

  it("defaults to infra for empty event", () => {
    const result = classifySemanticEvent({});
    assert.equal(result.semantic_family, "infra");
  });

  it("includes graph_label in result", () => {
    const result = classifySemanticEvent({ graph: "factories/mothership/graphs/tick.dot" });
    assert.equal(result.graph_label, "tick");
  });
});

// ---------------------------------------------------------------------------
// listMissingRequiredFields
// ---------------------------------------------------------------------------
describe("listMissingRequiredFields", () => {
  it("returns empty array when all required fields present", () => {
    const record = {
      schemaVersion: "v1",
      eventName: "factory.run.start",
      runId: "r1",
      goalId: "g1",
      graphId: "gr1",
      nodeName: "n1",
      semanticFamily: "infra",
      semanticTarget: "next-issue",
      status: "started",
      timestamp: "2026-01-01T00:00:00Z",
      attempt: "1",
      payload: { foo: "bar" },
    };
    assert.deepEqual(listMissingRequiredFields(record), []);
  });

  it("lists missing fields", () => {
    const missing = listMissingRequiredFields({});
    assert.ok(missing.includes("schemaVersion"));
    assert.ok(missing.includes("payload"));
    assert.equal(missing.length, REQUIRED_FIELDS.length);
  });

  it("detects empty string as missing", () => {
    const record = { schemaVersion: "", eventName: "x", runId: "x", goalId: "x", graphId: "x", nodeName: "x", semanticFamily: "x", semanticTarget: "x", status: "x", timestamp: "x", attempt: "x", payload: {} };
    const missing = listMissingRequiredFields(record);
    assert.ok(missing.includes("schemaVersion"));
  });

  it("detects null payload as missing", () => {
    const record = { schemaVersion: "v1", eventName: "e", runId: "r", goalId: "g", graphId: "gr", nodeName: "n", semanticFamily: "f", semanticTarget: "t", status: "s", timestamp: "ts", attempt: "1", payload: null };
    const missing = listMissingRequiredFields(record);
    assert.ok(missing.includes("payload"));
  });

  it("detects array payload as missing", () => {
    const record = { schemaVersion: "v1", eventName: "e", runId: "r", goalId: "g", graphId: "gr", nodeName: "n", semanticFamily: "f", semanticTarget: "t", status: "s", timestamp: "ts", attempt: "1", payload: [] };
    const missing = listMissingRequiredFields(record);
    assert.ok(missing.includes("payload"));
  });

  it("supports custom requiredFields option", () => {
    const missing = listMissingRequiredFields({}, { requiredFields: ["foo", "bar"] });
    assert.deepEqual(missing, ["foo", "bar"]);
  });

  it("returns all required fields for undefined input", () => {
    const missing = listMissingRequiredFields();
    assert.equal(missing.length, REQUIRED_FIELDS.length);
  });
});

// ---------------------------------------------------------------------------
// assertRequiredFields
// ---------------------------------------------------------------------------
describe("assertRequiredFields", () => {
  it("returns record when all required fields present", () => {
    const record = {
      schemaVersion: "v1",
      eventName: "factory.run.start",
      runId: "r1",
      goalId: "g1",
      graphId: "gr1",
      nodeName: "n1",
      semanticFamily: "infra",
      semanticTarget: "next-issue",
      status: "started",
      timestamp: "2026-01-01T00:00:00Z",
      attempt: "1",
      payload: {},
    };
    assert.equal(assertRequiredFields(record), record);
  });

  it("throws when required fields are missing", () => {
    assert.throws(
      () => assertRequiredFields({}),
      { message: /factory insight contract violation: missing required field\(s\)/ },
    );
  });

  it("error message lists specific missing fields", () => {
    try {
      assertRequiredFields({ schemaVersion: "v1" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("eventName"));
      assert.ok(err.message.includes("runId"));
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeLifecycleEvent
// ---------------------------------------------------------------------------
describe("normalizeLifecycleEvent", () => {
  it("normalizes a minimal raw event with fallback defaults", () => {
    const result = normalizeLifecycleEvent(
      { event: "run-start" },
      { state: { runId: "r1", currentNode: "start" } },
    );
    assert.equal(result.schemaVersion, FACTORY_INSIGHT_SCHEMA_VERSION);
    assert.equal(result.event, "run-start");
    assert.equal(result.eventName, "factory.run.start");
    assert.equal(result.runId, "r1");
    assert.equal(result.status, "started");
    assert.equal(result.nodeName, "start");
    assert.ok(result.timestamp);
    assert.ok(typeof result.payload === "object");
  });

  it("defaults eventType to node-change when event is missing", () => {
    const result = normalizeLifecycleEvent(
      {},
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.event, "node-change");
    assert.equal(result.eventName, "factory.run.node_change");
  });

  it("resolves graph from state.pipeline", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", pipeline: "factories/m/graphs/tick.dot" } },
    );
    assert.equal(result.graph_label, "tick");
    assert.ok(result.graph.includes("tick"));
  });

  it("resolves graph from state.pipelineFile", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", pipelineFile: "goal_run.dot" } },
    );
    assert.equal(result.graph_label, "goal_run");
  });

  it("resolves goalId from context.milestone_title", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", context: { milestone_title: "M1" } } },
    );
    assert.equal(result.goalId, "M1");
  });

  it("resolves issue from context.issue_number", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", context: { issue_number: "42" } } },
    );
    assert.equal(result.issue, "42");
  });

  it("uses unknown fallback for missing runId", () => {
    const result = normalizeLifecycleEvent({ event: "run-start" }, { state: {} });
    assert.equal(result.runId, "unknown");
  });

  it("uses explicit status when provided", () => {
    const result = normalizeLifecycleEvent(
      { event: "run-start", status: "custom_status" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.status, "custom_status");
  });

  it("resolves attempt from rawEvent", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete", attempt: "3" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.attempt, "3");
  });

  it("defaults attempt to 1", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.attempt, "1");
  });

  it("populates telemetryEventKind for known types", () => {
    const result = normalizeLifecycleEvent(
      { event: "run-start" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.telemetryEventKind, "stage.start");
  });

  it("includes semantic classification fields", () => {
    const result = normalizeLifecycleEvent(
      { event: "merge", graph: "merge_item.dot" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.semanticFamily, "merge");
    assert.equal(result.semantic_family, "merge");
    assert.equal(result.semanticTarget, "next-merge");
  });

  it("throws when allowFallback is false and fields are empty", () => {
    assert.throws(
      () => normalizeLifecycleEvent({}, { state: {}, allowFallback: false }),
      { message: /factory insight contract violation/ },
    );
  });

  it("resolves event type from alias eventName", () => {
    const result = normalizeLifecycleEvent(
      { eventName: "factory.run.fail" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.event, "fail");
    assert.equal(result.status, "failed");
  });

  it("normalizes payload with review fields", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete", review_verdict: "approve" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.payload.review_verdict, "approve");
  });

  it("normalizes payload with merge_status field", () => {
    const result = normalizeLifecycleEvent(
      { event: "merge", mergeStatus: "merged" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.payload.merge_status, "merged");
  });

  it("strips empty payload values", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    // Empty values should be stripped from payload
    assert.equal(result.payload.review_verdict, undefined);
  });

  it("resolves graph from child pipeline context", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", context: { __child_pipeline_0: "child.dot" } } },
    );
    assert.equal(result.graph_label, "child");
  });
});

// ---------------------------------------------------------------------------
// normalizeOutcomeEvent
// ---------------------------------------------------------------------------
describe("normalizeOutcomeEvent", () => {
  it("includes outcome_event flag in payload", () => {
    const result = normalizeOutcomeEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.payload.outcome_event, "true");
  });

  it("preserves all lifecycle normalization", () => {
    const result = normalizeOutcomeEvent(
      { event: "fail" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.schemaVersion, FACTORY_INSIGHT_SCHEMA_VERSION);
    assert.equal(result.event, "fail");
    assert.equal(result.status, "failed");
    assert.equal(result.eventName, "factory.run.fail");
  });

  it("throws when required fields are missing with allowFallback false", () => {
    assert.throws(
      () => normalizeOutcomeEvent({}, { state: {}, allowFallback: false }),
      { message: /factory insight contract violation/ },
    );
  });

  it("merges outcome_event into existing payload", () => {
    const result = normalizeOutcomeEvent(
      { event: "complete", review_verdict: "approve" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.payload.outcome_event, "true");
    assert.equal(result.payload.review_verdict, "approve");
  });
});

// ---------------------------------------------------------------------------
// normalizeStatus (tested indirectly via normalizeLifecycleEvent)
// ---------------------------------------------------------------------------
describe("normalizeStatus (via normalizeLifecycleEvent)", () => {
  const cases = [
    ["run-start", "started"],
    ["node-change", "in_progress"],
    ["complete", "succeeded"],
    ["fail", "failed"],
    ["merge", "succeeded"],
    ["artifact", "succeeded"],
    ["progress", "heartbeat"],
  ];

  for (const [eventType, expectedStatus] of cases) {
    it(`infers status "${expectedStatus}" for event type "${eventType}"`, () => {
      const result = normalizeLifecycleEvent(
        { event: eventType },
        { state: { runId: "r1", currentNode: "n" } },
      );
      assert.equal(result.status, expectedStatus);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases: delivery/release fields propagation
// ---------------------------------------------------------------------------
describe("delivery fields propagation", () => {
  it("propagates deliveryDecision from rawEvent", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete", delivery_decision: "ship" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.deliveryDecision, "ship");
    assert.equal(result.payload.delivery_decision, "ship");
  });

  it("propagates deliveryDecision from context fallback", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete" },
      { state: { runId: "r1", currentNode: "n", context: { delivery_decision: "hold" } } },
    );
    assert.equal(result.deliveryDecision, "hold");
  });

  it("propagates should_generate_report to payload", () => {
    const result = normalizeLifecycleEvent(
      { event: "complete", should_generate_report: "true" },
      { state: { runId: "r1", currentNode: "n" } },
    );
    assert.equal(result.payload.should_generate_report, "true");
  });
});
