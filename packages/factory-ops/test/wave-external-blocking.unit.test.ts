import test from "node:test";
import assert from "node:assert/strict";
import { createGithubBlockedByLoader, evaluateMilestoneExternalBlocking } from "../src/lib/wave-external-blocking.ts";

test("evaluateMilestoneExternalBlocking marks milestone externally blocked when all runnable issues are blocked by other milestones", () => {
  const out = evaluateMilestoneExternalBlocking({
    milestoneTitle: "goal-1-wave-2",
    issues: [{ number: 20, title: "Feature B", labels: [] }],
    getBlockedBy: () => [{ number: 10, state: "OPEN", milestone: { title: "goal-1-wave-1" } }],
  });

  assert.equal(out.has_runnable_issue, false);
  assert.equal(out.all_runnable_issues_externally_blocked, true);
  assert.deepEqual(out.externally_blocked_issue_numbers, [20]);
});

test("evaluateMilestoneExternalBlocking ignores same-wave blockers when deciding external eligibility", () => {
  const out = evaluateMilestoneExternalBlocking({
    milestoneTitle: "goal-1-wave-1",
    issues: [
      { number: 10, title: "Feature A", labels: [] },
      { number: 11, title: "Feature B", labels: [] },
    ],
    getBlockedBy: (issueNumber) => issueNumber === 11
      ? [{ number: 10, state: "OPEN", milestone: { title: "goal-1-wave-1" } }]
      : [],
  });

  assert.equal(out.has_runnable_issue, true);
  assert.equal(out.all_runnable_issues_externally_blocked, false);
  assert.deepEqual(out.externally_blocked_issue_numbers, []);
});

test("createGithubBlockedByLoader returns empty when repo is missing", () => {
  const loader = createGithubBlockedByLoader({ repo: "", ghJsonFn: () => { throw new Error("should not call gh"); } });
  assert.deepEqual(loader(10), []);
});
