import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchIssueMetadataBatch,
  fetchIssueStateBatch,
  fetchIssueCommentsBatch,
} from "../../src/lib/batched-github-queries.ts";

test("fetchIssueMetadataBatch returns metadata for multiple issues in one call", () => {
  let callCount = 0;
  const ghJsonFn = (args) => {
    callCount++;
    assert.ok(args.includes("api"));
    assert.ok(args.includes("graphql"));
    return {
      data: {
        repository: {
          i10: { number: 10, state: "OPEN", title: "Goal A", labels: { nodes: [{ name: "goal" }] } },
          i20: { number: 20, state: "CLOSED", title: "Goal B", labels: { nodes: [{ name: "goal" }] } },
        },
      },
    };
  };

  const result = fetchIssueMetadataBatch({ repo: "test/repo", issueNumbers: [10, 20], ghJsonFn });
  assert.equal(callCount, 1);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get(10), { number: 10, state: "OPEN", title: "Goal A", labels: [{ name: "goal" }] });
  assert.deepEqual(result.get(20), { number: 20, state: "CLOSED", title: "Goal B", labels: [{ name: "goal" }] });
});

test("fetchIssueMetadataBatch returns empty map for empty input", () => {
  const ghJsonFn = () => { throw new Error("should not be called"); };
  const result = fetchIssueMetadataBatch({ repo: "test/repo", issueNumbers: [], ghJsonFn });
  assert.equal(result.size, 0);
});

test("fetchIssueMetadataBatch handles ghJsonFn failure gracefully", () => {
  const ghJsonFn = () => null;
  const result = fetchIssueMetadataBatch({ repo: "test/repo", issueNumbers: [1], ghJsonFn });
  assert.equal(result.size, 0);
});

test("fetchIssueMetadataBatch deduplicates issue numbers", () => {
  let queryText = "";
  const ghJsonFn = (args) => {
    const queryArg = args.find((a) => a.startsWith("query="));
    queryText = queryArg || "";
    return { data: { repository: { i5: { number: 5, state: "OPEN", title: "X", labels: { nodes: [] } } } } };
  };
  fetchIssueMetadataBatch({ repo: "test/repo", issueNumbers: [5, 5, 5], ghJsonFn });
  // Should only have one i5 selection
  const matches = queryText.match(/i5:/g);
  assert.equal(matches?.length, 1);
});

test("fetchIssueStateBatch returns state for multiple issues in one call", () => {
  let callCount = 0;
  const ghJsonFn = (args) => {
    callCount++;
    return {
      data: {
        repository: {
          i100: { state: "OPEN" },
          i200: { state: "CLOSED" },
        },
      },
    };
  };

  const result = fetchIssueStateBatch({ repo: "test/repo", issueNumbers: [100, 200], ghJsonFn });
  assert.equal(callCount, 1);
  assert.equal(result.get(100), "OPEN");
  assert.equal(result.get(200), "CLOSED");
});

test("fetchIssueStateBatch returns empty map for empty input", () => {
  const result = fetchIssueStateBatch({ repo: "test/repo", issueNumbers: [] });
  assert.equal(result.size, 0);
});

test("fetchIssueStateBatch handles failure gracefully", () => {
  const ghJsonFn = () => { throw new Error("boom"); };
  const result = fetchIssueStateBatch({ repo: "test/repo", issueNumbers: [1], ghJsonFn });
  assert.equal(result.size, 0);
});

test("fetchIssueCommentsBatch returns comments for multiple issues in one call", () => {
  let callCount = 0;
  const ghJsonFn = (args) => {
    callCount++;
    return {
      data: {
        repository: {
          i10: { state: "OPEN", comments: { nodes: [{ body: "comment 1", author: { login: "alice" } }] } },
          i20: { state: "CLOSED", comments: { nodes: [] } },
        },
      },
    };
  };

  const result = fetchIssueCommentsBatch({ repo: "test/repo", issueNumbers: [10, 20], ghJsonFn });
  assert.equal(callCount, 1);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get(10), {
    state: "OPEN",
    comments: [{ body: "comment 1", author: { login: "alice" } }],
  });
  assert.deepEqual(result.get(20), {
    state: "CLOSED",
    comments: [],
  });
});

test("fetchIssueCommentsBatch returns empty map for empty input", () => {
  const result = fetchIssueCommentsBatch({ repo: "test/repo", issueNumbers: [] });
  assert.equal(result.size, 0);
});

test("fetchIssueCommentsBatch handles failure gracefully", () => {
  const ghJsonFn = () => null;
  const result = fetchIssueCommentsBatch({ repo: "test/repo", issueNumbers: [1], ghJsonFn });
  assert.equal(result.size, 0);
});
