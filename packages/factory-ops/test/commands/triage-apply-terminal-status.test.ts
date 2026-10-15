import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { applyTriageDeferred, applyTriageDuplicate } from "../../src/commands/triage-apply-terminal-status.ts";
import { FACTORY_OPS_ERROR_CODES } from "../../src/lib/error-catalog.ts";

test("applyTriageDuplicate comments when duplicate_of is present and closes issue", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = applyTriageDuplicate({
    repo: "recallnet/astrochicken",
    issueNumber: "44",
    duplicateOf: "12",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "issue", "comment", "44", "--repo", "recallnet/astrochicken", "--body", "Duplicate of #12. Closing.",
  ]);
  assert.deepEqual(calls[1], [
    "issue", "close", "44", "--repo", "recallnet/astrochicken", "--reason", "not_planned",
  ]);
});

test("applyTriageDeferred adds deferred labels and optional note", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = applyTriageDeferred({
    repo: "recallnet/astrochicken",
    issueNumber: "55",
    notes: "Needs upstream design first",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "issue", "edit", "55", "--repo", "recallnet/astrochicken", "--add-label", "triaged", "--add-label", "deferred",
  ]);
  assert.deepEqual(calls[1], [
    "issue", "comment", "55", "--repo", "recallnet/astrochicken", "--body", "Deferred during triage: Needs upstream design first",
  ]);
});

test("applyTriageDuplicate rejects missing args with catalog-backed code", () => {
  const out = applyTriageDuplicate({ repo: "", issueNumber: "" });

  assert.equal(out.ok, false);
  assert.equal(out.error_code, FACTORY_OPS_ERROR_CODES.missing_args);
});
