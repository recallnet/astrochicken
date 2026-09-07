// triage-goal-intake-completeness.contract.test.mjs
//
// Contract tests ensuring:
// 1. Goal intake creates COMPLETE issues — no silent issue dropping
// 2. Relationship metadata (blocked_by, blocking_issues) is fully resolved to numeric issue numbers
// 3. Every deterministic gate fails CLOSED on garbage input — never silently succeeds

import assert from "node:assert/strict";
import test from "node:test";

import { applyTriageStatus } from "../../src/commands/triage-apply-status.ts";
import { syncBlockedBy } from "../../src/commands/triage-sync-blocked-by.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";


// ============================================================================
// zipFeaturesToIssues: no issue dropping
// ============================================================================
// Root cause of the goal-1938 incident: write_issues created 3 GitHub issues
// but issue_urls was empty [], so zip_features produced a feature_issue_map
// with issue_number: "" for all entries. The triage LLM had no real issue
// numbers and used feature slugs "F-1", "F-2", "F-3" — which poisoned
// every downstream step.

test("zipFeaturesToIssues — every output entry must have a positive integer issue_number", () => {
  const features = JSON.stringify([{ id: "F-1" }, { id: "F-2" }, { id: "F-3" }]);
  const issues = JSON.stringify([
    { issue_number: 100, url: "https://github.com/o/r/issues/100" },
    { issue_number: 101, url: "https://github.com/o/r/issues/101" },
    { issue_number: 102, url: "https://github.com/o/r/issues/102" },
  ]);
  const out = zipFeaturesToIssues({ featuresRaw: features, issueIndexRaw: issues });
  assert.equal(out.length, 3);
  for (const entry of out) {
    assert.ok(
      Number.isFinite(entry.issue_number) && entry.issue_number > 0,
      `feature ${entry.feature?.id} has invalid issue_number: ${JSON.stringify(entry.issue_number)}`,
    );
  }
});

test("zipFeaturesToIssues — drops entries when issue_index is shorter than features (no garbage pass-through)", () => {
  // 3 features but only 1 issue URL came back from write_issues.
  // Must fail-closed: only emit entries with valid issue mappings.
  const features = JSON.stringify([{ id: "F-1" }, { id: "F-2" }, { id: "F-3" }]);
  const issues = JSON.stringify([{ issue_number: 100, url: "https://github.com/o/r/issues/100" }]);
  const out = zipFeaturesToIssues({ featuresRaw: features, issueIndexRaw: issues });
  for (const entry of out) {
    assert.ok(
      Number.isFinite(entry.issue_number) && entry.issue_number > 0,
      `feature ${entry.feature?.id} silently dropped — has invalid issue_number: ${JSON.stringify(entry.issue_number)}`,
    );
  }
  assert.equal(out.length, 1, "only entries with valid issue_number should be emitted");
});

test("zipFeaturesToIssues — drops entries when issue_index has empty issue_number entries", () => {
  // This is exactly what happened in the goal-1938 incident:
  // issue_index had entries but with issue_number: ""
  const features = JSON.stringify([{ id: "F-1" }, { id: "F-2" }]);
  const issues = JSON.stringify([
    { issue_number: "", url: "" },
    { issue_number: "", url: "" },
  ]);
  const out = zipFeaturesToIssues({ featuresRaw: features, issueIndexRaw: issues });
  for (const entry of out) {
    assert.ok(
      Number.isFinite(entry.issue_number) && entry.issue_number > 0,
      `feature ${entry.feature?.id} has empty issue_number — triage will use feature slugs instead`,
    );
  }
  assert.equal(out.length, 0, "entries with empty issue_number must be filtered out");
});

test("zipFeaturesToIssues — returns empty when issue_index is empty but features exist", () => {
  const features = JSON.stringify([{ id: "F-1" }]);
  const issues = JSON.stringify([]);
  const out = zipFeaturesToIssues({ featuresRaw: features, issueIndexRaw: issues });
  for (const entry of out) {
    assert.ok(
      Number.isFinite(entry.issue_number) && entry.issue_number > 0,
      `feature ${entry.feature?.id} has no issue mapping`,
    );
  }
  assert.equal(out.length, 0, "no valid entries means empty output");
});

// ============================================================================
// syncBlockedBy: fail-closed on non-numeric issue
// ============================================================================
// syncBlockedBy must return an error indicator when given a non-numeric
// issueNumber so the pipeline doesn't silently continue.

test("syncBlockedBy — signals error when issueNumber is non-numeric", () => {
  // Number("F-1") = NaN → early return with no error signal.
  // This must return an error indicator so the pipeline doesn't silently continue.
  const out = syncBlockedBy({ repo: "o/r", issueNumber: "F-1", blockedByRaw: "[]" });
  assert.ok(
    out.error === true || out.ok === false,
    `syncBlockedBy must explicitly signal failure for non-numeric issue, got: ${JSON.stringify(out)}`,
  );
});

test("syncBlockedBy — signals error when issueNumber is empty string", () => {
  const out = syncBlockedBy({ repo: "o/r", issueNumber: "", blockedByRaw: "[1,2]" });
  assert.ok(
    out.error === true || out.ok === false,
    `syncBlockedBy must explicitly signal failure for empty issue, got: ${JSON.stringify(out)}`,
  );
});

// ============================================================================
// applyTriageStatus: returns ok=false for non-numeric issue_number
// ============================================================================

test("applyTriageStatus — returns ok=false for non-numeric issue_number", () => {
  const out = applyTriageStatus({
    repo: "o/r",
    issueNumber: "F-1",
    status: "accept",
    runGhFn: () => ({ ok: true, stdout: "", stderr: "" }),
  });
  assert.equal(out.ok, false, "applyTriageStatus must reject non-numeric issue");
});

test("applyTriageStatus — returns ok=false for empty issue_number", () => {
  const out = applyTriageStatus({
    repo: "o/r",
    issueNumber: "",
    status: "accept",
    runGhFn: () => ({ ok: true, stdout: "", stderr: "" }),
  });
  assert.equal(out.ok, false, "applyTriageStatus must reject empty issue");
});
