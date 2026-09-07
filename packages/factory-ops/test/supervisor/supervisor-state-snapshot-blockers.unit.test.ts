import assert from "node:assert/strict";
import test from "node:test";

import { buildControlPlaneBlockerActionItems } from "../../src/commands/supervisor-blocker-review.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(number, title, labels = [], milestone = "") {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    milestone: milestone ? { title: milestone } : null,
    createdAt: "2026-03-01T00:00:00Z",
    url: `https://github.com/test/repo/issues/${number}`,
  };
}

function blockerComment(payload = {}) {
  const json = JSON.stringify({
    kind: payload.kind || "upstream_bug",
    blockerRef: payload.blockerRef ?? "",
    unblockCondition: payload.unblockCondition ?? "",
    status: payload.status || "blocked",
  });
  return { body: `control_plane_blocker.v1:${json}` };
}

function makeGhStub(commentsByIssue = {}) {
  return (args) => {
    const cmd = Array.isArray(args) ? args.join(" ") : "";
    const match = cmd.match(/issues\/(\d+)\/comments/);
    if (match) {
      const issueNumber = Number(match[1]);
      return commentsByIssue[issueNumber] || [];
    }
    return [];
  };
}

// ---------------------------------------------------------------------------
// B1: Valid blocker with all fields → action item with correct diagnostics
// ---------------------------------------------------------------------------
test("B1: feature with blocked-control-plane label + valid blocker → action item emitted", () => {
  const features = [
    makeFeature(200, "Add auth endpoint", ["feature", "blocked-control-plane"], "goal-10-wave-1"),
  ];
  const comments = {
    200: [blockerComment({
      kind: "upstream_bug",
      blockerRef: "#999",
      unblockCondition: "Issue #999 is closed",
      status: "blocked",
    })],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 1);
  const item = result.actionItems[0];
  assert.ok(item.problem.includes("CONTROL_PLANE_BLOCKER_ACTIVE"));
  assert.ok(item.problem.includes("#200"));
  assert.equal(item.diagnostics.blocker_kind, "upstream_bug");
  assert.equal(item.diagnostics.blockerRef, "#999");
  assert.equal(item.diagnostics.unblockCondition, "Issue #999 is closed");
  assert.equal(item.diagnostics.milestone, "goal-10-wave-1");
  assert.equal(item.remediation_packet.packet_type, "control_plane_blocker_review");

  assert.equal(result.summary.length, 1);
  assert.equal(result.summary[0].issue_number, 200);
});

// ---------------------------------------------------------------------------
// B2: Feature with blocked-control-plane label + empty blocker comment →
//     action item still emitted (surfaces invalid blocker for review)
// ---------------------------------------------------------------------------
test("B2: blocked-control-plane label + empty blocker comment → action item with empty unblockCondition", () => {
  const features = [
    makeFeature(201, "Fix rate limiter", ["feature", "blocked-control-plane"], "goal-10-wave-1"),
  ];
  // No blocker comment — just the label
  const comments = { 201: [] };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 1);
  const item = result.actionItems[0];
  assert.ok(item.problem.includes("CONTROL_PLANE_BLOCKER_ACTIVE"));
  assert.equal(item.diagnostics.unblockCondition, "");
  assert.equal(item.diagnostics.invalid_unblock_condition, true);
});

// ---------------------------------------------------------------------------
// B3: Feature with blocked-control-plane label + status "resumed" →
//     already resolved, NO action item
// ---------------------------------------------------------------------------
test("B3: blocked-control-plane label + status=resumed → no action item", () => {
  const features = [
    makeFeature(202, "Update schema", ["feature", "blocked-control-plane"], "goal-10-wave-1"),
  ];
  const comments = {
    202: [
      blockerComment({ status: "blocked", kind: "upstream_bug", blockerRef: "#888" }),
      blockerComment({ status: "resumed", kind: "upstream_bug", blockerRef: "#888" }),
    ],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 0);
  assert.equal(result.summary.length, 0);
});

// ---------------------------------------------------------------------------
// B4: No features with blocked-control-plane label → empty results
// ---------------------------------------------------------------------------
test("B4: no blocked-control-plane features → empty action items and summary", () => {
  const features = [
    makeFeature(203, "Add logging", ["feature"], "goal-10-wave-1"),
    makeFeature(204, "Add metrics", ["feature", "quarantined"], "goal-10-wave-1"),
  ];

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub({}),
  });

  assert.equal(result.actionItems.length, 0);
  assert.equal(result.summary.length, 0);
});

// ---------------------------------------------------------------------------
// B5: Feature with blocker but no unblockCondition → invalid flag set
// ---------------------------------------------------------------------------
test("B5: blocker with kind + blockerRef but no unblockCondition → invalid_unblock_condition true", () => {
  const features = [
    makeFeature(205, "Migrate DB", ["feature", "blocked-control-plane"], "goal-11-wave-2"),
  ];
  const comments = {
    205: [blockerComment({
      kind: "release_floor",
      blockerRef: "v2.3.0",
      unblockCondition: "",
      status: "blocked",
    })],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 1);
  const item = result.actionItems[0];
  assert.equal(item.diagnostics.invalid_unblock_condition, true);
  assert.equal(item.diagnostics.blocker_kind, "release_floor");
  assert.equal(item.diagnostics.blockerRef, "v2.3.0");
});

// ---------------------------------------------------------------------------
// B6: Empty unblockCondition → ownership_decision is "local_fix"
//     (supervisor should auto-resume invalid blockers)
// ---------------------------------------------------------------------------
test("B6: empty unblockCondition → ownership_decision local_fix for auto-resume", () => {
  const features = [
    makeFeature(206, "Add cache", ["feature", "blocked-control-plane"], "goal-12-wave-1"),
  ];
  const comments = {
    206: [blockerComment({
      kind: "upstream_bug",
      blockerRef: "",
      unblockCondition: "",
      status: "blocked",
    })],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 1);
  const item = result.actionItems[0];
  assert.equal(item.ownership_decision, "local_fix");
  assert.ok(item.ownership_reason.includes("invalid") || item.ownership_reason.includes("no concrete"));
});

// ---------------------------------------------------------------------------
// B7: blockerRef "#999" → inspection commands include gh issue view 999
// ---------------------------------------------------------------------------
test("B7: blockerRef with issue number → inspection commands include ref issue check", () => {
  const features = [
    makeFeature(207, "Fix parser", ["feature", "blocked-control-plane"], "goal-13-wave-1"),
  ];
  const comments = {
    207: [blockerComment({
      kind: "upstream_bug",
      blockerRef: "#999",
      unblockCondition: "Issue #999 is closed",
      status: "blocked",
    })],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 1);
  const packet = result.actionItems[0].remediation_packet;
  const inspectCmds = packet.inspection_commands.join(" ");
  assert.ok(inspectCmds.includes("issue view 999"), "Should include inspection of blocker ref issue");
});

// ---------------------------------------------------------------------------
// B8: status "resumed" already → filtered out (same as B3 but single comment)
// ---------------------------------------------------------------------------
test("B8: single resumed comment → no action item", () => {
  const features = [
    makeFeature(208, "Update API", ["feature", "blocked-control-plane"], "goal-14-wave-1"),
  ];
  const comments = {
    208: [blockerComment({
      status: "resumed",
      kind: "upstream_bug",
      blockerRef: "#777",
      unblockCondition: "Resolved by supervisor",
    })],
  };

  const result = buildControlPlaneBlockerActionItems({
    features,
    repo: "test/repo",
    ghJsonFn: makeGhStub(comments),
  });

  assert.equal(result.actionItems.length, 0);
  assert.equal(result.summary.length, 0);
});
