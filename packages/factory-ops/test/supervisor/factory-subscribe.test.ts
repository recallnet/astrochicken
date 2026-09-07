import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Test the internal diffing logic by importing and testing the module's pure functions
// Since factorySubscribe is async with timers, we test the building blocks

import { readAllRunStates, resolveGraph, resolveIssue, resolveMilestone } from "../../src/commands/factory-status.ts";
import {
  buildSubscribeSnapshot,
  classifySemanticEvent,
  diffSnapshots,
  enrichSubscriptionEvent,
  formatSubscribeSummary,
  formatSubscribeSnapshot,
  initializeLifecycleCursors,
  matchesRawFilter,
  matchesRuntimeContext,
  matchesSemanticTarget,
  readLifecycleEventsSince,
  resolveSubscribeMode,
  summarizeSubscribeWindow,
} from "../../src/commands/factory-subscribe.ts";

describe("factory-subscribe building blocks", () => {
  it("readAllRunStates returns empty map for missing dir", () => {
    const states = readAllRunStates({ runsDir: "/nonexistent/path" });
    assert.equal(states.size, 0);
  });

  it("resolveGraph extracts from child pipeline keys", () => {
    const state = { context: { __child_pipeline_wave_execute: "/path/to/wave.dot" } };
    assert.equal(resolveGraph(state), "wave_execute");
  });

  it("resolveGraph prefers pipeline field", () => {
    const state = { pipeline: "my_pipeline", context: {} };
    assert.equal(resolveGraph(state), "my_pipeline");
  });

  it("resolveIssue extracts issue number from context", () => {
    assert.equal(resolveIssue({ context: { issue_number: "42" } }), "42");
    assert.equal(resolveIssue({ context: { current_issue_number: "99" } }), "99");
    assert.equal(resolveIssue({ context: {} }), "");
  });

  it("resolveMilestone extracts milestone title", () => {
    assert.equal(resolveMilestone({ context: { milestone_title: "wave-1" } }), "wave-1");
    assert.equal(resolveMilestone({ context: {} }), "");
  });

  it("initializeLifecycleCursors baselines existing lifecycle logs to current size", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-subscribe-"));
    const runsDir = join(root, "runs");
    const runDir = join(runsDir, "run-1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ runId: "run-1", pipeline: "wave.dot", status: "running", context: {} }, null, 2));
    writeFileSync(join(runDir, "lifecycle-events.jsonl"), `${JSON.stringify({ event: "complete" })}\n`);

    const cursors = initializeLifecycleCursors(readAllRunStates({ runsDir }), { runsDir });
    assert.ok(cursors.get("run-1").offset > 0);
  });

  it("readLifecycleEventsSince returns appended lifecycle events for short-lived runs", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-subscribe-"));
    const runsDir = join(root, "runs");
    const runDir = join(runsDir, "run-short");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "lifecycle-events.jsonl"), [
      JSON.stringify({ event: "run-start", runId: "run-short", node: "start" }),
      JSON.stringify({ event: "node-change", runId: "run-short", node: "build", prevNode: "start" }),
      JSON.stringify({ event: "complete", runId: "run-short", node: "done" }),
      "",
    ].join("\n"));

    const out = readLifecycleEventsSince({ runsDir, runId: "run-short", offset: 0 });
    assert.deepEqual(out.events.map((event) => event.event), ["run-start", "node-change", "complete"]);
    assert.ok(out.nextOffset > 0);
  });

  it("resolveSubscribeMode defaults to semantic next-goal-progress for coding-agent use", () => {
    const out = resolveSubscribeMode({});
    assert.equal(out.semanticMode, true);
    assert.equal(out.target, "next-goal-progress");
    assert.equal(out.eventTypes.size, 0);
  });

  it("classifySemanticEvent treats review transitions and merges as semantic targets", () => {
    const review = classifySemanticEvent({
      event: "node-change",
      graph: "goal_issue_execute",
      node: "review",
    });
    assert.equal(review.semantic_family, "review");
    assert.deepEqual(review.semantic_targets, ["next-review", "next-goal-progress"]);

    const merge = classifySemanticEvent({
      event: "merge",
      graph: "merge_item",
      mergeStatus: "completed",
    });
    assert.equal(merge.semantic_family, "merge");
    assert.deepEqual(merge.semantic_targets, ["next-merge", "next-goal-progress"]);
  });

  it("diff snapshot emits artifact events for demo_artifact_url/artifact_url context keys", () => {
    const prev = new Map([
      ["run-1", {
        status: "completed",
        node: "judge",
        graph: "wave_execute",
        issue: "2557",
        milestone: "goal-1855-wave-1",
        artifactUrls: new Set(),
      }],
    ]);

    const curr = new Map([
      ["run-1", {
        status: "completed",
        node: "judge",
        graph: "wave_execute",
        issue: "2557",
        milestone: "goal-1855-wave-1",
        artifactUrls: new Set([
          "https://github.com/recallnet/astrochicken/issues/9901",
          "https://github.com/recallnet/astrochicken/issues/9902",
        ]),
      }],
    ]);

    const artifactEvents = diffSnapshots(prev, curr).filter((event) => event.event === "artifact");
    assert.equal(artifactEvents.length, 2);
    assert.ok(artifactEvents.every((event) => event.artifactUrl.startsWith("https://github.com/recallnet/astrochicken/issues/99")));
  });

  it("matches runtime context filters for issue + milestone in raw-event mode", () => {
    const event = {
      event: "node-change",
      runId: "run-issue-1",
      graph: "goal_issue_execute",
      node: "implement",
      issue: "2418",
      milestone: "goal-2320-wave-3",
      semantic_family: "issue",
    };

    assert.equal(
      matchesRawFilter(event, {
        eventTypes: new Set(["node-change"]),
        runId: "run-issue",
        graph: "goal_issue",
        node: "impl",
        issue: "#2418",
        milestone: "wave-3",
      }),
      true,
    );

    assert.equal(
      matchesRawFilter(event, {
        eventTypes: new Set(["node-change"]),
        issue: "2419",
      }),
      false,
    );
  });

  it("applies semantic-family filter while matching semantic targets", () => {
    const reviewEvent = {
      runId: "run-review-1",
      graph: "goal_issue_execute",
      node: "review",
      semantic_family: "review",
      semantic_targets: ["next-review", "next-goal-progress"],
    };

    assert.equal(
      matchesSemanticTarget(reviewEvent, {
        target: "next-review",
        family: "review",
      }),
      true,
    );

    assert.equal(
      matchesSemanticTarget(reviewEvent, {
        target: "next-review",
        family: "merge",
      }),
      false,
    );
  });

  it("ignores family filter when omitted", () => {
    const event = {
      issue: "2418",
      milestone: "goal-2320-wave-3",
      semantic_family: "issue",
    };

    assert.equal(matchesRuntimeContext(event, { issue: "2418", milestone: "wave-3" }), true);
    assert.equal(matchesRuntimeContext(event, { issue: "2418", milestone: "wave-3", family: "" }), true);
  });

  it("enrichSubscriptionEvent preserves required insight contract fields", () => {
    const event = enrichSubscriptionEvent(
      {
        event: "node-change",
        runId: "run-contract-1",
        graph: "goal_issue_execute",
        node: "review",
        ts: "2026-03-19T10:10:00.000Z",
      },
      {
        state: {
          runId: "run-contract-1",
          pipeline: "goal_issue_execute.dot",
          currentNode: "review",
          context: { issue_number: "2418", milestone_title: "goal-2320-wave-3" },
        },
      },
    );

    assert.equal(event.schemaVersion, "factory_insight_event/v1");
    assert.equal(event.eventName, "factory.run.node_change");
    assert.equal(event.semanticFamily, "review");
    assert.equal(event.semanticTarget, "next-review");
    assert.equal(event.runId, "run-contract-1");
    assert.equal(event.graphId, "goal_issue_execute");
    assert.equal(event.nodeName, "review");
    assert.equal(event.timestamp, "2026-03-19T10:10:00.000Z");
  });

  it("summarizeSubscribeWindow renders concise semantic summaries", () => {
    const summary = summarizeSubscribeWindow([
      {
        semantic_family: "review",
        event: "node-change",
        runId: "run-1",
        graph_label: "goal_issue_execute",
        node: "review",
        prevNode: "build",
        issue: "44",
        milestone: "goal-40-wave-1",
        ts: "2026-03-19T10:00:00.000Z",
      },
      {
        semantic_family: "merge",
        event: "merge",
        runId: "run-2",
        graph_label: "merge_item",
        node: "done",
        prevNode: "",
        issue: "44",
        milestone: "",
        mergeStatus: "completed",
        ts: "2026-03-19T10:05:00.000Z",
      },
    ], { target: "next-review" });

    assert.equal(summary.target, "next-review");
    assert.equal(summary.event_count, 2);
    assert.equal(summary.counts.review, 1);
    assert.equal(summary.counts.merge, 1);
    assert.match(formatSubscribeSummary(summary), /target=next-review/);
    assert.match(formatSubscribeSummary(summary), /review=1/);
    assert.match(formatSubscribeSummary(summary), /merge=1/);
  });

  it("buildSubscribeSnapshot summarizes daemon state, current activity, and recent semantic events", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-subscribe-"));
    const runsDir = join(root, "runs");
    const tickDir = join(runsDir, "tick-1");
    const issueDir = join(runsDir, "issue-1");
    mkdirSync(tickDir, { recursive: true });
    mkdirSync(issueDir, { recursive: true });

    writeFileSync(join(tickDir, "state.json"), JSON.stringify({
      runId: "tick-1",
      pipeline: "factory_supervisor_tick.dot",
      status: "running",
      currentNode: "fan_out_goal_run",
      context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
    }, null, 2));
    writeFileSync(join(issueDir, "state.json"), JSON.stringify({
      runId: "issue-1",
      pipeline: "goal_issue_execute.dot",
      status: "completed",
      currentNode: "review",
      context: {
        issue_number: "2377",
        milestone_title: "goal-2370-wave-1",
        review_verdict: "approve",
      },
    }, null, 2));
    writeFileSync(join(issueDir, "lifecycle-events.jsonl"), `${JSON.stringify({
      event: "complete",
      runId: "issue-1",
      graph: "goal_issue_execute",
      node: "review",
      issue: "2377",
      milestone: "goal-2370-wave-1",
      ts: new Date().toISOString(),
    })}\n`);

    const snapshot = buildSubscribeSnapshot({
      runsDir,
      context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
      hostStatus: { running: true, pid: 4242, runCount: 2 },
      windowMinutes: 15,
    });

    assert.equal(snapshot.health.running, true);
    assert.equal(snapshot.recent_summary.counts.review, 1);
    assert.match(formatSubscribeSnapshot(snapshot), /daemon=running/);
    assert.match(formatSubscribeSnapshot(snapshot), /Recent  window=15m  events=1  review=1/);
    assert.match(formatSubscribeSnapshot(snapshot), /Last  \[review\]/);
  });

  it("buildSubscribeSnapshot prefers tick-status current state when available", () => {
    const snapshot = buildSubscribeSnapshot({
      runsDir: "/nonexistent",
      context: { factory_id: "mothership" },
      now: Date.parse("2026-03-26T20:00:00.000Z"),
      tickStatusFn: () => ({
        context: { factory_id: "mothership" },
        ticks: [{
          status: "running",
          stage: "wave_execute",
          stageLabel: "Executing wave",
        }],
      }),
    });

    assert.equal(snapshot.current_state, "supervisor  Executing wave");
  });
});
