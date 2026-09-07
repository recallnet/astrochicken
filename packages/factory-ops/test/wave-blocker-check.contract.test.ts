import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyRejectedUpstream } from "../src/commands/triage-apply-status.ts";
import { checkControlPlaneBlocker } from "../src/commands/wave-blocker-check.ts";
import { FACTORY_OPS_ERROR_CODES } from "../src/lib/error-catalog.ts";

function createIssueViewResult({ state = "OPEN", labels = [] } = {}) {
  return {
    state,
    labels: labels.map((name) => ({ name })),
  };
}

function createComment(body = "") {
  return { body };
}

test("checkControlPlaneBlocker returns blocker_active=true for unresolved blocker comment", async () => {
  const calls = [];
  const ghJsonFn = (args) => {
    calls.push(args);
    const command = Array.isArray(args) ? args.join(" ") : "";
    if (command.startsWith("issue view")) {
      return createIssueViewResult({ labels: ["blocked-control-plane"] });
    }
    if (command.startsWith("api repos/recallnet/astrochicken/issues/42/comments")) {
      return [
        createComment("control_plane_blocker.v1:{\"kind\":\"upstream_bug\",\"blockerRef\":\"#777\",\"unblockCondition\":\"Wait for upstream bug #777 to close.\",\"status\":\"blocked\"}"),
      ];
    }
    return [];
  };

  const out = await checkControlPlaneBlocker({
    repo: "recallnet/astrochicken",
    issue: 42,
    ghJsonFn,
  });

  assert.equal(out.blocker_active, true);
  assert.equal(out.kind, "upstream_bug");
  assert.equal(out.blockerRef, "#777");
  assert.equal(out.unblockCondition, "Wait for upstream bug #777 to close.");
  assert.equal(out.status, "blocked");
  const commentCalls = calls.filter((args) => String(args[0]) === "api" && /\/comments\?/.test(String(args[1] || "")));
  assert.equal(commentCalls.length, 1);
  assert.match(String(commentCalls[0][1] || ""), /page=1/);
});

test("checkControlPlaneBlocker returns blocker_active=false for resumed blocker", async () => {
  const ghJsonFn = (args) => {
    const command = Array.isArray(args) ? args.join(" ") : "";
    if (command.startsWith("issue view")) {
      return createIssueViewResult({ labels: [] });
    }
    if (command.startsWith("api repos/recallnet/astrochicken/issues/43/comments")) {
      return [
        createComment("control_plane_blocker.v1:{\"kind\":\"upstream_bug\",\"blockerRef\":\"#777\",\"unblockCondition\":\"resolved\",\"status\":\"resumed\"}"),
      ];
    }
    return [];
  };

  const out = await checkControlPlaneBlocker({
    repo: "recallnet/astrochicken",
    issue: 43,
    ghJsonFn,
  });

  assert.equal(out.blocker_active, false);
  assert.equal(out.status, "resumed");
});

test("checkControlPlaneBlocker returns blocker_active=false with status=null when no blocker exists", async () => {
  const ghJsonFn = (args) => {
    const command = Array.isArray(args) ? args.join(" ") : "";
    if (command.startsWith("issue view")) {
      return createIssueViewResult({ labels: [] });
    }
    if (command.startsWith("api repos/recallnet/astrochicken/issues/44/comments")) {
      return [];
    }
    return [];
  };

  const out = await checkControlPlaneBlocker({
    repo: "recallnet/astrochicken",
    issue: 44,
    ghJsonFn,
  });

  assert.equal(out.blocker_active, false);
  assert.equal(out.status, null);
});

test("applyRejectedUpstream is idempotent for already-closed issues", () => {
  const calls = [];
  const runGhFn = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify(createIssueViewResult({ state: "CLOSED", labels: [] })),
        stderr: "",
      };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyRejectedUpstream({
    repo: "recallnet/astrochicken",
    issue: 55,
    blockerRef: "#999",
    runGhFn,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "issue",
    "view",
    "55",
    "--repo",
    "recallnet/astrochicken",
    "--json",
    "state,labels",
  ]);
});

test("wave_execute includes check_cp_blocker before lock and defines cp_blocked_exit as exit", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  const checkIndex = dot.indexOf("check_cp_blocker");
  const lockIndex = dot.indexOf("lock_wave");
  assert.ok(checkIndex > -1, "check_cp_blocker must exist");
  assert.ok(lockIndex > -1, "lock_wave must exist");
  assert.ok(checkIndex < lockIndex, "check_cp_blocker must appear before lock_wave");
  assert.match(dot, /cp_blocked_exit \[type="exit" label="cp_blocked"\]/);
  assert.match(dot, /check_cp_blocker -> cp_blocked_exit \[condition="blocker_active=true"\]/);
});

test("checkControlPlaneBlocker uses catalog-backed missing_args code", async () => {
  const out = await checkControlPlaneBlocker({ repo: "", issue: 0 });

  assert.equal(out.error_code, FACTORY_OPS_ERROR_CODES.missing_args);
});
