import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { emitBugIssue } from "../../src/commands/supervisor-artifact.ts";
import {
  getDefaultNormalizationLabelNames,
} from "../../src/lib/factory-label-contract.ts";

test("emitBugIssue fails closed when incident packet contract is missing required fields", () => {
  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "factory-cli-runtime-crash",
    summary: "factory-cli-runtime-crash runtime module error",
    runId: "44cc6003",
    pipeline: "factory_supervisor_tick",
    evidence: JSON.stringify({
      crash_type: "runtime_module_error",
      observed_behavior: "CLI crashed while loading module",
      // expected_behavior + remediation_attempts intentionally omitted.
    }),
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "incident_packet_contract_failed");
  assert.equal(Array.isArray(out.details), true);
  assert.equal(out.details.includes("missing_required_field:expected_behavior"), true);
  assert.equal(out.details.includes("missing_required_field:remediation_attempts"), true);
});

test("emitBugIssue fails closed and queues needs-review when dedup lookup fails", () => {
  const queueRoot = mkdtempSync(join(tmpdir(), "incident-needs-review-"));
  const queuePath = join(queueRoot, "incident.ndjson");

  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "factory-cli-runtime-crash",
    summary: "runtime crash",
    runId: "run-needs-review",
    pipeline: "factory_supervisor_tick",
    sourceFactory: "example-notes/factory_supervisor",
    sourceRepo: "example-org/example-notes",
    classification: "platform",
    crashType: "module_not_found",
    evidence: {
      observed_behavior: "CLI crashed",
      expected_behavior: "CLI should run",
      remediation_attempts: "retried",
      error_excerpt: "Cannot find module",
      affected_node: "emit_bug",
    },
    needsReviewQueuePath: queuePath,
    ghJsonFn: () => ({ malformed: true }),
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "incident_dedup_lookup_failed");
  assert.equal(typeof out.queue_path, "string");
  assert.equal(readFileSync(out.queue_path, "utf8").includes("incident.needs_review.v1"), true);
});

test("emitBugIssue dedups by incident fingerprint and comments instead of creating duplicates", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "edit") return { ok: true, status: 0, stdout: "", stderr: "" };
    if (args[0] === "issue" && args[1] === "comment") return { ok: true, status: 0, stdout: "", stderr: "" };
    if (args[0] === "issue" && args[1] === "create") return { ok: true, status: 0, stdout: "https://example.test/issues/999", stderr: "" };
    if (args[0] === "label" && args[1] === "create") return { ok: true, status: 0, stdout: "", stderr: "" };
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const existing = {
    number: 71,
    title: "[bug] factory-cli-runtime-crash: runtime crash",
    url: "https://example.test/issues/71",
    state: "OPEN",
    body: [
      "Machine-detected factory bug.",
      "Incident-Fingerprint: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "<!-- incident-metadata: {\"schema\":\"incident.v2\",\"fingerprint\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"severity\":\"informational\",\"classification\":\"ambiguous\",\"affected_instances\":[{\"instance_id\":\"fac_old\",\"kind_id\":\"example-notes\",\"host_id\":\"host_old\",\"source_repo\":\"example-org/example-notes\",\"run_id\":\"run-old\",\"severity\":\"informational\",\"classification\":\"ambiguous\"}]} -->",
    ].join("\n"),
  };

  const ghJsonFn = (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      return [existing];
    }
    return fallback;
  };

  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "factory-cli-runtime-crash",
    summary: "runtime crash",
    runId: "run-new",
    pipeline: "factory_supervisor_tick",
    sourceFactory: "example-notes/factory_supervisor",
    sourceRepo: "example-org/example-notes",
    classification: "platform",
    severity: "blocking",
    crashType: "module_not_found",
    runtimeVersion: "v2.0.0",
    kindVersion: "v3.0.0",
    kindId: "example-notes",
    instanceId: "fac_new",
    hostId: "host_new",
    fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidence: {
      observed_behavior: "CLI crashed",
      expected_behavior: "CLI should run",
      remediation_attempts: "retried",
      error_excerpt: "Cannot find module",
      affected_node: "emit_bug",
    },
    ghExec,
    ghJsonFn,
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, true);
  assert.equal(out.deduped, true);
  assert.equal(out.issue_url, "https://example.test/issues/71");
  assert.equal(calls.some((args) => args[0] === "issue" && args[1] === "create"), false);
  const editCall = calls.find((args) => args[0] === "issue" && args[1] === "edit");
  assert.ok(editCall, "dedup path must edit existing issue body");
  assert.equal(editCall.includes("--body"), true);
  const body = editCall[editCall.indexOf("--body") + 1];
  assert.equal(/## Affected Instances/.test(String(body)), true);
  assert.equal(/`fac_old`/.test(String(body)), true);
  assert.equal(/`fac_new`/.test(String(body)), true);
  assert.equal(/Incident-Fingerprint: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.test(String(body)), true);
});

test("emitBugIssue reopens closed incident fingerprint match and comments evidence", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "reopen") return { ok: true, status: 0, stdout: "", stderr: "" };
    if (args[0] === "issue" && args[1] === "edit") return { ok: true, status: 0, stdout: "", stderr: "" };
    if (args[0] === "issue" && args[1] === "comment") return { ok: true, status: 0, stdout: "", stderr: "" };
    if (args[0] === "label" && args[1] === "create") return { ok: true, status: 0, stdout: "", stderr: "" };
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const ghJsonFn = (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      return [{
        number: 88,
        title: "[bug] factory-cli-runtime-crash: runtime crash",
        url: "https://example.test/issues/88",
        state: "CLOSED",
        body: "Incident-Fingerprint: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }];
    }
    if (args[0] === "issue" && args[1] === "view") {
      return { state: "OPEN" };
    }
    return fallback;
  };

  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "factory-cli-runtime-crash",
    summary: "runtime crash",
    runId: "run-closed",
    pipeline: "factory_supervisor_tick",
    sourceFactory: "example-notes/factory_supervisor",
    sourceRepo: "example-org/example-notes",
    classification: "platform",
    severity: "degrading",
    crashType: "module_not_found",
    runtimeVersion: "v2.0.0",
    kindVersion: "v3.0.0",
    kindId: "example-notes",
    instanceId: "fac_closed",
    hostId: "host_closed",
    fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    evidence: {
      observed_behavior: "CLI crashed",
      expected_behavior: "CLI should run",
      remediation_attempts: "retried",
      error_excerpt: "Cannot find module",
      affected_node: "emit_bug",
    },
    ghExec,
    ghJsonFn,
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, true);
  assert.equal(out.deduped, true);
  assert.equal(out.issue_url, "https://example.test/issues/88");
  assert.equal(calls.some((args) => args[0] === "issue" && args[1] === "reopen"), true);
  assert.equal(calls.some((args) => args[0] === "issue" && args[1] === "comment"), true);
});

test("emitBugIssue normalizes classifier output to canonical incident.v2 classification values", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") return { ok: true, status: 0, stdout: "https://example.test/issues/123", stderr: "" };
    if (args[0] === "label" && args[1] === "create") return { ok: true, status: 0, stdout: "", stderr: "" };
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const ghJsonFn = () => [];

  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "factory-cli-runtime-crash",
    summary: "runtime crash",
    runId: "run-normalize",
    pipeline: "factory_supervisor_tick",
    sourceFactory: "example-notes/factory_supervisor",
    sourceRepo: "example-org/example-notes",
    classification: "needs_triage",
    crashType: "module_not_found",
    evidence: {
      observed_behavior: "CLI crashed",
      expected_behavior: "CLI should run",
      remediation_attempts: "retried",
      error_excerpt: "Cannot find module",
      affected_node: "emit_bug",
    },
    ghExec,
    ghJsonFn,
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, true);
  const createCall = calls.find((args) => args[0] === "issue" && args[1] === "create");
  assert.ok(createCall, "must create issue when no dedup match exists");
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(String(body), /"classification":\s*"needs-triage"/);
});

test("emitBugIssue adds required managed brainstorm incident labels", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") return { ok: true, status: 0, stdout: "https://example.test/issues/124", stderr: "" };
    if (args[0] === "label" && args[1] === "create") return { ok: true, status: 0, stdout: "", stderr: "" };
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = emitBugIssue({
    repo: "recallnet/astrochicken",
    bugType: "managed-daemon-circuit-breaker",
    summary: "daemon paused after repeated failures",
    runId: "run-brainstorm",
    pipeline: "daemon",
    sourceFactory: "brainstorm",
    sourceRepo: "example-org/example-notes",
    kindId: "brainstorm",
    classification: "platform",
    crashType: "runtime_failure",
    evidence: {
      observed_behavior: "daemon paused",
      expected_behavior: "daemon should keep ticking",
      remediation_attempts: "retry, resume",
      error_excerpt: "invalid capability path",
      affected_node: "run_managed_supervisor_shell",
    },
    ghExec,
    ghJsonFn: () => [],
    ensureBugLabelsFn: () => {},
  });

  assert.equal(out.ok, true);
  const createCall = calls.find((args) => args[0] === "issue" && args[1] === "create");
  assert.ok(createCall, "must create issue when no dedup match exists");

  const labels = [];
  for (let index = 0; index < createCall.length; index += 1) {
    if (createCall[index] === "--label") {
      labels.push(createCall[index + 1]);
    }
  }

  assert.equal(labels.includes("kind:brainstorm"), true);
  assert.equal(labels.includes("managed-factory-bug"), true);
  assert.equal(labels.includes("incident-fingerprint"), true);
});

test("bug label is in DEFAULT_ALLOWED list", () => {
  const defaultLabels = new Set(getDefaultNormalizationLabelNames("mothership"));
  assert.equal(defaultLabels.has("bug"), true, "bug must remain in the default normalization label set");
});
