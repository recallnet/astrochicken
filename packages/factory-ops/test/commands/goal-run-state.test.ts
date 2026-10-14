import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { GOAL_AWAITING_REVIEW_MARKER, buildAwaitingHumanReviewCommentBody, buildGoalRetryCommentBody, exhaustDecomposeRetries, holdGoalForHumanReview, markGoalDispatched, postGoalRetryComment } from "../../src/commands/goal-run-state.ts";

test("buildGoalRetryCommentBody emits machine-readable retry marker and compact diagnostics", () => {
  const out = buildGoalRetryCommentBody({
    approvedFeatureCount: "2",
    issueCount: "3",
    decomposeApproved: "true",
    decomposeAttempts: "1",
    decomposeParseStatus: "ok",
    decomposeParseSource: "reviewed_features",
  });

  assert.match(out, /<!-- goal-run:decompose-retry -->/);
  assert.match(out, /approved_features=2/);
  assert.match(out, /issues_created=3/);
  assert.match(out, /Keeping ready label for bounded retry on next tick/);
});

test("exhaustDecomposeRetries leaves labels unchanged and posts exhaustion comment", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = exhaustDecomposeRetries({
    repo: "recallnet/astrochicken",
    issueNumber: "123",
    decomposeRetryCount: "3",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "issue");
  assert.equal(calls[0][1], "comment");
  assert.match(calls[0][6], /goal-run:decompose-exhausted/);
  assert.match(calls[0][6], /Leaving labels unchanged/);
});

test("markGoalDispatched keeps goals ready for flattened execution", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = markGoalDispatched({
    repo: "recallnet/astrochicken",
    issueNumber: "55",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.deepEqual(calls[0], [
    "issue", "edit", "55", "--repo", "recallnet/astrochicken", "--add-label", "ready",
  ]);
});

test("markGoalDispatched emits canonical goal_selected event", () => {
  const emitted = [];
  const out = markGoalDispatched({
    repo: "example-org/example-trading",
    issueNumber: "1462",
    factoryId: "example-trading",
    runId: "run-1462",
    ghExec: () => (successfulCommandResult()),
    emitDomainEventFn: (event) => emitted.push(event),
  });

  assert.equal(out.ok, true);
  assert.equal(out.canonical_events.length, 1);
  assert.equal(emitted[0].event_family, "factory.goal.selected");
  assert.equal(emitted[0].payload.goal_issue_number, "1462");
  assert.equal(emitted[0].payload.selected_for, "dispatch");
});

test("markGoalDispatched forwards github projection receipt events through the adapter boundary", () => {
  const emitted = [];

  const out = markGoalDispatched({
    repo: "example-org/example-trading",
    issueNumber: "1462",
    factoryId: "example-trading",
    runId: "run-1462",
    ghExec: () => (successfulCommandResult()),
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  assert.equal(out.ok, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, "github.projection.receipt");
  assert.equal(emitted[0].payload.operation, "issue_edit");
  assert.equal(emitted[0].payload.issue_number, "1462");
  assert.deepEqual(emitted[0].payload.add_labels, ["ready"]);
});

test("buildAwaitingHumanReviewCommentBody emits deterministic marker and resume instructions", () => {
  const body = buildAwaitingHumanReviewCommentBody({
    goalNumber: "2200",
    packetId: "plan-1",
    packetPath: ".hatch/mothership/packets/goal_hard_plan_packet/plan-1.json",
    artifactCount: "2",
  });

  assert.match(body, new RegExp(GOAL_AWAITING_REVIEW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(body, /goal_number=2200/);
  assert.match(body, /packet_id=plan-1/);
  assert.match(body, /review_state=awaiting_human/);
  assert.match(body, /re-add the ready label to resume execution without re-planning/);
});

test("holdGoalForHumanReview removes ready, adds awaiting-human, and posts review marker comment", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = holdGoalForHumanReview({
    repo: "recallnet/astrochicken",
    issueNumber: "2200",
    packetId: "plan-1",
    packetPath: ".hatch/mothership/packets/goal_hard_plan_packet/plan-1.json",
    artifactCount: "2",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.ensure_status, 0);
  assert.deepEqual(calls[0], [
    "label", "create", "awaiting-human", "--repo", "recallnet/astrochicken",
    "--description", "auto-created", "--color", "ededed", "--force",
  ]);
  assert.deepEqual(calls[1], [
    "issue", "edit", "2200", "--repo", "recallnet/astrochicken",
    "--add-label", "awaiting-human",
    "--remove-label", "ready",
  ]);
  assert.equal(calls[2][0], "issue");
  assert.equal(calls[2][1], "comment");
  assert.match(calls[2][6], /goal-run:awaiting-review/);
  assert.match(calls[2][6], /re-add the ready label to resume execution without re-planning/);
  assert.equal(out.comment_marker, GOAL_AWAITING_REVIEW_MARKER);
});

test("holdGoalForHumanReview routes outbound mutations through the github adapter boundary", () => {
  const emitted = [];
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = holdGoalForHumanReview({
    repo: "example-org/example-trading",
    issueNumber: "2200",
    packetId: "plan-1",
    packetPath: ".hatch/example-trading/packets/goal_hard_plan_packet/plan-1.json",
    artifactCount: "2",
    ghExec,
    factoryId: "example-trading",
    runId: "run-2200",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    emitted.map((event) => [event.event_family, event.payload.operation, event.payload.ok]),
    [
      ["github.projection.receipt", "label_create", true],
      ["github.projection.receipt", "issue_edit", true],
      ["github.projection.receipt", "issue_comment", true],
    ],
  );
  assert.equal(emitted[1].payload.issue_number, "2200");
  assert.deepEqual(emitted[1].payload.add_labels, ["awaiting-human"]);
  assert.deepEqual(emitted[1].payload.remove_labels, ["ready"]);
});

test("holdGoalForHumanReview fails closed when awaiting-human label ensure fails", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "label" && args[1] === "create") {
      return { ok: false, status: 1, stdout: "", stderr: "boom" };
    }
    return successfulCommandResult();
  };

  const out = holdGoalForHumanReview({
    repo: "recallnet/astrochicken",
    issueNumber: "2200",
    ghExec,
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "awaiting_human_label_ensure_failed");
  assert.equal(out.ensure_status, 1);
  assert.equal(calls.length, 1, "label/comment mutation must not run when ensure fails");
  assert.deepEqual(calls[0], [
    "label", "create", "awaiting-human", "--repo", "recallnet/astrochicken",
    "--description", "auto-created", "--color", "ededed", "--force",
  ]);
});

test("postGoalRetryComment posts compact retry comment", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = postGoalRetryComment({
    repo: "recallnet/astrochicken",
    issueNumber: "77",
    approvedFeatureCount: "1",
    issueCount: "0",
    decomposeApproved: "false",
    decomposeAttempts: "2",
    decomposeParseStatus: "parse_failed",
    decomposeParseSource: "proposal",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "issue");
  assert.match(calls[0][6], /goal-run:decompose-retry/);
  assert.match(out.body, /decompose_parse_status=parse_failed/);
});
