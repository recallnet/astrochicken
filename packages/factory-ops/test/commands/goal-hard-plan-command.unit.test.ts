import assert from "node:assert/strict";
import test from "node:test";

import {
  attachGoalHardPlanPacket,
  inspectGoalHardPlanPacketAttachment,
  parseGoalHardPlanAttachmentInput,
  upsertGoalHardPlanComment,
} from "../../src/commands/goal-hard-plan-packet.ts";

test("parseGoalHardPlanAttachmentInput validates required fields", () => {
  assert.throws(() => parseGoalHardPlanAttachmentInput({
    goalNumber: "2200",
    planId: "plan-1",
    summary: "",
    artifactRefsRaw: JSON.stringify([{ path: "a.md" }]),
  }), /requires --summary/);

  assert.throws(() => parseGoalHardPlanAttachmentInput({
    goalNumber: "2200",
    planId: "plan-1",
    summary: "summary",
    artifactRefsRaw: "[]",
  }), /requires artifact refs/);
});

test("upsertGoalHardPlanComment updates existing marker comment", () => {
  const calls = [];
  const out = upsertGoalHardPlanComment({
    repo: "recallnet/astrochicken",
    goalNumber: "2200",
    body: "<!-- goal-hard-plan:v1 goal=2200 packet=plan-1 -->\nupdated",
    ghJsonFn: (args) => {
      calls.push(args);
      return [{
        id: 123,
        html_url: "https://example.com/comment/123",
        body: "<!-- goal-hard-plan:v1 goal=2200 packet=plan-1 -->\nold",
      }];
    },
    ghExec: (args, opts = {}) => {
      calls.push(args);
      assert.equal(args[0], "api");
      assert.match(args[1], /issues\/comments\/123/);
      assert.equal(args[2], "-X");
      assert.equal(args[3], "PATCH");
      const payload = JSON.parse(String(opts?.input || "{}"));
      assert.match(payload.body, /goal-hard-plan:v1/);
      return {
        ok: true,
        stdout: JSON.stringify({ id: 123, html_url: "https://example.com/comment/123" }),
        stderr: "",
      };
    },
  });

  assert.equal(out.action, "updated");
  assert.equal(out.comment_id, "123");
  assert.ok(calls.length >= 2);
});

test("attachGoalHardPlanPacket can skip human-review hold when explicitly disabled", () => {
  const calls = [];
  const out = attachGoalHardPlanPacket({
    repoRoot: process.cwd(),
    repo: "recallnet/astrochicken",
    goalNumber: "2201",
    planId: "plan-no-hold",
    summary: "No hold path",
    artifactRefsRaw: JSON.stringify([{ path: "artifacts/plan.md" }]),
    holdForHumanReview: false,
    ghJsonFn: () => [],
    ghExec: (args, opts = {}) => {
      calls.push(args);
      if (args[0] === "api" && args[3] === "POST") {
        const payload = JSON.parse(String(opts?.input || "{}"));
        assert.match(payload.body, /goal-hard-plan:v1/);
        return {
          ok: true,
          stdout: JSON.stringify({ id: 457, html_url: "https://example.com/comment/457" }),
          stderr: "",
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.awaiting_review, false);
  assert.equal(out.awaiting_review_marker, "");
  assert.equal(calls.some((call) => call[0] === "issue" && call[1] === "edit"), false);
});

test("attachGoalHardPlanPacket persists packet and creates deterministic marker comment", () => {
  const ghCalls = [];
  const repoRoot = process.cwd();
  const out = attachGoalHardPlanPacket({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: "2200",
    planId: "plan-2",
    summary: "Attach hard plan summary",
    artifactRefsRaw: JSON.stringify([
      { label: "plan", url: "https://example.com/plan.md" },
    ]),
    factoryId: "mothership",
    ghJsonFn: () => [],
    ghExec: (args, opts = {}) => {
      ghCalls.push(args);
      if (args[0] === "api" && args[3] === "POST") {
        const payload = JSON.parse(String(opts?.input || "{}"));
        assert.match(payload.body, /<!-- goal-hard-plan:v1 goal=2200 packet=plan-2 -->/);
        assert.match(payload.body, /plan_summary=Attach hard plan summary/);
        return {
          ok: true,
          stdout: JSON.stringify({
            id: 456,
            html_url: "https://github.com/recallnet/astrochicken/issues/2200#issuecomment-456",
          }),
          stderr: "",
        };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.goal_number, "2200");
  assert.equal(out.packet_id, "plan-2");
  assert.equal(out.comment_action, "created");
  assert.equal(out.comment_id, "456");
  assert.match(out.comment_marker, /goal-hard-plan:v1 goal=2200 packet=plan-2/);
  assert.equal(out.awaiting_review, true);
  assert.match(out.awaiting_review_marker, /goal-run:awaiting-review/);
  assert.match(out.packet_path, /\.hatch\/mothership\/packets\/goal_hard_plan_packet\/plan-2\.json$/);
  assert.ok(ghCalls.some((call) => call[0] === "api" && call[3] === "POST"));
  assert.ok(ghCalls.some((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-label") && call.includes("awaiting-human")));
  assert.ok(ghCalls.some((call) => call[0] === "issue" && call[1] === "comment" && String(call[6] || "").includes("goal-run:awaiting-review")));

  const inspected = inspectGoalHardPlanPacketAttachment({
    repoRoot,
    goalNumber: "2200",
    factoryId: "mothership",
  });
  assert.equal(inspected.attached, true);
  assert.equal(inspected.packet_id, "plan-2");
  assert.equal(inspected.goal_issue_comment_id, "456");
});
