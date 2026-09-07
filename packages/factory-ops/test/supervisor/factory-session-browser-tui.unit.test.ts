import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionBrowserState,
  createSessionBrowserAction,
  formatSessionBrowserListFrame,
  reduceSessionBrowserKeypress,
} from "../../src/cli/factory-session-browser-tui.ts";

function sampleSnapshot() {
  return {
    views: {
      active: {
        id: "active",
        title: "Active",
        rows: [{
          id: "active:run-live",
          kind: "goal_issue",
          run_id: "run-live",
          title: "Issue #2175",
          status: "running",
          progress_label: "build",
          summary: "Builder active",
          mode: "live",
          live_attach_target: { run_id: "run-live", trace_kind: "coder", session_id: "goal-2140-issue-2175" },
          session_log: "/tmp/run-live.jsonl",
        }],
      },
      recent: {
        id: "recent",
        title: "Recent",
        rows: [{
          id: "recent:run-finished",
          kind: "goal_issue",
          run_id: "run-finished",
          title: "Issue #2174",
          status: "completed",
          progress_label: "review",
          summary: "Review completed",
          mode: "resume",
          resume_target: {
            run_id: "run-finished",
            session_id: "issue-2174-review",
            session_dir: "/tmp/sessions/issue-2174-review",
            cwd: "/tmp/worktree",
            provider: "openrouter",
            model: "anthropic/claude-sonnet-4.6",
            tool_mode: "read_only",
            trace_kind: "reviewer",
          },
          session_log: "/tmp/run-finished.jsonl",
        }],
      },
      history: {
        id: "history",
        title: "History",
        rows: [{
          id: "history:run-old",
          kind: "supervisor",
          run_id: "run-old",
          title: "Supervisor review",
          status: "completed",
          progress_label: "judge",
          summary: "Older transcript",
          mode: "transcript",
          session_log: "/tmp/run-old.jsonl",
        }],
      },
    },
  };
}

test("session browser opens live and transcript rows and returns to browser on escape", () => {
  const snapshot = sampleSnapshot();
  let state = buildSessionBrowserState(snapshot, { activeView: "active" });

  const openLive = reduceSessionBrowserKeypress({ snapshot, state, key: { name: "return" } });
  assert.deepEqual(openLive.action, createSessionBrowserAction("open_live", { rowId: "active:run-live" }));

  state = buildSessionBrowserState(snapshot, { activeView: "recent" });
  const openResume = reduceSessionBrowserKeypress({ snapshot, state, key: { name: "return" } });
  assert.deepEqual(openResume.action, createSessionBrowserAction("open_resume", { rowId: "recent:run-finished" }));

  const attachedState = buildSessionBrowserState(snapshot, { mode: "live", activeView: "active", selectedRowId: "active:run-live" });
  const escape = reduceSessionBrowserKeypress({ snapshot, state: attachedState, key: { name: "escape" } });
  assert.equal(escape.state.mode, "browser");
  assert.deepEqual(escape.action, createSessionBrowserAction("close_view", {}));
});

test("session browser search filters history rows without changing tabs", () => {
  const snapshot = sampleSnapshot();
  let state = buildSessionBrowserState(snapshot, { activeView: "history" });

  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "/" } }).state;
  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "s", name: "s" } }).state;
  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "u", name: "u" } }).state;
  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "p", name: "p" } }).state;
  state = reduceSessionBrowserKeypress({ snapshot, state, key: { name: "return" } }).state;

  assert.equal(state.activeView, "history");
  assert.equal(state.searchQuery, "sup");
  assert.equal(state.visibleRows.length, 1);
  assert.equal(state.visibleRows[0].id, "history:run-old");
});

test("session browser accepts raw arrow escape sequences for movement and tab switching", () => {
  const snapshot = sampleSnapshot();
  let state = buildSessionBrowserState(snapshot, { activeView: "active" });

  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "\u001b[C" } }).state;
  assert.equal(state.activeView, "recent");

  state = reduceSessionBrowserKeypress({ snapshot, state, key: { sequence: "\u001b[D" } }).state;
  assert.equal(state.activeView, "active");

  const multiSnapshot = {
    views: {
      active: {
        id: "active",
        title: "Active",
        rows: [
          snapshot.views.active.rows[0],
          {
            id: "active:run-second",
            kind: "goal_issue",
            run_id: "run-second",
            title: "Issue #2176",
            status: "running",
            progress_label: "review",
            summary: "Reviewer active",
            mode: "live",
            live_attach_target: { run_id: "run-second", trace_kind: "reviewer", session_id: "goal-2140-issue-2176" },
            session_log: "/tmp/run-second.jsonl",
          },
        ],
      },
      recent: snapshot.views.recent,
      history: snapshot.views.history,
    },
  };

  state = buildSessionBrowserState(multiSnapshot, { activeView: "active", selectedIndex: 0 });
  state = reduceSessionBrowserKeypress({ snapshot: multiSnapshot, state, key: { sequence: "\u001b[B" } }).state;
  assert.equal(state.selectedIndex, 1);
  state = reduceSessionBrowserKeypress({ snapshot: multiSnapshot, state, key: { sequence: "\u001b[A" } }).state;
  assert.equal(state.selectedIndex, 0);
});

test("session browser list frame uses dashboard-like columns and selected row details", () => {
  const frame = formatSessionBrowserListFrame(sampleSnapshot(), { activeView: "active", selectedIndex: 0 });
  assert.match(frame, /#  KIND\s+MODE\s+ISSUE\s+TITLE\s+STATUS\s+STEP\s+AGE\s+SUMMARY/);
  assert.match(frame, /goal_issue/);
  assert.match(frame, /running/);
  assert.match(frame, /build/);
  assert.match(frame, /\[goal_issue\/live\]/);
});
