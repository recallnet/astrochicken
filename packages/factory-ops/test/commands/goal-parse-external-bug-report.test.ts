import assert from "node:assert/strict";
import test from "node:test";

import { parseExternalBugReport } from "../../src/commands/goal-parse-external-bug-report.ts";

test("parseExternalBugReport parses valid fenced JSON external bug report from activated section", () => {
  const goalIssueRaw = JSON.stringify({
    number: 1436,
    title: "Goal: external factory incident triage",
    body: [
      "## Goal",
      "Improve triage behavior for external incidents.",
      "## External bug report",
      "```json",
      JSON.stringify(
        {
          source_factory: "external",
          source_repo: "example/external-factory",
          affected_version: "v0.8.1",
          incident_evidence: "run 44cc6003 failed at triage",
          expected_behavior: "Supervisor routes as control-plane fix candidate",
          observed_behavior: "Supervisor rejected with JUDGE_CONTEXT_INVALID",
          remediation_attempts: "Retried with updated issue body and scenario references",
          control_plane_intent: "Factory-of-factories control-plane ownership",
        },
        null,
        2,
      ),
      "```",
    ].join("\n"),
  });

  const out = parseExternalBugReport({ goalIssueRaw });

  assert.equal(out.external_bug_present, true);
  assert.equal(out.external_bug_intake_activated, true);
  assert.deepEqual(out.external_bug_errors, []);
  assert.equal(out.external_bug_report?.source_factory, "external");
  assert.equal(out.external_bug_report?.source_repo, "example/external-factory");
  assert.equal(out.external_bug_report?.affected_version, "v0.8.1");
  assert.equal(out.external_bug_report?.control_plane_intent, "Factory-of-factories control-plane ownership");
});

test("parseExternalBugReport scopes section parsing to activated external bug section", () => {
  const goalIssueRaw = JSON.stringify({
    body: [
      "## Notes",
      "repo: recallnet/astrochicken",
      "version: v2.0.0",
      "## External bug report",
      "## Source factory",
      "external",
      "## Affected version",
      "v0.9.0",
      "## Incident evidence",
      "dispatcher emitted no goals",
      "## Expected behavior",
      "should file control-plane bug",
      "## Follow-up",
      "source repo: example/external-factory",
      "observed behavior: this should not be parsed from outside the external section",
    ].join("\n"),
  });

  const out = parseExternalBugReport({ goalIssueRaw });

  assert.equal(out.external_bug_present, false);
  assert.equal(out.external_bug_intake_activated, true);
  assert.equal(out.external_bug_report?.source_factory, "external");
  assert.equal(out.external_bug_report?.affected_version, "v0.9.0");
  assert.equal(out.external_bug_report?.source_repo, undefined);
  assert.equal(out.external_bug_errors.includes("missing_required_field:source_repo"), true);
  assert.equal(out.external_bug_errors.includes("missing_required_field:observed_behavior"), true);
  assert.equal(out.external_bug_errors.includes("missing_required_field:remediation_attempts"), true);
});

test("parseExternalBugReport handles malformed activated fenced JSON without throwing", () => {
  const goalIssueRaw = JSON.stringify({
    body: "## External bug report\n```json\n{\n  \"source_factory\": \"external\",\n  \"source_repo\": \"example/external-factory\",\n\n```",
  });

  const out = parseExternalBugReport({ goalIssueRaw });

  assert.equal(out.external_bug_present, false);
  assert.equal(out.external_bug_intake_activated, true);
  assert.equal(out.external_bug_report, null);
  assert.deepEqual(out.external_bug_errors, ["invalid_external_bug_report_json"]);
});

test("parseExternalBugReport does not activate for ordinary goal prose with repo/version notes and unrelated fences", () => {
  const goalIssueRaw = JSON.stringify({
    body: [
      "## Goal",
      "Improve wave dispatch throughput for local repo automation.",
      "repo: recallnet/astrochicken",
      "version: v3",
      "```",
      "hatch run packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
      "```",
    ].join("\n"),
  });

  const out = parseExternalBugReport({ goalIssueRaw });

  assert.deepEqual(out, {
    external_bug_report: null,
    external_bug_errors: [],
    external_bug_present: false,
    external_bug_intake_activated: false,
  });
});

test("parseExternalBugReport ignores external-bug-like fields when activation heading is absent", () => {
  const goalIssueRaw = JSON.stringify({
    body: [
      "## Intake draft",
      "## Source factory",
      "external",
      "## Source repo",
      "example/external-factory",
      "## Observed behavior",
      "triage created duplicate issue",
    ].join("\n"),
  });

  const out = parseExternalBugReport({ goalIssueRaw });

  assert.deepEqual(out, {
    external_bug_report: null,
    external_bug_errors: [],
    external_bug_present: false,
    external_bug_intake_activated: false,
  });
});
