import assert from "node:assert/strict";
import test from "node:test";

import { buildGoalScopedMergeMessage } from "../../src/lib/command-owners/merge-goal-message.ts";

test("buildGoalScopedMergeMessage — formats goal-scoped merge commit message", () => {
  const out = buildGoalScopedMergeMessage({
    goalIssueNumber: "1953",
    goalIssueTitle: "Add caching layer",
    mergeCandidatesRaw: JSON.stringify([
      { issue_number: "2001" },
      { issue_number: "2002" },
    ]),
  });
  assert.ok(out.merge_commit_message.startsWith("feat(goal-1953): Add caching layer (#1953)"));
  assert.ok(out.merge_commit_message.includes("Closes #2001, #2002"));
});

test("buildGoalScopedMergeMessage — falls back to milestoneTitle for goal number", () => {
  const out = buildGoalScopedMergeMessage({
    milestoneTitle: "goal-42-some-feature",
    mergeCandidatesRaw: "[]",
  });
  assert.ok(out.merge_commit_message.startsWith("feat(goal-42):"));
});

test("buildGoalScopedMergeMessage — returns empty when no goal number", () => {
  const out = buildGoalScopedMergeMessage({
    milestoneTitle: "unrelated",
    mergeCandidatesRaw: "[]",
  });
  assert.equal(out.merge_commit_message, "");
});
