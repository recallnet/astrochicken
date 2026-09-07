import assert from "node:assert/strict";
import test from "node:test";

import { validateGoalDecisions } from "../../src/commands/goal-validate-decisions.ts";

const goalIssues = JSON.stringify([
  { number: 1907, title: "One" },
  { number: 1908, title: "Two" },
  { number: 1941, title: "Three" },
]);

test("validateGoalDecisions accepts complete valid decision set", () => {
  const out = validateGoalDecisions({
    goalIssuesRaw: goalIssues,
    decisionsRaw: JSON.stringify({
      decisions: [
        { issue_number: 1907, decision: "keep", reason: "keep" },
        { issue_number: 1908, decision: "duplicate", canonical_issue: 1907, reason: "dup" },
        { issue_number: 1941, decision: "close", reason: "obsolete" },
      ],
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.decisions.length, 3);
});

test("validateGoalDecisions rejects missing goals and bad canonical refs", () => {
  const out = validateGoalDecisions({
    goalIssuesRaw: goalIssues,
    decisionsRaw: JSON.stringify({
      decisions: [
        { issue_number: 1907, decision: "duplicate", canonical_issue: 1907, reason: "bad self ref" },
        { issue_number: 1908, decision: "keep", reason: "keep" },
      ],
    }),
  });

  assert.equal(out.ok, false);
  assert.match(out.error, /duplicate canonical_issue must reference another input goal/);
  assert.match(out.error, /input goal #1941 is missing from decisions/);
  assert.match(out.retry_prompt, /Include every input goal exactly once/);
});

test("validateGoalDecisions rejects unknown issues and invalid decisions", () => {
  const out = validateGoalDecisions({
    goalIssuesRaw: goalIssues,
    decisionsRaw: JSON.stringify({
      decisions: [
        { issue_number: 1907, decision: "keep", reason: "keep" },
        { issue_number: 1908, decision: "reject", reason: "bad" },
        { issue_number: 9999, decision: "close", reason: "unknown" },
        { issue_number: 1941, decision: "close", canonical_issue: 1907, reason: "bad canonical" },
      ],
    }),
  });

  assert.equal(out.ok, false);
  assert.match(out.error, /invalid decision reject/);
  assert.match(out.error, /unknown goal #9999/);
  assert.match(out.error, /set canonical_issue but decision is close/);
});
