import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { appendAuditRecord } from "../../src/lib/audit-trail.ts";

function makeAuditRecord(overrides = {}) {
  return {
    schema: "audit.v1",
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_cli_01",
    run_id: "run_cli_01",
    tick_id: "tick_cli_01",
    action: "issue_create",
    target_repo: "recallnet/astrochicken",
    target_ref: "issues/2225",
    destination_name: "goal_issues",
    capability_version: "capability.v1",
    policy_profile: "policy_pack:v1",
    runtime_version: "1.2.3",
    timestamp: "2026-03-17T00:00:00.000Z",
    ...overrides,
  };
}

function runCli(args, { expectStatus = 0 } = {}) {
  const run = spawnOpsCli([
      ...args
    ]);
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("factory audit-records --json returns filtered audit records", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-audit-cli-"));
  try {
    appendAuditRecord(makeAuditRecord(), { hostBaseDir: root });
    appendAuditRecord(makeAuditRecord({
      action: "comment_create",
      target_ref: "issues/3000",
      run_id: "run_cli_02",
      tick_id: "tick_cli_02",
      timestamp: "2026-03-17T02:00:00.000Z",
    }), { hostBaseDir: root });

    const run = runCli([
      "factory",
      "audit-records",
      "--host-base-dir",
      root,
      "--instance-id",
      "fac_01TEST",
      "--action",
      "comment_create",
      "--since",
      "2026-03-17T01:00:00.000Z",
      "--to",
      "2026-03-17T03:00:00.000Z",
      "--json",
    ]);

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.ok, true);
    assert.equal(payload.count, 1);
    assert.equal(payload.filters.to, "2026-03-17T03:00:00.000Z");
    assert.equal(payload.records[0].action, "comment_create");
    assert.equal(payload.records[0].target_ref, "issues/3000");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory audit-records prints readable table in non-json mode", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-audit-cli-human-"));
  try {
    appendAuditRecord(makeAuditRecord(), { hostBaseDir: root });

    const run = runCli([
      "factory",
      "audit-records",
      "--host-base-dir",
      root,
      "--instance-id",
      "fac_01TEST",
    ]);

    const output = String(run.stdout || "");
    assert.match(output, /timestamp\s+action\s+instance/);
    assert.match(output, /issue_create/);
    assert.match(output, /recallnet\/astrochicken:issues\/2225/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory audit-records fails on invalid --since", () => {
  const run = runCli([
    "factory",
    "audit-records",
    "--since",
    "not-an-iso",
  ], { expectStatus: 1 });

  assert.match(String(run.stderr || ""), /audit_since_invalid:not-an-iso/);
});

test("factory audit-records fails on invalid --to", () => {
  const run = runCli([
    "factory",
    "audit-records",
    "--to",
    "not-an-iso",
  ], { expectStatus: 1 });

  assert.match(String(run.stderr || ""), /audit_to_invalid:not-an-iso/);
});

test("factory audit-records fails when --to is before --since", () => {
  const run = runCli([
    "factory",
    "audit-records",
    "--since",
    "2026-03-17T02:00:00.000Z",
    "--to",
    "2026-03-17T01:00:00.000Z",
  ], { expectStatus: 1 });

  assert.match(String(run.stderr || ""), /audit_time_range_invalid/);
});
