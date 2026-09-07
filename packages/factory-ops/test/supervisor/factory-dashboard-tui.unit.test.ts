import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDashboardSessionBrowserLaunch,
  reduceDashboardTuiKeypress,
  resolveDashboardPromptFilters,
} from "../../src/cli/factory-dashboard-tui.ts";

test("dashboard handoff resolves selected live session row into session-browser target", () => {
  const dashboard = {
    tabs: [{
      id: "now",
      rows: [{
        id: "goal_issue:2175",
        kind: "goal_issue",
        runIdentity: {
          run_id: "run-live",
          graph: "goal_issue_execute.dot",
          node: "build",
          issue_number: 2175,
        },
        refs: {
          live_attachable: true,
          live_attach_target: {
            factory_id: "mothership",
            run_id: "run-live",
            session_id: "goal-2140-issue-2175",
            trace_kind: "coder",
            node: "build",
          },
        },
      }],
    }],
  };

  const launch = resolveDashboardSessionBrowserLaunch(dashboard, {
    activeTab: "now",
    selectedIndex: 0,
  });

  assert.equal(launch.ok, true);
  assert.equal(launch.initialRowId, "goal_issue:2175");
  assert.equal(launch.initialTarget.run_id, "run-live");
  assert.equal(launch.runIdentity.run_id, "run-live");
  assert.equal(launch.runIdentity.graph, "goal_issue_execute.dot");
});

test("dashboard prompt filter parser supports run/graph/node/issue tokens", () => {
  const parsed = resolveDashboardPromptFilters({
    activeFilters: { run_id: "", graph: "", node: "", issue: null },
    promptValue: "run=abc graph=goal_issue_execute.dot node=build issue=2175",
  });
  assert.equal(parsed.run_id, "abc");
  assert.equal(parsed.graph, "goal_issue_execute.dot");
  assert.equal(parsed.node, "build");
  assert.equal(parsed.issue, 2175);
});

test("dashboard key reducer requests inspect and refresh actions", () => {
  const dashboard = {
    tabs: [{
      id: "now",
      rows: [{
        id: "goal_issue:2175",
        kind: "goal_issue",
        refs: {
          run_id: "run-live",
          live_attach_target: { run_id: "run-live" },
        },
      }],
    }],
  };
  const baseState = {
    activeTab: "now",
    selectedIndex: 0,
    promptOpen: false,
    promptValue: "",
    activeFilters: { run_id: "", graph: "", node: "", issue: null },
  };

  const inspect = reduceDashboardTuiKeypress({
    dashboard,
    state: baseState,
    key: { name: "i" },
    canInspect: true,
  });
  assert.equal(inspect.action.type, "inspect");

  const refresh = reduceDashboardTuiKeypress({
    dashboard,
    state: baseState,
    key: { name: "r" },
  });
  assert.equal(refresh.action.type, "refresh");
});
