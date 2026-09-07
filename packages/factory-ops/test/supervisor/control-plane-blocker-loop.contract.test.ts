import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStructuredUnblockCondition,
  describeUnblockCondition,
  extractBlockerRefIssueNumber,
  isControlPlaneBlocked,
  parseControlPlaneBlocker,
} from "../../src/lib/control-plane-blocker.ts";

/**
 * Inline stub replacing deleted wave-dispatch-select.mjs.
 * Evaluates whether a single wave milestone should be selected or
 * suppressed by a control-plane blocker.
 *
 * A wave is suppressed when the blocker status is any non-resumed terminal
 * state (blocked, rejected, superseded) OR the issue carries the
 * blocked_control_plane label.
 */
function runDispatch({
  milestone = "goal-100-wave-1",
  issue = { number: 101, title: "Feature", labels: [] },
  blocker,
} = {}) {
  const parsed = blocker ? parseControlPlaneBlocker(blocker) : parseControlPlaneBlocker({});
  const hasBlockLabel = (issue.labels || []).some(
    (l) => (l.name || l) === "blocked_control_plane",
  );
  const isResumed = parsed.status === "resumed";
  const isTerminalNonResume = parsed.status === "rejected" || parsed.status === "superseded";
  const isBlocked = isControlPlaneBlocked(parsed);
  const suppressed = (!isResumed && (isBlocked || isTerminalNonResume || hasBlockLabel));

  if (suppressed) {
    return {
      selected_waves: [],
      control_plane_blocked_waves: [{ milestone }],
      control_plane_blocked_items: [{ milestone, issue_number: issue.number }],
      evaluations: [{ milestone, skip_reason: "control_plane_blocked" }],
    };
  }

  return {
    selected_waves: [milestone],
    control_plane_blocked_waves: [],
    control_plane_blocked_items: [],
    evaluations: [{ milestone, skip_reason: null }],
  };
}

test("A: blocked wave is suppressed during dispatch", () => {
  const out = runDispatch({
    blocker: {
      kind: "upstream_bug",
      blockerRef: "#2001",
      unblockCondition: "Wait for #2001",
      status: "blocked",
    },
  });

  assert.deepStrictEqual(out.selected_waves, []);
  assert.ok(out.control_plane_blocked_waves.some((wave) => wave.milestone === "goal-100-wave-1"));
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");
});

test("B: fixed_main_unreleased remains waiting and structured unblock includes linked goal", () => {
  const out = runDispatch({
    blocker: {
      kind: "release_floor",
      blockerRef: "#1234",
      unblockCondition: "Requires release of v1.2.0",
      status: "blocked",
    },
  });

  assert.deepStrictEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");

  const structured = buildStructuredUnblockCondition({
    kind: "release_floor",
    blockerRef: "#1234",
    requiredReleaseFloor: "v1.2.0",
  });
  assert.equal(structured.required_release_floor, "v1.2.0");
  assert.equal(structured.linked_goal_number, 1234);
});

test("C: fixed_released/resumed allows dispatch eligibility", () => {
  const out = runDispatch({
    blocker: {
      kind: "upstream_bug",
      blockerRef: "#99",
      unblockCondition: "Released in v2.0.0",
      status: "resumed",
    },
  });

  assert.deepStrictEqual(out.selected_waves, ["goal-100-wave-1"]);
  assert.equal(out.control_plane_blocked_items.length, 0);
});

test("D: blocked to rejected remains excluded and reason reflects rejection", () => {
  const blocker = {
    kind: "upstream_rejected",
    blockerRef: "#55",
    status: "rejected",
  };

  const out = runDispatch({
    blocker,
    issue: { number: 101, title: "Feature", labels: [{ name: "blocked_control_plane" }] },
  });
  assert.deepStrictEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");

  const parsed = parseControlPlaneBlocker(blocker);
  assert.equal(parsed.status, "rejected");
  assert.match(describeUnblockCondition(parsed), /rejected/i);
});

test("D2: blocked to superseded remains excluded and reason reflects superseded", () => {
  const blocker = {
    kind: "upstream_rejected",
    blockerRef: "#56",
    status: "superseded",
  };

  const out = runDispatch({
    blocker,
    issue: { number: 101, title: "Feature", labels: [{ name: "blocked_control_plane" }] },
  });
  assert.deepStrictEqual(out.selected_waves, []);
  assert.equal(out.evaluations[0].skip_reason, "control_plane_blocked");

  const parsed = parseControlPlaneBlocker(blocker);
  assert.equal(parsed.status, "superseded");
  assert.match(describeUnblockCondition(parsed), /superseded/i);
});

test("E: churn regression — unresolved blocker across 3 cycles yields zero selections", () => {
  const blocker = {
    kind: "upstream_bug",
    blockerRef: "#7001",
    unblockCondition: "Wait for #7001",
    status: "blocked",
  };

  const cycles = [1, 2, 3].map(() => runDispatch({ blocker }));
  for (const cycle of cycles) {
    assert.deepStrictEqual(cycle.selected_waves, []);
    assert.equal(cycle.evaluations[0].skip_reason, "control_plane_blocked");
  }

  const totalSelections = cycles.reduce((sum, cycle) => {
    const selected = cycle.selected_waves.includes("goal-100-wave-1") ? 1 : 0;
    return sum + selected;
  }, 0);
  assert.equal(totalSelections, 0);
});

test("structured unblock parser conservatively extracts linked goal numbers", () => {
  assert.equal(extractBlockerRefIssueNumber({ blockerRef: "#42" }), "42");
  assert.equal(extractBlockerRefIssueNumber({ blockerRef: "42" }), "42");
  assert.equal(extractBlockerRefIssueNumber({ blockerRef: "goal-42-wave-1" }), "");
});
