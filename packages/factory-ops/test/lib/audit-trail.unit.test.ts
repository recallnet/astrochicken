import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendAuditRecord,
  readAuditRecords,
  resolveAuditLogPath,
  validateAuditRecord,
} from "../../src/lib/audit-trail.ts";

function makeAuditRecord(overrides = {}) {
  return {
    schema: "audit.v1",
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_test_01",
    run_id: "run_01",
    tick_id: "tick_01",
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

test("validateAuditRecord fails closed when required field is missing", () => {
  assert.throws(() => {
    validateAuditRecord(makeAuditRecord({ instance_id: "" }));
  }, /audit_record_missing_required_field:instance_id/);
});

test("appendAuditRecord + readAuditRecords round-trip with filtering", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audit-trail-"));
  try {
    const hostId = "host_test_01";
    const first = makeAuditRecord({
      action: "issue_create",
      target_ref: "issues/10",
      timestamp: "2026-03-17T00:00:00.000Z",
    });
    const second = makeAuditRecord({
      action: "comment_create",
      target_ref: "issues/11",
      timestamp: "2026-03-17T01:00:00.000Z",
      run_id: "run_02",
      tick_id: "tick_02",
    });

    const appendedFirst = appendAuditRecord(first, {
      hostBaseDir: root,
    });
    appendAuditRecord(second, {
      hostBaseDir: root,
    });

    const expectedLogPath = resolveAuditLogPath({ hostId, hostBaseDir: root });
    assert.equal(appendedFirst.log_path, expectedLogPath);

    const all = readAuditRecords({ hostId, hostBaseDir: root });
    assert.equal(all.records.length, 2);
    assert.equal(all.records[0].target_ref, "issues/10");
    assert.equal(all.records[1].target_ref, "issues/11");

    const filteredByAction = readAuditRecords({
      hostId,
      hostBaseDir: root,
      actionFilter: "comment_create",
    });
    assert.equal(filteredByAction.records.length, 1);
    assert.equal(filteredByAction.records[0].action, "comment_create");

    const filteredBySince = readAuditRecords({
      hostId,
      hostBaseDir: root,
      since: "2026-03-17T00:30:00.000Z",
    });
    assert.equal(filteredBySince.records.length, 1);
    assert.equal(filteredBySince.records[0].target_ref, "issues/11");

    const filteredByTo = readAuditRecords({
      hostId,
      hostBaseDir: root,
      until: "2026-03-17T00:30:00.000Z",
    });
    assert.equal(filteredByTo.records.length, 1);
    assert.equal(filteredByTo.records[0].target_ref, "issues/10");

    const filteredByHost = readAuditRecords({
      hostId,
      hostBaseDir: root,
    });
    assert.equal(filteredByHost.records.length, 2);
    assert.ok(filteredByHost.records.every((record) => record.host_id === hostId));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAuditRecords scans all host logs when host-id not provided", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audit-trail-multi-host-"));
  try {
    appendAuditRecord(makeAuditRecord({ host_id: "host_a", target_ref: "issues/20" }), {
      hostBaseDir: root,
    });
    appendAuditRecord(makeAuditRecord({ host_id: "host_b", target_ref: "issues/21", run_id: "run_b", tick_id: "tick_b" }), {
      hostBaseDir: root,
    });

    const out = readAuditRecords({ hostBaseDir: root });
    assert.equal(out.records.length, 2);
    assert.deepEqual(new Set(out.records.map((entry) => entry.host_id)), new Set(["host_a", "host_b"]));
    assert.equal(out.log_paths.length, 2);

    const hostFiltered = readAuditRecords({ hostBaseDir: root, hostId: "host_b" });
    assert.equal(hostFiltered.records.length, 1);
    assert.equal(hostFiltered.records[0].host_id, "host_b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAuditRecords fails on invalid to/since range", () => {
  assert.throws(() => readAuditRecords({ until: "not-an-iso" }), /audit_to_invalid:not-an-iso/);
  assert.throws(() => readAuditRecords({ since: "2026-03-17T02:00:00.000Z", until: "2026-03-17T01:00:00.000Z" }), /audit_time_range_invalid/);
});
