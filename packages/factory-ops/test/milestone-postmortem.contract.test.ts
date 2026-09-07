import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeGiveUp, classifyGiveUp } from "../src/commands/milestone-postmortem.ts";

test("classifyGiveUp: scope mismatch detected", () => {
  assert.equal(
    classifyGiveUp({ reviewNotes: "Scope mismatch with issue #387. The branch changes are focused on wave dispatch." }),
    "scope_mismatch",
  );
  assert.equal(
    classifyGiveUp({ reviewNotes: "The changes are unrelated changes to the reconciler." }),
    "scope_mismatch",
  );
});

test("classifyGiveUp: QA infrastructure failure detected", () => {
  assert.equal(
    classifyGiveUp({ reviewNotes: "Return revise and include QA_EVIDENCE_REQUIRED in review_notes." }),
    "qa_infrastructure",
  );
  assert.equal(
    classifyGiveUp({ reviewNotes: "Evidence artifact is missing, return EVIDENCE_MISSING." }),
    "qa_infrastructure",
  );
});

test("classifyGiveUp: stale branch detected", () => {
  assert.equal(
    classifyGiveUp({ reviewNotes: "No commits ahead of main were detected for this issue branch." }),
    "stale_branch",
  );
});

test("classifyGiveUp: legitimate revise (code quality)", () => {
  assert.equal(
    classifyGiveUp({ reviewNotes: "ghJson() turns any GitHub CLI failure into [], hiding reconciliation failure. Please surface fetch failures." }),
    "legitimate_revise",
  );
});

test("classifyGiveUp: empty notes returns unknown", () => {
  assert.equal(classifyGiveUp({ reviewNotes: "" }), "unknown");
  assert.equal(classifyGiveUp({}), "unknown");
});

test("analyzeGiveUp: qa infra give-up classifies and returns no bug", () => {
  const out = analyzeGiveUp({
    repo: "recallnet/astrochicken",
    issueNumber: "630",
    branch: "wave/goal-611-wave-2",
    reviewNotes: "QA_EVIDENCE_REQUIRED: qa.status=fail",
    worktreeDir: "/tmp/wave-630",
    reviewEvidencePath: "packages/factory-ops/test/fixtures/milestone-postmortem/qa-infra-review-evidence.json",
  });

  assert.equal(out.classification, "qa_infrastructure");
  assert.equal(out.bug_filed, false);
  assert.equal(out.bug_url, "");
});

test("analyzeGiveUp: qa infra give-up with missing command classifies and returns no bug", () => {
  const out = analyzeGiveUp({
    repo: "recallnet/astrochicken",
    issueNumber: "630",
    branch: "wave/goal-611-wave-2",
    reviewNotes: "QA_EVIDENCE_REQUIRED: qa.command missing",
    worktreeDir: "/tmp/wave-630",
    reviewEvidencePath: "packages/factory-ops/test/fixtures/milestone-postmortem/qa-infra-missing-command.json",
  });

  assert.equal(out.classification, "qa_infrastructure");
  assert.equal(out.bug_filed, false);
  assert.equal(out.bug_url, "");
});

test("analyzeGiveUp: review notes without stale-branch keywords classifies as legitimate_revise and returns no bug", () => {
  const out = analyzeGiveUp({
    repo: "recallnet/astrochicken",
    issueNumber: "1175",
    branch: "wave/goal-1175-wave-1",
    reviewNotes: "Reviewer asked for a narrower helper extraction, but evidence shows the branch disappeared.",
    worktreeDir: "/tmp/wave-1175",
    reviewEvidencePath: join(process.cwd(), "packages/factory-ops/test/fixtures/milestone-postmortem/stale-branch-review-evidence.json"),
  });

  // reviewNotes text does not match stale_branch patterns (no commits ahead, no code changes, stale branch),
  // so classifyGiveUp returns legitimate_revise. analyzeGiveUp only classifies; it does not file bugs.
  assert.equal(out.classification, "legitimate_revise");
  assert.equal(out.bug_filed, false);
  assert.equal(out.bug_url, "");
});

test("analyzeGiveUp persists incident packet before returning", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "milestone-postmortem-packet-"));
  const out = analyzeGiveUp({
    repo: "recallnet/astrochicken",
    issueNumber: "2042",
    branch: "wave/goal-2042-wave-1",
    reviewNotes: "No commits ahead of main were detected for this issue branch.",
    worktreeDir: repoRoot,
  });

  assert.equal(out.classification, "stale_branch");
  assert.equal(out.incident_packet_persisted, true);
  assert.equal(Boolean(out.incident_packet_id), true);
  assert.equal(Boolean(out.incident_packet_path), true);
  assert.equal(existsSync(out.incident_packet_path), true);
});

test("milestone_execute: postmortem gate exists after accumulate", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/milestone_execute.dot", "utf8");

  // accumulate outputs last_review_failed
  assert.match(dot, /outputs="[^"]*last_review_failed/, "accumulate must output last_review_failed");

  // postmortem_gate routes failed items to postmortem
  assert.match(dot, /postmortem_gate\s*->\s*postmortem\s*\[condition="last_review_failed=true"\]/, "failed items must route to postmortem");
  assert.match(dot, /postmortem_gate\s*->\s*next_issue\s*\[condition="last_review_failed!=true"\]/, "non-failed items must skip postmortem");
  assert.match(dot, /postmortem\s*->\s*next_issue/, "postmortem must continue to next_issue");
});
