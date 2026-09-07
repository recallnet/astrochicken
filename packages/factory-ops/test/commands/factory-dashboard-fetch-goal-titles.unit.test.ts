import assert from "node:assert/strict";
import test from "node:test";

import { fetchGoalTitlesGraphQLOnly } from "../../src/lib/fetch-goal-titles-graphql-only.ts";

// --- Fix 3: GraphQL-only variant must NOT fall back to per-issue REST calls ---

test("fetchGoalTitlesGraphQLOnly returns titles from GraphQL on success", () => {
  const spawnSyncFn = (cmd, args) => {
    if (args.includes("graphql")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              i10: { number: 10, title: "Goal ten" },
              i20: { number: 20, title: "Goal twenty" },
            },
          },
        }),
      };
    }
    // Should never reach REST fallback
    throw new Error("REST fallback was called — this must not happen");
  };

  const result = fetchGoalTitlesGraphQLOnly([10, 20], { repo: "org/repo", spawnSyncFn });
  assert.deepStrictEqual(result, { 10: "Goal ten", 20: "Goal twenty" });
});

test("fetchGoalTitlesGraphQLOnly returns empty map when GraphQL fails — no REST fallback", () => {
  let restCallCount = 0;
  const spawnSyncFn = (cmd, args) => {
    if (args.includes("graphql")) {
      return { status: 1, stdout: "", stderr: "rate limited" };
    }
    restCallCount++;
    return { status: 0, stdout: "Some Title" };
  };

  const result = fetchGoalTitlesGraphQLOnly([10, 20], { repo: "org/repo", spawnSyncFn });
  assert.equal(restCallCount, 0, "REST fallback must not be called");
  assert.deepStrictEqual(result, {});
});

test("fetchGoalTitlesGraphQLOnly returns empty map when GraphQL throws — no REST fallback", () => {
  let restCallCount = 0;
  const spawnSyncFn = (cmd, args) => {
    if (args.includes("graphql")) {
      throw new Error("network error");
    }
    restCallCount++;
    return { status: 0, stdout: "Title" };
  };

  const result = fetchGoalTitlesGraphQLOnly([10], { repo: "org/repo", spawnSyncFn });
  assert.equal(restCallCount, 0, "REST fallback must not be called");
  assert.deepStrictEqual(result, {});
});

test("fetchGoalTitlesGraphQLOnly returns partial results when GraphQL returns some goals", () => {
  const spawnSyncFn = (cmd, args) => {
    if (args.includes("graphql")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              i10: { number: 10, title: "Found" },
              i20: null,
            },
          },
        }),
      };
    }
    throw new Error("REST fallback was called");
  };

  const result = fetchGoalTitlesGraphQLOnly([10, 20], { repo: "org/repo", spawnSyncFn });
  assert.deepStrictEqual(result, { 10: "Found" });
});
