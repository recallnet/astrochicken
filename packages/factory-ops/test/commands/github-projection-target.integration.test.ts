import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { resolveGitHubProjectionTarget } from "../../src/lib/github-projection-target.ts";

test("resolveGitHubProjectionTarget integrates factory-ops command ownership with github-adapter receipts", () => {
  const emitted = [];
  const calls = [];
  const target = resolveGitHubProjectionTarget({
    repo: "example-org/example-trading",
    ghExec: (args) => {
      calls.push(args);
      return successfulCommandResult();
    },
    factoryId: "example-trading",
    runId: "run-1536",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  const result = target.issueComment({
    number: 1536,
    body: "integration comment",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], [
    "issue", "comment", "1536", "--repo", "example-org/example-trading", "--body", "integration comment",
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, "github.projection.receipt");
  assert.equal(emitted[0].payload.operation, "issue_comment");
  assert.equal(emitted[0].payload.issue_number, "1536");
});

test("resolveGitHubProjectionTarget does not crash when ghExec is undefined — falls back to runGhCli", () => {
  // This is the exact scenario that crashes goal_run at mark_decompose_attempt:
  // PostDecomposeAttemptAction calls postDecomposeAttemptMarker without ghExec,
  // which calls resolveGitHubProjectionTarget({ repo, ghExec: undefined }).
  // Previously this created a wrapper around undefined and threw "ghExec is not a function".
  const target = resolveGitHubProjectionTarget({
    repo: "example-org/example-trading",
    ghExec: undefined,
    factoryId: "example-trading",
    runId: "run-test",
  });
  assert.ok(target, "should return a projection target without crashing");
  assert.equal(typeof target.issueComment, "function");
});
