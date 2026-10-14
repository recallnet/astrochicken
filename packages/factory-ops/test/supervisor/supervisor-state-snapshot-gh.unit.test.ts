import assert from "node:assert/strict";
import test from "node:test";

import { resolveSnapshotGitHubReaders } from "../../src/lib/supervisor-state-snapshot-gh.ts";

test("snapshot readers preserve an explicit paginated dependency separately from direct reads", () => {
  const calls = [];
  const ghJsonFn = () => { throw new Error("direct reader must not handle pagination"); };
  const ghPaginatedFn = (apiPath, fallback) => {
    calls.push({ apiPath, fallback });
    return [{ number: 42, title: "Child", state: "OPEN", labels: [{ name: "feature" }] }];
  };
  const readers = resolveSnapshotGitHubReaders({ ghJsonFn, ghPaginatedFn });
  assert.equal(readers.ghJsonFn, ghJsonFn);
  assert.equal(readers.ghPaginatedFn, ghPaginatedFn);
  assert.deepEqual(readers.listGoalSubIssuesFn({ repo: "example/project", goalNumber: 7 }), [
    { number: 42, title: "Child", state: "open", labels: [{ name: "feature" }], blocked_by_count: 0 },
  ]);
  assert.deepEqual(calls, [{ apiPath: "repos/example/project/issues/7/sub_issues?per_page=100", fallback: [] }]);
});
