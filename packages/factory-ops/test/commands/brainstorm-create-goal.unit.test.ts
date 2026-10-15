import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { createBrainstormGoalIssue } from "../../src/commands/brainstorm-create-goal.ts";

test("createBrainstormGoalIssue creates issue from final report", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2021\n");
  };

  const out = createBrainstormGoalIssue({
    destinationsJson: JSON.stringify({
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["source:brainstorm", "goal", "managed"],
      },
    }),
    brainstormIssueNumber: "2019",
    seedPrompt: "highest ROI goal given current state",
    finalRound: "3",
    finalReportRaw: JSON.stringify({
      proposal: "Improve deterministic brainstorm loop",
      success_criteria: ["loop exits early on convergence"],
      scope_in: ["bump-round contract"],
      scope_out: ["consumer integration"],
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.goal_issue_number, "2021");
  assert.equal(out.ready_label_applied, "false");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 4), ["issue", "create", "--repo", "recallnet/astrochicken"]);

  const labels = [];
  for (let i = 0; i < calls[0].length; i += 1) {
    if (calls[0][i] === "--label") labels.push(calls[0][i + 1]);
  }
  assert.deepEqual(labels.sort(), ["goal", "managed", "source:brainstorm"].sort());

  const bodyIndex = calls[0].indexOf("--body");
  const body = calls[0][bodyIndex + 1];
  assert.match(body, /^## Goal\n/m);
  assert.match(body, /Improve deterministic brainstorm loop/);
  assert.match(body, /^## Success Criteria\n/m);
  assert.match(body, /loop exits early on convergence/);
  assert.match(body, /^## Scope In\n/m);
  assert.match(body, /^## Scope Out\n/m);
  assert.match(body, /^## Constraints\n/m);
  assert.match(body, /^## References\n/m);
});

test("createBrainstormGoalIssue falls back to explicit repo for legacy callers", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2021\n");
  };

  createBrainstormGoalIssue({
    repo: "recallnet/astrochicken",
    brainstormIssueNumber: "2019",
    seedPrompt: "highest ROI goal given current state",
    finalReportRaw: JSON.stringify({ proposal: "X", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
    ghExec,
  });

  const labels = [];
  for (let i = 0; i < calls[0].length; i += 1) {
    if (calls[0][i] === "--label") labels.push(calls[0][i + 1]);
  }
  assert.deepEqual(labels.sort(), ["goal", "source:brainstorm"].sort());
});

test("createBrainstormGoalIssue fails closed on missing destination route", () => {
  assert.throws(() => createBrainstormGoalIssue({
    destinationsJson: JSON.stringify({}),
    brainstormIssueNumber: "2019",
    seedPrompt: "seed",
    finalReportRaw: JSON.stringify({ proposal: "X", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
  }), /missing destinations\.goal_issues route/);
});

test("createBrainstormGoalIssue fails closed on missing required context", () => {
  assert.throws(() => createBrainstormGoalIssue({
    repo: "",
    brainstormIssueNumber: "2019",
    seedPrompt: "seed",
    finalReportRaw: JSON.stringify({ proposal: "X", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
  }), /missing_repo/);
});

test("createBrainstormGoalIssue fails closed on malformed final report json", () => {
  assert.throws(() => createBrainstormGoalIssue({
    repo: "recallnet/astrochicken",
    brainstormIssueNumber: "2019",
    seedPrompt: "seed",
    finalReportRaw: "not-json",
  }), /malformed_final_report_json/);
});

test("createBrainstormGoalIssue surfaces gh create failures", () => {
  assert.throws(() => createBrainstormGoalIssue({
    repo: "recallnet/astrochicken",
    brainstormIssueNumber: "2019",
    seedPrompt: "seed",
    finalReportRaw: JSON.stringify({ proposal: "X", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
    ghExec: () => ({ ok: false, stderr: "forbidden", stdout: "" }),
  }), /issue_create_failed:forbidden/);
});

test("createBrainstormGoalIssue uses proposal as title", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/99\n");
  };

  createBrainstormGoalIssue({
    repo: "example-org/test",
    brainstormIssueNumber: "1",
    seedPrompt: "seed",
    finalReportRaw: JSON.stringify({ proposal: "Ship the overnight lab", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
    ghExec,
  });

  const titleIndex = calls[0].indexOf("--title");
  assert.match(calls[0][titleIndex + 1], /Goal: Ship the overnight lab/);
});
