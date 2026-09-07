import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubIssueSource } from "@hatch/github-adapter";
import { createTestAdapter } from "@hatch/github-adapter/test";
import { fetchGoalIssue } from "../../src/commands/milestone-fetch-goal-issue.ts";

test("fetchGoalIssue emits canonical issue-source read event through the github adapter boundary", () => {
  const emitted = [];
  const githubIssueSource = createGitHubIssueSource({
    adapter: createTestAdapter({
      repo: "recallnet/astrochicken",
      stubs: {
        issueView: () => ({
          number: 2411,
          title: "Goal: Fix the factory",
          body: "Body",
        }),
      },
    }),
    factoryId: "mothership",
    runId: "run-2411",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });
  const issue = fetchGoalIssue({
    repo: "recallnet/astrochicken",
    goalNumber: "2411",
    githubIssueSource,
  });

  assert.equal(issue.number, 2411);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, "github.issue_source.read");
  assert.equal(emitted[0].payload.issue_number, "2411");
});
