import assert from "node:assert/strict";
import test from "node:test";

import {
  setResearchApprovalLabel,
  setResearchStageLabel,
} from "../../src/commands/research-stage-label.ts";

test("setResearchStageLabel validates required args", () => {
  const missingRepo = setResearchStageLabel({
    repo: "",
    hypothesisIssue: "1",
    stage: "backtesting",
  });
  assert.equal(missingRepo.ok, false);
  assert.equal(missingRepo.code, "missing_repo");

  const invalidIssue = setResearchStageLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "0",
    stage: "backtesting",
  });
  assert.equal(invalidIssue.ok, false);
  assert.equal(invalidIssue.code, "invalid_hypothesis_issue");

  const invalidStage = setResearchStageLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "1",
    stage: "bad_stage",
  });
  assert.equal(invalidStage.ok, false);
  assert.equal(invalidStage.code, "invalid_stage");
});

test("setResearchStageLabel removes prior stage labels and applies new stage label", () => {
  const calls = [];
  const out = setResearchStageLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "22",
    stage: "backtesting",
    ghJsonExec: () => ({
      ok: true,
      data: {
        labels: [{ name: "research:stage/hypothesis_formulation" }, { name: "ready" }],
      },
    }),
    ghExec: (args) => {
      calls.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "ok");
  assert.equal(out.label, "research:stage/backtesting");
  assert.equal(out.issueNumber, 22);

  const removeCall = calls.find((args) => args.includes("--remove-label"));
  assert.ok(removeCall, "expected stage label removal call");
  assert.ok(removeCall.includes("research:stage/hypothesis_formulation"));

  const addCall = calls.find((args) => args.includes("--add-label"));
  assert.ok(addCall, "expected stage label add call");
  assert.ok(addCall.includes("research:stage/backtesting"));
});

test("setResearchStageLabel returns label_not_found when repo lacks target label", () => {
  const out = setResearchStageLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "1",
    stage: "backtesting",
    ghJsonExec: () => ({ ok: true, data: { labels: [] } }),
    ghExec: () => ({ ok: false, status: 1, stdout: "", stderr: "label not found" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "label_not_found");
  assert.equal(out.label, "research:stage/backtesting");
});

test("setResearchApprovalLabel applies approved label and posts structured comment", () => {
  const calls = [];
  const out = setResearchApprovalLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "31",
    approved: true,
    approvalContext: {
      stage_id: "backtesting",
      approval_state: "approved",
      reviewer_id: "alice",
    },
    ghExec: (args) => {
      calls.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.code, "ok");
  assert.equal(out.label, "research:approval/approved");
  assert.equal(out.comment_posted, true);

  const editCall = calls.find((args) => args[0] === "issue" && args[1] === "edit") || [];
  assert.ok(editCall.includes("--add-label"));
  assert.ok(editCall.includes("research:approval/approved"));
  assert.ok(editCall.includes("--remove-label"));
  assert.ok(editCall.includes("research:approval/pending"));

  const commentCall = calls.find((args) => args[0] === "issue" && args[1] === "comment") || [];
  assert.ok(commentCall.includes("--body"));
  const body = commentCall[commentCall.indexOf("--body") + 1] || "";
  assert.match(body, /<!-- research-approval-context -->/);
  assert.match(body, /"stage_id": "backtesting"/);
  assert.match(body, /"approval_label": "research:approval\/approved"/);
});

test("setResearchApprovalLabel writes pending label when approval_state=pending", () => {
  const calls = [];
  const out = setResearchApprovalLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "31",
    approved: false,
    approvalContext: {
      stage_id: "backtesting",
      approval_state: "pending",
    },
    ghExec: (args) => {
      calls.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.label, "research:approval/pending");
  const editCall = calls.find((args) => args[0] === "issue" && args[1] === "edit") || [];
  assert.ok(editCall.includes("research:approval/pending"));
  assert.ok(editCall.includes("research:approval/approved"));
  assert.ok(editCall.includes("research:approval/rejected"));
});

test("setResearchApprovalLabel returns label_not_found and comment_posted=false when label missing", () => {
  const out = setResearchApprovalLabel({
    repo: "example-org/example-research",
    hypothesisIssue: "31",
    approved: true,
    approvalContext: { stage_id: "backtesting" },
    ghExec: () => ({ ok: false, status: 1, stdout: "", stderr: "label not found" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "label_not_found");
  assert.equal(out.comment_posted, false);
  assert.equal(out.label, "research:approval/approved");
});
