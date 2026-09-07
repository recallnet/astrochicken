import assert from "node:assert/strict";
import test from "node:test";

import { applyRejectedUpstream, applyTriageStatus } from "../../src/commands/triage-apply-status.ts";
import { FACTORY_OPS_ERROR_CODES } from "../../src/lib/error-catalog.ts";

test("applyTriageStatus applies triaged label for accept without milestone mutation", () => {
  const calls = [];
  const runGhFn = (args) => {
    calls.push(args);
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 123,
    status: "accept",
    runGhFn,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["issue", "edit", "123", "--repo", "recallnet/astrochicken", "--add-label", "triaged"]);
  assert.ok(!calls.some((args) => args.includes("--milestone")));
});

test("applyTriageStatus blocked adds triaged label without comment (native relationships)", () => {
  const calls = [];
  const runGhFn = (args) => {
    calls.push(args);
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 123,
    status: "blocked",
    blockedByRaw: "[]",
    runGhFn,
  });

  assert.equal(out.ok, true);
  // No comment calls — blocking uses GitHub native blocked-by relationships
  const commentCall = calls.find((c) => c[0] === "issue" && c[1] === "comment");
  assert.equal(commentCall, undefined);
});

test("applyTriageStatus adds triaged label for control-plane blockers without comment or label", () => {
  const calls = [];
  const runGhFn = (args) => {
    calls.push(args);
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 456,
    status: "blocked",
    blockedByRaw: "[123]",
    notes: 'control_plane_blocker.v1:{"kind":"upstream_bug","blockerRef":"#1234","unblockCondition":"release v1.2 ships","status":"blocked"}',
    runGhFn,
  });

  assert.equal(out.ok, true);
  // No blocked-control-plane label — blocking uses native GitHub relationships
  assert.ok(!calls.some((args) => args.includes("blocked-control-plane")));
  // No comment calls — blocking metadata handled via native relationships
  const commentCall = calls.find((args) => args[0] === "issue" && args[1] === "comment");
  assert.equal(commentCall, undefined);
});

test("applyTriageStatus does not add or remove blocked-control-plane label for resolved blockers", () => {
  const calls = [];
  const runGhFn = (args) => {
    calls.push(args);
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 789,
    status: "blocked",
    notes: 'control_plane_blocker.v1:{"kind":"release_floor","blockerRef":"v2.0.0","unblockCondition":"superseded by v2.1.0","status":"superseded"}',
    runGhFn,
  });

  assert.equal(out.ok, true);
  // No label operations for blocked-control-plane at all
  assert.ok(!calls.some((args) => args.includes("blocked-control-plane")));
});

test("applyRejectedUpstream closes issue with rejected blocker metadata and not-planned state reason", () => {
  const calls = [];
  const runGhFn = (args, stdin = "") => {
    calls.push({ args, stdin });
    if (args[0] === "issue" && args[1] === "view") {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          state: "OPEN",
          labels: [{ name: "blocked-control-plane" }],
        }),
        stderr: "",
      };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };

  const out = applyRejectedUpstream({
    repo: "recallnet/astrochicken",
    issue: 900,
    blockerRef: "#1555",
    runGhFn,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, false);
  assert.equal(out.issueNumber, 900);

  const commentCall = calls.find((call) => call.args[0] === "issue" && call.args[1] === "comment");
  assert.ok(commentCall, "expected rejected status comment");
  assert.match(commentCall.args.join(" "), /control_plane_blocker\.v1:/);
  assert.match(commentCall.args.join(" "), /"status":"rejected"/);
  assert.match(commentCall.args.join(" "), /"blockerRef":"#1555"/);

  const removeCall = calls.find((call) => call.args[0] === "issue" && call.args[1] === "edit" && call.args.includes("--remove-label"));
  assert.ok(removeCall, "expected blocked-control-plane removal");

  const addNotPlannedCall = calls.find((call) => call.args[0] === "issue" && call.args[1] === "edit" && call.args.includes("--add-label") && call.args.includes("not-planned"));
  assert.ok(addNotPlannedCall, "expected not-planned label add");

  const closeCall = calls.find((call) => call.args[0] === "api" && call.args[2] === "PATCH");
  assert.ok(closeCall, "expected issue close patch call");
  assert.match(closeCall.stdin, /"state":"closed"/);
  assert.match(closeCall.stdin, /"state_reason":"not_planned"/);
});

test("applyTriageStatus missing args return catalog-backed error code", () => {
  const out = applyTriageStatus({
    repo: "",
    issueNumber: "",
    status: "",
  });

  assert.equal(out.ok, false);
  assert.equal(out.error_code, FACTORY_OPS_ERROR_CODES.missing_args);
});

test("applyRejectedUpstream issue view failures return catalog-backed error code", () => {
  const out = applyRejectedUpstream({
    repo: "recallnet/astrochicken",
    issue: 11,
    runGhFn: () => ({ ok: false, stdout: "", stderr: "boom" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.error_code, FACTORY_OPS_ERROR_CODES.triage_issue_view_failed);
});
