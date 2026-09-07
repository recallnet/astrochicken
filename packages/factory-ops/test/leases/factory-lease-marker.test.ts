import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_LEASE_SCHEMA_VERSION,
  acquireFactoryLease,
  heartbeatFactoryLease,
  parseFactoryLeaseFromBody,
  releaseFactoryLease,
  validateFactoryLeaseOwnership,
  upsertFactoryLeaseInBody,
} from "../../src/commands/factory-lease-marker.ts";

function createCasIssueClient(initialIssue) {
  const state = {
    etag: 1,
    issue: structuredClone(initialIssue),
  };

  return {
    getIssue() {
      return {
        ok: true,
        etag: `"${state.etag}"`,
        issue: structuredClone(state.issue),
      };
    },
    updateIssueBody({ body, etag }) {
      if (String(etag || "") && String(etag) !== `"${state.etag}"`) {
        return { ok: false, precondition_failed: true, error: "etag_mismatch" };
      }
      state.issue.body = String(body || "");
      state.etag += 1;
      return { ok: true };
    },
    snapshot() {
      return structuredClone(state.issue);
    },
  };
}

function issue({ number = 1, body = "", state = "open" } = {}) {
  return {
    number,
    title: "Factory Supervisor Lease",
    body,
    state,
    labels: [],
  };
}

test("acquireFactoryLease writes lease contract and blocks active competing owner", () => {
  const client = createCasIssueClient(issue({ number: 501 }));

  const first = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 501,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  assert.equal(first.ok, true);
  assert.equal(first.acquired, true);
  assert.equal(first.reason, "lease_acquired");
  assert.equal(first.lease.schema_version, FACTORY_LEASE_SCHEMA_VERSION);
  assert.equal(first.lease.factory_scope, "factory-supervisor");
  assert.equal(first.lease.owner_id, "worker-a");
  assert.equal(first.lease.run_id, "run-a");
  assert.equal(first.lease.status, "active");
  assert.equal(Boolean(first.lease.heartbeat_at), true);
  assert.equal(Boolean(first.lease.lease_expires_at), true);

  const second = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 501,
    factoryScope: "factory-supervisor",
    ownerId: "worker-b",
    runId: "run-b",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });

  assert.equal(second.ok, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "active_lease_owned_by_other");
});

test("heartbeatFactoryLease refreshes expiry for current owner only", () => {
  const client = createCasIssueClient(issue({ number: 502 }));

  const first = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 502,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  const refreshed = heartbeatFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 502,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseToken: first.lease_token,
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:30.000Z"),
    client,
  });

  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.reason, "lease_heartbeat_refreshed");
  assert.equal(refreshed.lease.lease_started_at, first.lease.lease_started_at);
  assert.equal(refreshed.lease.lease_expires_at > first.lease.lease_expires_at, true);

  const denied = heartbeatFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 502,
    factoryScope: "factory-supervisor",
    ownerId: "worker-b",
    runId: "run-b",
    leaseToken: "other-token",
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:35.000Z"),
    client,
  });

  assert.equal(denied.ok, true);
  assert.equal(denied.refreshed, false);
  assert.equal(denied.reason, "lease_owned_by_other");
});

test("stale lease is reclaimed deterministically by new owner", () => {
  const stale = {
    schema_version: FACTORY_LEASE_SCHEMA_VERSION,
    status: "active",
    lease_id: "factory_lease_old",
    lease_token: "factory_lease_old",
    factory_scope: "factory-supervisor",
    owner_id: "worker-old",
    run_id: "run-old",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    heartbeat_at: "2026-01-01T00:00:10.000Z",
    lease_expires_at: "2026-01-01T00:01:00.000Z",
    updated_at: "2026-01-01T00:00:10.000Z",
    reclaim_count: 0,
  };
  const client = createCasIssueClient(issue({
    number: 503,
    body: upsertFactoryLeaseInBody("factory lease", stale),
  }));

  const reclaimed = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 503,
    factoryScope: "factory-supervisor",
    ownerId: "worker-new",
    runId: "run-new",
    leaseToken: "factory_lease_new",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:10:00.000Z"),
    client,
  });

  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.reason, "stale_lease_reclaimed");
  assert.equal(reclaimed.lease.reclaim_count, 1);
  assert.equal(reclaimed.lease.reclaimed_from_owner_id, "worker-old");
  assert.equal(reclaimed.lease.reclaimed_from_run_id, "run-old");

  const parsed = parseFactoryLeaseFromBody(client.snapshot().body, null);
  assert.equal(parsed.owner_id, "worker-new");
  assert.equal(parsed.status, "active");
});

test("releaseFactoryLease enforces ownership unless force is set", () => {
  const client = createCasIssueClient(issue({ number: 504 }));

  const acquired = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 504,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseToken: "factory_lease_504",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(acquired.acquired, true);

  const denied = releaseFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 504,
    factoryScope: "factory-supervisor",
    ownerId: "worker-b",
    runId: "run-b",
    leaseToken: "factory_lease_other",
    reason: "not_owner",
    nowEpochMs: Date.parse("2026-01-01T00:00:20.000Z"),
    client,
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.released, false);
  assert.equal(denied.reason, "lease_owned_by_other");

  const forced = releaseFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 504,
    factoryScope: "factory-supervisor",
    reason: "terminal_error",
    force: true,
    nowEpochMs: Date.parse("2026-01-01T00:00:30.000Z"),
    client,
  });
  assert.equal(forced.ok, true);
  assert.equal(forced.released, true);
  assert.equal(forced.reason, "lease_released");

  const reacquired = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 504,
    factoryScope: "factory-supervisor",
    ownerId: "worker-b",
    runId: "run-b",
    leaseToken: "factory_lease_504_b",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:40.000Z"),
    client,
  });
  assert.equal(reacquired.ok, true);
  assert.equal(reacquired.acquired, true);
  assert.equal(reacquired.reason, "released_lease_reacquired");
});

test("validateFactoryLeaseOwnership enforces active token boundary", () => {
  const client = createCasIssueClient(issue({ number: 505 }));

  const acquired = acquireFactoryLease({
    repo: "recallnet/astrochicken",
    issueNumber: 505,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseToken: "factory_lease_505",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(acquired.acquired, true);

  const valid = validateFactoryLeaseOwnership({
    repo: "recallnet/astrochicken",
    issueNumber: 505,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseToken: "factory_lease_505",
    nowEpochMs: Date.parse("2026-01-01T00:00:05.000Z"),
    client,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.valid, true);
  assert.equal(valid.reason, "lease_valid");

  const badToken = validateFactoryLeaseOwnership({
    repo: "recallnet/astrochicken",
    issueNumber: 505,
    factoryScope: "factory-supervisor",
    ownerId: "worker-a",
    runId: "run-a",
    leaseToken: "wrong",
    nowEpochMs: Date.parse("2026-01-01T00:00:05.000Z"),
    client,
  });
  assert.equal(badToken.ok, true);
  assert.equal(badToken.valid, false);
  assert.equal(badToken.reason, "lease_token_mismatch");
});
