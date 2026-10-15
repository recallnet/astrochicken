import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function runFallbackIssueSpec({ issueSpec = "", feature = "" } = {}) {
  const args = [
    opsCliPath,
    "common",
    "fallback-issue-spec",
    "--issue-spec-b64",
    Buffer.from(issueSpec, "utf8").toString("base64"),
    "--feature-b64",
    Buffer.from(feature, "utf8").toString("base64"),
  ];

  const run = spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function runFallbackIssueSpecFromStdin({ issueSpec = "", feature = "{}" } = {}) {
  const args = [
    opsCliPath,
    "common",
    "fallback-issue-spec",
    "--feature-b64",
    Buffer.from(feature, "utf8").toString("base64"),
  ];

  const run = spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input: issueSpec,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

test("common fallback-issue-spec CLI preserves existing labels and de-duplicates comma string labels", () => {
  const existing = JSON.stringify({
    issue_title: "T",
    issue_body: "B",
    issue_labels: "feature,ready,feature,needs-review",
  });

  const out = runFallbackIssueSpec({ issueSpec: existing, feature: "{}" });
  assert.equal(out.issue_title, "T");
  assert.equal(out.issue_body, "B");
  assert.equal(out.issue_labels, "feature,ready,needs-review");
});

test("common fallback-issue-spec CLI rejects non-string issue labels in existing payload", () => {
  const existing = JSON.stringify({
    issue_title: "T",
    issue_body: "B",
    issue_labels: ["feature", 99, "ready", false],
  });
  const feature = JSON.stringify({ summary: "Writer fallback summary" });

  const out = runFallbackIssueSpec({ issueSpec: existing, feature });
  assert.equal(out.issue_title, "T");
  assert.equal(out.issue_body, "B");
  assert.equal(out.issue_labels, "feature,ready");
});

test("common fallback-issue-spec CLI emits deterministic bootstrap output when existing payload invalid", () => {
  const invalidExisting = JSON.stringify({ issue_title: 5, issue_body: ["bad"] });
  const feature = JSON.stringify({
    name: { nested: true },
    summary: 7,
    acceptance_criteria: ["criterion-a", 4],
    risks: ["risk-a", { bad: true }],
  });

  const first = runFallbackIssueSpec({ issueSpec: invalidExisting, feature });
  const second = runFallbackIssueSpec({ issueSpec: invalidExisting, feature });

  assert.deepEqual(first, second);
  assert.equal(first.issue_title, "Bootstrap feature");
  assert.match(first.issue_body, /Deterministic fallback issue spec generated because writer output was unavailable\./);
  assert.match(first.issue_body, /- criterion-a/);
  assert.equal(first.issue_body.includes("- 4"), false);
  assert.equal(first.issue_body.includes("- risk-a"), true);
  assert.equal(first.issue_labels, "feature,ready");
  assert.equal(first.issue_spec_source, "fallback");
  assert.equal(first.issue_spec_fallback_reason, "writer_output_unavailable");
  assert.match(first.issue_body, new RegExp(`reason=${first.issue_spec_fallback_reason}`));
  assert.equal(first.issue_spec_fallback_schema, "hatch.issue_spec.fallback.v1");
});

test("common fallback-issue-spec CLI backfills metadata from legacy fallback marker", () => {
  const existing = JSON.stringify({
    issue_title: "Legacy fallback",
    issue_body: "## Summary\nLegacy fallback\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: "feature,ready",
  });

  const out = runFallbackIssueSpec({ issueSpec: existing, feature: "{}" });
  assert.equal(out.issue_spec_source, "fallback");
  assert.equal(out.issue_spec_fallback_reason, "writer_output_unavailable");
  assert.equal(out.issue_spec_fallback_schema, "hatch.issue_spec.fallback.v1");
});

test("common fallback-issue-spec CLI backfills metadata for explicit fallback source without marker", () => {
  const existing = JSON.stringify({
    issue_title: "Fallback source",
    issue_body: "## Summary\nFallback source but marker unavailable",
    issue_labels: "feature,ready",
    issue_spec_source: "fallback",
  });

  const out = runFallbackIssueSpec({ issueSpec: existing, feature: "{}" });
  assert.equal(out.issue_spec_source, "fallback");
  assert.equal(out.issue_spec_fallback_reason, "writer_output_unavailable");
  assert.equal(out.issue_spec_fallback_schema, "hatch.issue_spec.fallback.v1");
});

test("common fallback-issue-spec CLI does not backfill fallback metadata for explicit non-fallback source", () => {
  const existing = JSON.stringify({
    issue_title: "Writer payload",
    issue_body: "## Summary\nMarker copied\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: "feature,ready",
    issue_spec_source: "writer",
  });

  const out = runFallbackIssueSpec({ issueSpec: existing, feature: "{}" });
  assert.equal(out.issue_spec_source, "writer");
  assert.equal("issue_spec_fallback_reason" in out, false);
  assert.equal("issue_spec_fallback_schema" in out, false);
});

test("common fallback-issue-spec CLI accepts stdin issue-spec payload with apostrophes/newlines", () => {
  const issueSpec = JSON.stringify({
    issue_title: "Owner's issue",
    issue_body: "Line 1\nLine 2 with O'Hare",
    issue_labels: "feature,ready",
  });

  const out = runFallbackIssueSpecFromStdin({ issueSpec, feature: "{}" });
  assert.equal(out.issue_title, "Owner's issue");
  assert.equal(out.issue_body, "Line 1\nLine 2 with O'Hare");
  assert.equal(out.issue_labels, "feature,ready");
});

test("common fallback-issue-spec CLI empty-stdin fallback is deterministic", () => {
  const out = runFallbackIssueSpecFromStdin({
    issueSpec: "",
    feature: JSON.stringify({ name: "Feature stdin fallback", summary: "stdin empty fallback" }),
  });

  assert.equal(out.issue_title, "Feature stdin fallback");
  assert.match(out.issue_body, /stdin empty fallback/);
});

test("common fallback-issue-spec CLI rejects mixed raw and b64 issue-spec transport", () => {
  const run = spawnOpsCli([
      "common",
      "fallback-issue-spec",
      "--issue-spec",
      "{}",
      "--issue-spec-b64",
      Buffer.from("{}", "utf8").toString("base64")
    ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /issue-spec accepts one transport: --issue-spec or --issue-spec-b64/);
});
