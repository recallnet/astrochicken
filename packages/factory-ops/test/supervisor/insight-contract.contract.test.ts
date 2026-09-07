import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_INSIGHT_EVENTS,
  normalizeLifecycleEvent,
} from "../../src/lib/factory-insight-contract.ts";
import {
  InsightEventKind,
  InsightEventShape,
  PROJECTION_DIMENSIONS,
  ensureInsightEvent,
  ensureProjectionDimensions,
  listMissingProjectionDimensions,
} from "../../src/lib/insight-contract.ts";
import { FACTORY_STATUS_PROJECTION_DIMENSIONS } from "../../src/commands/factory-status.ts";
import { legacyFixtureFactoryStatus as factoryStatus } from "../../src/lib/factory-status-support.ts";
import {
  FACTORY_TICK_STATUS_PROJECTION_DIMENSIONS,
} from "../../src/commands/factory-tick-status.ts";
import {
  FACTORY_SUBSCRIBE_EVENT_PROJECTION_DIMENSIONS,
} from "../../src/commands/factory-subscribe.ts";
import {
  FACTORY_OUTCOMES_PROJECTION_DIMENSIONS,
  collectFactoryOutcomes,
} from "../../src/commands/factory-outcomes.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";

test("insight contract exposes canonical event kind vocabulary", () => {
  assert.equal(InsightEventKind.RUN_START, "factory.run.start");
  assert.equal(InsightEventKind.RUN_NODE_CHANGE, "factory.run.node_change");
  assert.equal(InsightEventKind.RUN_COMPLETE, "factory.run.complete");
  assert.equal(InsightEventKind.RUN_FAIL, "factory.run.fail");
  assert.equal(InsightEventKind.RUN_MERGE, "factory.run.merge");
  assert.equal(InsightEventKind.RUN_ARTIFACT, "factory.run.artifact");
  assert.equal(InsightEventKind.RUN_PROGRESS_HEARTBEAT, "factory.progress.heartbeat");
});

test("ensureInsightEvent accepts normalized lifecycle events and rejects malformed records", () => {
  const event = normalizeLifecycleEvent({
    event: FACTORY_INSIGHT_EVENTS.NODE_CHANGE,
    runId: "run-123",
    graph: "wave_issue_execute.dot",
    node: "review",
    issue: "2392",
    milestone: "goal-2321-wave-2",
    ts: "2026-03-19T17:00:00.000Z",
  }, {
    state: {
      runId: "run-123",
      pipeline: "wave_issue_execute.dot",
      currentNode: "review",
      context: { milestone_title: "goal-2321-wave-2" },
    },
  });

  assert.doesNotThrow(() => ensureInsightEvent(event));

  const malformed = {
    ...event,
    payload: null,
  };

  assert.throws(
    () => ensureInsightEvent(malformed),
    /factory insight contract violation: missing required field\(s\): payload/,
  );

  assert.deepEqual(InsightEventShape.required_fields, [
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

test("projection dimensions stay aligned across status/tick/subscribe/outcomes surfaces", () => {
  assert.deepEqual(FACTORY_STATUS_PROJECTION_DIMENSIONS, PROJECTION_DIMENSIONS.factory_status);
  assert.deepEqual(FACTORY_TICK_STATUS_PROJECTION_DIMENSIONS, PROJECTION_DIMENSIONS.factory_tick_status);
  assert.deepEqual(FACTORY_SUBSCRIBE_EVENT_PROJECTION_DIMENSIONS, PROJECTION_DIMENSIONS.factory_subscribe_event);
  assert.deepEqual(FACTORY_OUTCOMES_PROJECTION_DIMENSIONS, PROJECTION_DIMENSIONS.factory_outcomes);
});

test("ensureProjectionDimensions reports missing dimensions with surface-specific errors", () => {
  const missingStatus = listMissingProjectionDimensions("factory_status", {});
  assert.ok(missingStatus.includes("context"));
  assert.ok(missingStatus.includes("active"));

  assert.throws(
    () => ensureProjectionDimensions("factory_tick_status", { context: {} }),
    /factory insight projection violation: factory_tick_status missing required dimension\(s\): ticks/,
  );
});

test("status/tick/outcomes command projections satisfy insight dimensions", () => {
  assert.doesNotThrow(() => ensureProjectionDimensions("factory_status", factoryStatus({ runsDir: "/nonexistent" })));
  assert.doesNotThrow(() => ensureProjectionDimensions("factory_tick_status", buildTickProjectionFromStates({ allStates: new Map(), runsDir: "/nonexistent" })));

  const outcomes = collectFactoryOutcomes({
    repo: "acme/test",
    repoPath: ".",
    lookbackHours: 1,
    nowMs: Date.parse("2026-03-19T17:00:00.000Z"),
    spawnSyncFn: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert.doesNotThrow(() => ensureProjectionDimensions("factory_outcomes", outcomes));
});
