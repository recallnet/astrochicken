import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatFactoryAuditRecordsHuman,
  readFactoryAuditRecords,
} from "../../src/commands/factory-audit-records.ts";
import { appendAuditRecord } from "../../src/lib/audit-trail.ts";

function makeAuditRecord(overrides = {}) {
  return {
    schema: "audit.v1",
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_unit_01",
    run_id: "run_unit_01",
    tick_id: "tick_unit_01",
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

test("readFactoryAuditRecords returns report payload with filtered rows", () => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-audit-records-unit-"));
  try {
    appendAuditRecord(makeAuditRecord(), { hostBaseDir: root });
    appendAuditRecord(makeAuditRecord({
      action: "comment_create",
      target_ref: "issues/3000",
      run_id: "run_unit_02",
      tick_id: "tick_unit_02",
      timestamp: "2026-03-17T02:00:00.000Z",
    }), { hostBaseDir: root });

    const out = readFactoryAuditRecords({
      hostBaseDir: root,
      instanceId: "fac_01TEST",
      action: "comment_create",
      since: "2026-03-17T01:00:00.000Z",
      until: "2026-03-17T03:00:00.000Z",
    });

    assert.equal(out.ok, true);
    assert.equal(out.schema, "factory.audit_records.report.v1");
    assert.equal(out.count, 1);
    assert.equal(out.filters.to, "2026-03-17T03:00:00.000Z");
    assert.equal(out.records[0].action, "comment_create");
    assert.equal(out.records[0].target_ref, "issues/3000");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatFactoryAuditRecordsHuman renders table and empty state", () => {
  const empty = formatFactoryAuditRecordsHuman([]);
  assert.equal(empty, "No matching audit records.");

  const table = formatFactoryAuditRecordsHuman([
    makeAuditRecord({
      action: "issue_label",
      target_ref: "issues/44",
      destination_name: "ops",
      timestamp: "2026-03-17T03:00:00.000Z",
    }),
  ]);

  assert.match(table, /timestamp\s+action\s+instance/);
  assert.match(table, /issue_label/);
  assert.match(table, /recallnet\/astrochicken:issues\/44/);
});
