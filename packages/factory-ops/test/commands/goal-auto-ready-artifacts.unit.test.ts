import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import { makeUnblockedIssueGraphqlResponse } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { autoReadyArtifactGoals } from "../../src/commands/goal-auto-ready-artifacts.ts";

test("autoReadyArtifactGoals returns empty result when gh issue list returns undefined (e.g. rate limit)", () => {
  const out = autoReadyArtifactGoals({
    repo: "recallnet/astrochicken",
    ghJsonFn: (_args) => undefined,
    ghExec: () => { throw new Error("must not call gh"); },
    markGoalDispatchedFn: () => { throw new Error("must not mark dispatched"); },
  });

  assert.equal(out.promoted_count, 0);
  assert.deepEqual(out.promoted, []);
  assert.equal(out.awaiting_human_skipped_count, 0);
  assert.deepEqual(out.awaiting_human_skipped, []);
  assert.deepEqual(out.messages, []);
});

test("autoReadyArtifactGoals skips awaiting-human goals and reports why", () => {
  const comments = [];
  const markCalls = [];

  const out = autoReadyArtifactGoals({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args) => {
      if (args[0] === "issue" && args[1] === "list") {
        return [
          {
            number: 2200,
            title: "[artifact] Hard planning packet ready",
            labels: [{ name: "goal" }, { name: "awaiting-human" }],
          },
        ];
      }
      if (args[0] === "api" && args[1] === "graphql") {
        return makeUnblockedIssueGraphqlResponse();
      }
      throw new Error(`unexpected ghJson args: ${args.join(" ")}`);
    },
    ghExec: (args) => {
      comments.push(args);
      return successfulCommandResult();
    },
    markGoalDispatchedFn: ({ repo, issueNumber }) => {
      markCalls.push({ repo, issueNumber });
      return { ok: true, status: 0 };
    },
  });

  assert.equal(out.promoted_count, 0);
  assert.deepEqual(out.promoted, []);
  assert.equal(out.awaiting_human_skipped_count, 1);
  assert.deepEqual(out.awaiting_human_skipped, ["2200"]);
  assert.equal(markCalls.length, 0, "markGoalDispatched must not run for awaiting-human goals");
  assert.equal(comments.length, 0, "skip path must not post auto-ready comments");
  assert.match(out.messages[0], /awaiting-human label present/);
});

test("autoReadyArtifactGoals promotes eligible artifact goals via markGoalDispatched", () => {
  const comments = [];
  const markCalls = [];

  const out = autoReadyArtifactGoals({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args) => {
      if (args[0] === "issue" && args[1] === "list") {
        return [
          {
            number: 2300,
            title: "[artifact] Plan attached and reviewed",
            labels: [{ name: "goal" }],
          },
        ];
      }
      if (args[0] === "api" && args[1] === "graphql") {
        return makeUnblockedIssueGraphqlResponse();
      }
      throw new Error(`unexpected ghJson args: ${args.join(" ")}`);
    },
    ghExec: (args) => {
      comments.push(args);
      return successfulCommandResult();
    },
    markGoalDispatchedFn: ({ repo, issueNumber }) => {
      markCalls.push({ repo, issueNumber });
      return { ok: true, status: 0 };
    },
  });

  assert.equal(out.promoted_count, 1);
  assert.deepEqual(out.promoted, ["2300"]);
  assert.equal(out.awaiting_human_skipped_count, 0);
  assert.deepEqual(out.awaiting_human_skipped, []);
  assert.deepEqual(markCalls, [{ repo: "recallnet/astrochicken", issueNumber: "2300" }]);
  assert.equal(comments.length, 1);
  assert.deepEqual(comments[0], [
    "issue",
    "comment",
    "2300",
    "--repo",
    "recallnet/astrochicken",
    "--body",
    "Auto-promoted to ready by factory supervisor artifact→goal policy.",
  ]);
});
