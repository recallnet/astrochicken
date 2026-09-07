import test from "node:test";
import assert from "node:assert/strict";
import { sweepEmptyMilestones } from "../src/commands/milestone-sweep-empty.ts";

test("sweepEmptyMilestones returns missing_repo when no repo", () => {
  const out = sweepEmptyMilestones({});
  assert.equal(out.summary, "missing_repo");
  assert.equal(out.closed, 0);
});

test("sweepEmptyMilestones closes empty wave milestones", () => {
  const closedNumbers = [];
  const out = sweepEmptyMilestones({
    repo: "test/repo",
    ghJsonPaginatedFn: () => [
      { number: 1, title: "goal-100-wave-1", state: "open", open_issues: 0, closed_issues: 5 },
      { number: 2, title: "goal-100-wave-2", state: "open", open_issues: 3, closed_issues: 2 },
      { number: 3, title: "goal-200-wave-1", state: "open", open_issues: 0, closed_issues: 3 },
      { number: 4, title: "not-a-wave", state: "open", open_issues: 0, closed_issues: 1 },
    ],
    ghFn: (args) => {
      const num = args.find((a, i) => args[i - 1] === "-X" && a === "PATCH") ? null : args[3];
      const match = (args.join(" ")).match(/milestones\/(\d+)/);
      if (match) closedNumbers.push(Number(match[1]));
      return { ok: true };
    },
  });
  assert.equal(out.closed, 2);
  assert.deepEqual(closedNumbers, [1, 3]);
  assert.equal(out.milestones[0].title, "goal-100-wave-1");
  assert.equal(out.milestones[1].title, "goal-200-wave-1");
});

test("sweepEmptyMilestones skips milestones with open issues", () => {
  const out = sweepEmptyMilestones({
    repo: "test/repo",
    ghJsonPaginatedFn: () => [
      { number: 1, title: "goal-100-wave-1", state: "open", open_issues: 2, closed_issues: 3 },
    ],
    ghFn: () => ({ ok: true }),
  });
  assert.equal(out.closed, 0);
  assert.equal(out.summary, "No empty wave milestones.");
});

test("sweepEmptyMilestones handles empty milestone list", () => {
  const out = sweepEmptyMilestones({
    repo: "test/repo",
    ghJsonPaginatedFn: () => [],
    ghFn: () => ({ ok: true }),
  });
  assert.equal(out.closed, 0);
});
