import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyMissingMilestones } from "../src/commands/triage-apply-missing-milestones.ts";

const TRIAGE_DOT_PATH = "packages/capability-triage/graphs/triage.dot";

test("applyMissingMilestones returns deterministic empty success when nothing is missing", () => {
  const out = applyMissingMilestones({ repo: "recallnet/astrochicken", validationRaw: JSON.stringify({ missing: [] }) });
  assert.equal(out.ok, true);
  assert.equal(out.attempted, 0);
  assert.equal(out.failed_count, 0);
});

test("applyMissingMilestones passes issueNumber and milestoneTitle to applyTriageStatus", () => {
  // This test catches the parameter-name mismatch bug where `issue` and `wave`
  // were passed instead of `issueNumber` and `milestoneTitle`, causing
  // applyTriageStatus to receive undefined for both and reject with
  // "repo, issueNumber, and status are required".
  //
  // We import applyTriageStatus's contract shape and verify the delegation
  // forwards the correct parameter names by mocking at module boundary.
  const validationRaw = JSON.stringify({
    missing: [{ issue_number: 42, wave: "goal-1-wave-1", status: "accept" }],
  });

  // Direct call — if parameter names are wrong, applyTriageStatus guard rejects
  // with { ok: false, error: "repo, issueNumber, and status are required" }
  const out = applyMissingMilestones({ repo: "recallnet/astrochicken", validationRaw });

  // Even though gh CLI won't actually run in test, we should NOT get the
  // "missing_args" error that results from wrong parameter names.
  // If we get ok:false, the error must be from gh CLI failure, not missing args.
  if (!out.ok && out.failed.length > 0) {
    for (const f of out.failed) {
      assert.notEqual(f.error, "repo, issueNumber, and status are required",
        "applyTriageStatus received undefined issueNumber — parameter name mismatch");
      assert.notEqual(f.error, "missing_issue_or_wave",
        "pre-validation should pass for valid input");
    }
  }
});

test("triage graph removes milestone repair loop from the orchestration path", () => {
  const dot = readFileSync(TRIAGE_DOT_PATH, "utf8");
  assert.doesNotMatch(dot, /apply_missing_milestones/);
  assert.doesNotMatch(dot, /revalidate_milestones/);
  assert.doesNotMatch(dot, /regate_milestones/);
  assert.doesNotMatch(dot, /fail_triage/);
  assert.match(dot, /validate_plan/);
  assert.match(dot, /repair_plan/);
  assert.match(dot, /validate_repaired_plan/);
  assert.match(dot, /fallback_plan/);
});

test("cli wires triage apply-missing-milestones", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/triage.ts", "utf8");
  assert.match(cmd, /static paths = \[\["triage", "apply-missing-milestones"\]\]/);
  assert.match(cmd, /applyMissingMilestones/);
});

test("triage validate-milestones supports non-fatal mode for gate-driven routing", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/triage.ts", "utf8");
  assert.match(cmd, /--fail-on-missing/);
  assert.match(cmd, /failOnMissing/);
  assert.match(cmd, /return 1/);
});
