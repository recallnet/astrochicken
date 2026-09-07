import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildRecoveredWaveFixture } from "./factory-status-fixture-harness.ts";
import { factorySessionTail } from "../../src/commands/factory-session-tail.ts";
import { factorySubscribe } from "../../src/commands/factory-subscribe.ts";

function createStdoutBuffer() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    read() {
      return value;
    },
  };
}

test("factorySessionTail resolves active child session log from recovered fixture", { concurrency: false }, async () => {
  const { runsDir, sessionLog } = buildRecoveredWaveFixture();
  const stdout = createStdoutBuffer();

  const out = await factorySessionTail({
    runsDir,
    runId: "wave-1",
    lines: 20,
    follow: false,
    stdout,
  });

  assert.equal(out.ok, true);
  assert.equal(out.parent_run_id, "wave-1");
  assert.equal(out.run_id, "issue-1");
  assert.equal(out.child_id, "execute_issue_in_wave__issue_1");
  assert.equal(out.session_log, sessionLog);

  const rendered = stdout.read();
  assert.match(rendered, /session_log=.*session\.jsonl/);
  assert.match(rendered, /\[2026-03-10T16:00:00.000Z\] assistant apply_patch/);
  assert.match(rendered, /Resuming existing worktree/);
  assert.match(rendered, /\[2026-03-10T16:00:01.000Z\] tool:apply_patch ok patched/);
});

test("factorySessionTail ignores orphaned run directories without state", { concurrency: false }, async () => {
  const { runsDir, sessionLog } = buildRecoveredWaveFixture();
  mkdirSync(join(runsDir, "orphan-run"), { recursive: true });
  const stdout = createStdoutBuffer();

  const out = await factorySessionTail({
    runsDir,
    runId: "wave-1",
    lines: 20,
    follow: false,
    stdout,
  });

  assert.equal(out.ok, true);
  assert.equal(out.parent_run_id, "wave-1");
  assert.equal(out.run_id, "issue-1");
  assert.equal(out.session_log, sessionLog);
  assert.match(stdout.read(), /session_log=.*session\.jsonl/);
});

test("factorySubscribe emits lifecycle node-change from recovered fixture", { concurrency: false }, async () => {
  const { runsDir } = buildRecoveredWaveFixture();
  const subscription = factorySubscribe({
    runsDir,
    eventType: "node-change",
    runId: "issue-1",
    stream: false,
    timeoutSec: 3,
    summaryWindowMinutes: 0,
  });

  setTimeout(() => {
    appendFileSync(
      `${runsDir}/issue-1/lifecycle-events.jsonl`,
      `${JSON.stringify({
        event: "node-change",
        runId: "issue-1",
        graph: "wave_issue_execute",
        prevNode: "build",
        node: "review",
        issue: "1625",
        milestone: "goal-1564-wave-2",
        ts: "2026-03-10T16:00:03.000Z",
      })}\n`,
    );
  }, 100);

  const out = await subscription;
  assert.equal(out.timedOut, false);
  assert.equal(out.matched.length, 1);
  assert.equal(out.matched[0].runId, "issue-1");
  assert.equal(out.matched[0].event, "node-change");
  assert.equal(out.matched[0].prevNode, "build");
  assert.equal(out.matched[0].node, "review");
  assert.equal(out.matched[0].issue, "1625");
  assert.equal(out.matched[0].milestone, "goal-1564-wave-2");
});

test("factorySubscribe defaults to next-goal-progress and ignores infra noise until semantic goal progress arrives", { concurrency: false }, async () => {
  const { runsDir } = buildRecoveredWaveFixture();
  const infraRunDir = join(runsDir, "release-run");
  mkdirSync(infraRunDir, { recursive: true });
  appendFileSync(
    join(infraRunDir, "state.json"),
    JSON.stringify({
      runId: "release-run",
      pipeline: "release_report_flow",
      status: "running",
      currentNode: "publish_release_report",
      context: {},
    }, null, 2),
  );

  const subscription = factorySubscribe({
    runsDir,
    stream: false,
    timeoutSec: 3,
    summaryWindowMinutes: 0,
  });

  setTimeout(() => {
    appendFileSync(
      `${runsDir}/release-run/lifecycle-events.jsonl`,
      `${JSON.stringify({
        event: "complete",
        runId: "release-run",
        graph: "release_report_flow",
        node: "publish_release_report",
        ts: "2026-03-10T16:00:02.000Z",
      })}\n`,
    );
  }, 50);

  setTimeout(() => {
    appendFileSync(
      `${runsDir}/issue-1/lifecycle-events.jsonl`,
      `${JSON.stringify({
        event: "node-change",
        runId: "issue-1",
        graph: "wave_issue_execute",
        prevNode: "build",
        node: "review",
        issue: "1625",
        milestone: "goal-1564-wave-2",
        ts: "2026-03-10T16:00:03.000Z",
      })}\n`,
    );
  }, 150);

  const out = await subscription;
  assert.equal(out.timedOut, false);
  assert.equal(out.matched.length, 1);
  assert.equal(out.matched[0].semantic_family, "review");
  assert.equal(out.matched[0].runId, "issue-1");
  assert.equal(out.summary.counts.review, 1);
  assert.equal(out.summary.target, "next-goal-progress");
  assert.equal(out.summary.events.at(-1)?.semantic_family, "review");
});

test("factorySubscribe filters by graph and surfaces release-report delivery fields", { concurrency: false }, async () => {
  const { runsDir } = buildRecoveredWaveFixture();
  const releaseRunDir = join(runsDir, "release-run");
  mkdirSync(releaseRunDir, { recursive: true });
  appendFileSync(
    join(releaseRunDir, "state.json"),
    JSON.stringify({
      runId: "release-run",
      pipeline: "release_report_flow",
      status: "running",
      currentNode: "report_worthiness_gate",
      context: {
        delivery_decision: "issue_only",
        should_generate_report: "true",
        should_post_to_slack: "false",
        worthiness_score: "0.82",
        release_report_issue_delivery: "updated:#2300",
      },
    }, null, 2),
  );
  const subscription = factorySubscribe({
    runsDir,
    eventType: "node-change",
    graph: "release_report_flow",
    stream: false,
    timeoutSec: 3,
    summaryWindowMinutes: 0,
  });

  setTimeout(() => {
    appendFileSync(
      `${runsDir}/release-run/lifecycle-events.jsonl`,
      `${JSON.stringify({
        event: "node-change",
        runId: "release-run",
        graph: "release_report_flow",
        prevNode: "report_worthiness_gate",
        node: "publish_release_report",
        delivery_decision: "issue_only",
        should_generate_report: "true",
        should_post_to_slack: "false",
        worthiness_score: "0.82",
        release_report_issue_delivery: "updated:#2300",
        ts: "2026-03-10T16:00:03.000Z",
      })}\n`,
    );
  }, 100);

  const out = await subscription;
  assert.equal(out.timedOut, false);
  assert.equal(out.matched.length, 1);
  assert.equal(out.matched[0].graph, "release_report_flow");
  assert.equal(out.matched[0].deliveryDecision, "issue_only");
  assert.equal(out.matched[0].shouldGenerateReport, "true");
  assert.equal(out.matched[0].releaseReportIssueDelivery, "updated:#2300");
});
