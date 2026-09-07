/**
 * Control-plane blocker tests — wave execution ignores blockers
 *
 * Production incident (2026-03-10): control-plane blocker on #1616
 * prevented wave-3 from completing despite the feature being triaged
 * into the wave. Root cause: computeNextMilestoneIssue was checking
 * control-plane blockers during wave execution.
 *
 * Design fix: Wave execution does NOT check blockers. Triage already
 * ordered features into waves — once a wave is executing, every feature
 * in it is processable. Control-plane blockers and blocked-by
 * relationships are dispatch/triage concerns, not execution-time
 * concerns.
 *
 * These tests verify that control-plane blocker state (blocked, resumed,
 * stale, missing blockerRef) has ZERO effect on computeNextMilestoneIssue.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { computeNextMilestoneIssue } from "../src/commands/milestone-next-issue.ts";
import {
  parseControlPlaneBlocker,
} from "../src/lib/control-plane-blocker.ts";

// ── Helper: build a getControlPlaneBlocker that simulates comment-based blocker ──

function buildControlPlaneBlockerLoader(blockerMap) {
  return (issue) => {
    const num = Number(issue?.number || 0);
    if (blockerMap.has(num)) return blockerMap.get(num);
    return parseControlPlaneBlocker(issue || {});
  };
}

// ─── T1: Stale control-plane blocker — processable during wave execution ─────

test("wave execution: stale control-plane blocker (blockerRef points to CLOSED upstream) — processable", () => {
  const issues = [
    { number: 1618, title: "Feature: implement auth flow", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(1618, parseControlPlaneBlocker({
    comments: [{
      body: `control_plane_blocker.v1:${JSON.stringify({
        status: "blocked",
        kind: "upstream_bug",
        blockerRef: "#1620",
      })}`,
    }],
  }));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-1555-wave-2",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: (n) => (n === 1618
      ? [{ number: 1620, state: "CLOSED", milestone: { title: "goal-1555-wave-1" } }]
      : []),
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true, "Wave execution ignores control-plane blockers");
  assert.equal(result.next_issue_number, "1618");
  assert.equal(result.blocked_count, 0);
});

// ─── T2: Active control-plane blocker with OPEN upstream — still processable ──

test("wave execution: active control-plane blocker (blockerRef points to OPEN upstream) — processable", () => {
  const issues = [
    { number: 200, title: "Feature: payment integration", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(200, parseControlPlaneBlocker({
    comments: [{
      body: `control_plane_blocker.v1:${JSON.stringify({
        status: "blocked",
        kind: "upstream_bug",
        blockerRef: "#190",
      })}`,
    }],
  }));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-50-wave-2",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: (n) => (n === 200
      ? [{ number: 190, state: "OPEN", milestone: { title: "goal-50-wave-1" } }]
      : []),
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true, "Wave execution ignores control-plane blockers — even active ones");
  assert.equal(result.next_issue_number, "200");
  assert.equal(result.blocked_count, 0);
});

// ─── T3: Control-plane blocker WITHOUT blockerRef — still processable ────────

test("wave execution: control-plane blocker without blockerRef — processable", () => {
  const issues = [
    { number: 300, title: "Feature: deploy pipeline", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(300, parseControlPlaneBlocker({
    comments: [{
      body: `control_plane_blocker.v1:${JSON.stringify({
        status: "blocked",
        kind: "release_floor",
        blockerRef: "",
      })}`,
    }],
  }));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-100-wave-1",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: () => [],
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true, "Wave execution ignores control-plane blockers — even without blockerRef");
  assert.equal(result.next_issue_number, "300");
  assert.equal(result.blocked_count, 0);
});

// ─── T4: Explicitly resolved control-plane blocker — processable ─────────────

test("wave execution: resolved control-plane blocker (status=resumed) — processable", () => {
  const issues = [
    { number: 400, title: "Feature: monitoring dashboard", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(400, parseControlPlaneBlocker({
    comments: [
      {
        body: `control_plane_blocker.v1:${JSON.stringify({
          status: "blocked",
          kind: "upstream_bug",
          blockerRef: "#390",
        })}`,
      },
      {
        body: `control_plane_blocker.v1:${JSON.stringify({
          status: "resumed",
        })}`,
      },
    ],
  }));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-80-wave-1",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: () => [],
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true, "Resumed blocker is processable");
  assert.equal(result.next_issue_number, "400");
  assert.equal(result.blocked_count, 0);
});

// ─── T5: Multiple issues, mixed blocker state — all processable ──────────────

test("wave execution: mixed blocker state (stale + clean) — all processable in order", () => {
  const issues = [
    { number: 500, title: "Feature: blocked by stale blocker", labels: [{ name: "feature" }] },
    { number: 501, title: "Feature: unblocked feature", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(500, parseControlPlaneBlocker({
    comments: [{
      body: `control_plane_blocker.v1:${JSON.stringify({
        status: "blocked",
        kind: "upstream_bug",
        blockerRef: "#490",
      })}`,
    }],
  }));
  blockerMap.set(501, parseControlPlaneBlocker({}));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-90-wave-2",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: (n) => (n === 500
      ? [{ number: 490, state: "CLOSED", milestone: { title: "goal-90-wave-1" } }]
      : []),
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true);
  assert.equal(result.next_issue_number, "500", "First by number order — blocker state irrelevant");
  assert.equal(result.blocked_count, 0);
  assert.equal(result.ordered_unblocked_issues.length, 2, "Both issues processable");
});

// ─── T6: blockerRef format variants — all processable ────────────────────────

test("wave execution: blockerRef as plain number (no # prefix) — processable", () => {
  const issues = [
    { number: 600, title: "Feature: data export", labels: [{ name: "feature" }] },
  ];

  const blockerMap = new Map();
  blockerMap.set(600, parseControlPlaneBlocker({
    comments: [{
      body: `control_plane_blocker.v1:${JSON.stringify({
        status: "blocked",
        kind: "upstream_bug",
        blockerRef: "590",
      })}`,
    }],
  }));

  const result = computeNextMilestoneIssue({
    milestoneTitle: "goal-100-wave-1",
    completed: [],
    processed: [],
    issues,
    getBlockedBy: (n) => (n === 600
      ? [{ number: 590, state: "CLOSED", milestone: null }]
      : []),
    getControlPlaneBlocker: buildControlPlaneBlockerLoader(blockerMap),
  });

  assert.equal(result.has_next, true, "Wave execution ignores blockers regardless of format");
  assert.equal(result.next_issue_number, "600");
  assert.equal(result.blocked_count, 0);
});
