import assert from "node:assert/strict";
import test from "node:test";

import { buildBrainstormContextFromShellIntake } from "../../src/commands/brainstorm-intake-context.ts";

function makeGhJsonStub({ closedGoals = [], openBacklog = [] } = {}) {
  return (args) => {
    if (args.includes("--state") && args.includes("closed") && args.includes("--label") && args.includes("goal")) {
      return closedGoals;
    }
    if (args.includes("--state") && args.includes("open") && !args.includes("--label")) {
      return openBacklog;
    }
    throw new Error(`unexpected_gh_json_call:${args.join(" ")}`);
  };
}

test("buildBrainstormContextFromShellIntake projects shell-selected intake issue", () => {
  const out = buildBrainstormContextFromShellIntake({
    repo: "example-org/example-notes",
    factoryId: "brainstorm",
    rootDir: ".",
    intakeJson: JSON.stringify({
      issue_selector: { labels: ["hatch:intake"] },
      has_issue: true,
      issue: {
        number: 77,
        source_issue_id: "77",
        title: "seed",
        body: "seed body",
        labels: ["hatch:intake"],
      },
    }),
    ghJsonFn: makeGhJsonStub({
      closedGoals: [
        { number: 99, title: "Goal", url: "https://github.com/recallnet/astrochicken/issues/99", closedAt: "2026-03-16T00:00:00Z" },
      ],
      openBacklog: [
        { number: 77, state: "open", labels: [{ name: "brainstorm" }] },
      ],
    }),
    readCursorFn: () => ({
      schema: "brainstorm-cursor/v1",
      last_brainstorm_issue_number: "70",
      scenario_holdouts_snapshot: "[]",
    }),
  });

  assert.equal(out.has_issue, "true");
  assert.equal(out.brainstorm_issue_number, "77");
  assert.equal(out.brainstorm_issue_body, "seed body");
  assert.equal(out.parse_error, "");
});

test("buildBrainstormContextFromShellIntake fails closed when intake selector labels are missing", () => {
  const out = buildBrainstormContextFromShellIntake({
    repo: "example-org/example-notes",
    intakeJson: JSON.stringify({ issue_selector: { labels: [] } }),
  });

  assert.equal(out.has_issue, "false");
  assert.equal(out.parse_error, "missing_issue_selector_labels");
});
