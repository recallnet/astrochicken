import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS,
  TERMINAL_CLEANUP_NODES,
  checkSupervisorHealth,
  detectClosedIssueActiveRuns,
} from "../../src/commands/supervisor-health-check.ts";

test("detectClosedIssueActiveRuns flags old active runs for already-closed issues", () => {
  const now = Date.parse("2026-03-17T16:00:00.000Z");
  const startedAt = new Date(now - CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS - 60_000).toISOString();
  const issueStates = new Map([
    [2210, { state: "CLOSED", closedAt: "2026-03-17T15:08:06Z" }],
    [2196, { state: "OPEN", closedAt: null }],
  ]);

  const violations = detectClosedIssueActiveRuns({
    repo: "recallnet/astrochicken",
    activeRuns: [
      {
        id: "ef09cc48",
        issue: "2210",
        node: "clean_main",
        graph: "/tmp/goal_execute.dot",
        started_at: startedAt,
      },
      {
        id: "1fa7b8eb",
        issue: "2196",
        node: "execute_issue",
        graph: "/tmp/goal_execute.dot",
        started_at: startedAt,
      },
    ],
    now,
    issueStateFn: ({ issueNumber }) => issueStates.get(issueNumber) || { state: "OPEN", closedAt: null },
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].issue, 2210);
  assert.equal(violations[0].run_id, "ef09cc48");
  assert.equal(violations[0].node, "clean_main");
  assert.equal(violations[0].terminal_cleanup_node, true);
  assert.equal(violations[0].threshold_ms, CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS);
  assert.ok(TERMINAL_CLEANUP_NODES.has("clean_main"));
});

test("checkSupervisorHealth emits closed-issue active-run violation from scoped factory status", () => {
  const now = Date.parse("2026-03-17T16:00:00.000Z");
  const startedAt = new Date(now - CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS - 60_000).toISOString();

  const out = checkSupervisorHealth({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    runsDir: ".hatch/mothership/runs",
    now,
    ghJsonFn: (args) => {
      const joined = args.join(" ");
      if (joined.includes("issue list") && joined.includes("--search") && joined.includes("Wave Ready:")) return [];
      if (joined.includes("issue list") && joined.includes("--label feature")) return [];
      if (joined.includes("issue list") && joined.includes("--label quarantined")) return [];
      if (joined.includes("issue list") && joined.includes("--label goal")) return [];
      if (joined.includes("issue list") && joined.includes("--json number,title,labels")) return [];
      if (joined.includes("issue view 2210")) return { state: "CLOSED", closedAt: "2026-03-17T15:08:06Z" };
      throw new Error(`unexpected ghJson args: ${joined}`);
    },
    factoryStatusFn: () => ({
      active: [{
        id: "ef09cc48",
        issue: "2210",
        node: "clean_main",
        graph: "/tmp/factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
        started_at: startedAt,
      }],
    }),
    emitSupervisorArtifactFn: () => ({ ok: true, issue_url: "https://example.test/artifact/1", error: "" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.violation_count, 1);
  assert.equal(out.violations[0].type, "closed_issue_active_runs");
  assert.equal(out.violations[0].runs.length, 1);
  assert.equal(out.violations[0].runs[0].issue, 2210);
  assert.equal(out.artifact_url, "https://example.test/artifact/1");
});

test("checkSupervisorHealth treats open feature under closed goal as owned follow-up, not orphaned milestone residue", () => {
  const out = checkSupervisorHealth({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args) => {
      const joined = args.join(" ");
      if (joined.includes("issue list") && joined.includes("--search") && joined.includes("Wave Ready:")) return [];
      if (joined.includes("issue list") && joined.includes("--label feature")) {
        return [{
          number: 2331,
          title: "Regression gates",
          body: "Closes as part of #2199",
          labels: [{ name: "feature" }],
          milestone: null,
          url: "https://example/2331",
        }];
      }
      if (joined.includes("issue list") && joined.includes("--label quarantined")) return [];
      if (joined.includes("issue list") && joined.includes("--label goal")) return [];
      if (joined.includes("issue list") && joined.includes("--json number,title,labels")) return [];
      if (joined.includes("issue view 2199") && joined.includes("--json number,state,labels,title")) {
        return {
          number: 2199,
          state: "CLOSED",
          title: "Goal: Medium and provisional hard routing onto the current issue path",
          labels: [{ name: "goal" }],
        };
      }
      throw new Error(`unexpected ghJson args: ${joined}`);
    },
    factoryStatusFn: () => ({ active: [] }),
    emitSupervisorArtifactFn: () => ({ ok: true, issue_url: "https://example.test/artifact/2", error: "" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.violations.some((entry) => entry.type === "orphan_features"), false);
  const closedGoalViolation = out.violations.find((entry) => entry.type === "features_under_closed_goals");
  assert.ok(closedGoalViolation);
  assert.equal(closedGoalViolation.issues.length, 1);
  assert.equal(closedGoalViolation.issues[0].number, 2331);
});
