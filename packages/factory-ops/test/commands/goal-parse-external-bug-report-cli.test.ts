import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("goal parse-external-bug-report is wired and returns parser keys", () => {
  const goalIssue = {
    number: 1436,
    body: [
      "## External bug report",
      "```json",
      JSON.stringify({
        source_factory: "external",
        source_repo: "example/external-factory",
        affected_version: "v1.2.0",
        incident_evidence: "run 123 failed",
        expected_behavior: "triage emits fix-now",
        observed_behavior: "triage emitted duplicate",
        remediation_attempts: "re-ran with refreshed config",
      }, null, 2),
      "```",
    ].join("\n"),
  };

  const run = spawnSync(
    "node",
    [opsCliPath, "goal", "parse-external-bug-report", "--goal-issue", JSON.stringify(goalIssue)],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout || "{}");
  assert.deepEqual(Object.keys(parsed).sort(), ["external_bug_errors", "external_bug_intake_activated", "external_bug_present", "external_bug_report"]);
  assert.equal(Array.isArray(parsed.external_bug_errors), true);
  assert.equal(typeof parsed.external_bug_intake_activated, "boolean");
  assert.equal(typeof parsed.external_bug_present, "boolean");
  assert.equal(typeof parsed.external_bug_report, "object");
});

test("goal parse-external-bug-report accepts --goal-issue-b64 transport", () => {
  const goalIssue = {
    body: "## Source factory\nexternal\n## Source repo\nexample/external-factory",
  };

  const run = spawnSync(
    "node",
    [
      opsCliPath,
      "goal",
      "parse-external-bug-report",
      "--goal-issue-b64",
      Buffer.from(JSON.stringify(goalIssue), "utf8").toString("base64"),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout || "{}");
  assert.deepEqual(Object.keys(parsed).sort(), ["external_bug_errors", "external_bug_intake_activated", "external_bug_present", "external_bug_report"]);
});
