import assert from "node:assert/strict";
import test from "node:test";

import { initWaveIssueWorktree } from "../../src/commands/wave-issue-init.ts";

test("initWaveIssueWorktree emits canonical issue_execution_started event", () => {
  const emitted = [];
  const out = initWaveIssueWorktree({
    issueNumber: "1536",
    repo: "/tmp/repo",
    branch: "wave/1536",
    factoryId: "example-trading",
    runId: "run-1536",
    emitDomainEventFn: (event) => emitted.push(event),
  });

  assert.equal(out.canonical_events.length, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, "factory.issue.execution_started");
  assert.equal(emitted[0].payload.issue_number, "1536");
  assert.equal(emitted[0].payload.branch, "wave/1536");
  assert.equal(emitted[0].payload.worktree_dir, out.worktree_dir);
});
