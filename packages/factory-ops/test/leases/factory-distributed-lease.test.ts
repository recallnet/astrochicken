import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
  acquireFactoryDistributedLease,
  buildDeterministicLeaseHolderId,
  createFactoryDistributedLeaseGhClient,
  enforceLeaseSafetyForSnapshot,
  releaseFactoryDistributedLease,
  resetLeaseSafetyIncidentCacheForTests,
  resolveFactoryTrackingIssueNumber,
  upsertFactoryDistributedLeaseInComment,
} from "../../src/commands/factory-distributed-lease.ts";
import { loadLeaseSnapshot } from "../../src/commands/lease-http-client.ts";
import {
  DEFAULT_RUNTIME_VERSION,
  FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES,
  MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS,
  normalizeManagedInstanceLeaseRecord,
  resolveManagedLeaseHostId,
  resolveManagedLeaseInstallationId,
  resolveManagedLeaseRuntimeVersion,
  validateManagedInstanceLeaseRecord,
} from "../../src/commands/lease-holder.ts";

function makeCanonicalManagedLease({
  factoryId = "mothership/factory_supervisor",
  leaseName = "wave_execute",
  holderId = "host-a:10:mothership/factory_supervisor:wave_execute",
  runId = "run-a",
  trackingIssueNumber = "901",
  acquiredAt = "2026-01-01T00:00:00.000Z",
  expiresAt = "2099-01-01T00:10:00.000Z",
  leaseTtlSec = 600,
  instanceId = "fac_lease_contract",
  installationId = "inst_fac_lease_contract_host-a",
  hostId = "host-a",
  runtimeVersion = "1.0.0-test",
} = {}) {
  return {
    schema_version: FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
    status: "active",
    factory_id: factoryId,
    lease_name: leaseName,
    holder_id: holderId,
    run_id: runId,
    acquired_at: acquiredAt,
    heartbeat_at: acquiredAt,
    expires_at: expiresAt,
    updated_at: acquiredAt,
    tracking_issue_number: String(trackingIssueNumber),
    idempotency_key: `${factoryId}:${leaseName}:${runId}`,
    version: 1,
    version_token: "1",
    reclaim_count: 0,
    instance_id: instanceId,
    installation_id: installationId,
    host_id: hostId,
    lease_owner: holderId,
    lease_acquired_at: acquiredAt,
    lease_expires_at: expiresAt,
    lease_ttl_sec: leaseTtlSec,
    runtime_version: runtimeVersion,
  };
}

test("lease-holder exports managed schema helpers and deterministic validation codes", () => {
  assert.equal(DEFAULT_RUNTIME_VERSION, "unknown_runtime");
  assert.equal(Array.isArray(MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS), true);
  assert.deepEqual(MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS.includes("runtime_version"), true);
  assert.equal(FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.MISSING_FIELD, "missing-field");
  assert.equal(FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.INVALID_TTL, "invalid-ttl");
  assert.equal(FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_CLOCK, "stale-clock");
  assert.equal(FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_LEASE, "stale-lease");
});

test("lease-holder managed schema normalization helper resolves host/runtime/install defaults", () => {
  const hostId = resolveManagedLeaseHostId({ hostId: "", leaseOwner: "host-alpha:123:factory:lane" });
  assert.equal(hostId, "host-alpha");

  const runtimeVersion = resolveManagedLeaseRuntimeVersion("");
  assert.equal(typeof runtimeVersion, "string");
  assert.equal(runtimeVersion.length > 0, true);

  const installationId = resolveManagedLeaseInstallationId({
    installationId: "",
    instanceId: "fac_test",
    hostId: hostId,
  });
  assert.equal(installationId, "inst_fac_test_host-alpha");
});

test("lease-holder managed schema normalization/validation helpers enforce canonical contract", () => {
  const normalized = normalizeManagedInstanceLeaseRecord({
    factory_id: "mothership/factory_supervisor",
    lease_name: "wave_execute",
    holder_id: "host-a:10:mothership/factory_supervisor:wave_execute",
    run_id: "run-a",
    instance_id: "fac_test",
    installation_id: "inst_fac_test_host-a",
    host_id: "host-a",
    lease_owner: "host-a:10:mothership/factory_supervisor:wave_execute",
    lease_acquired_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:10:00.000Z",
    lease_ttl_sec: 600,
    runtime_version: "1.2.3",
  }, {
    nowIso: "2026-01-01T00:00:00.000Z",
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    requireRawManagedFields: true,
  });

  assert.equal(Boolean(normalized), true);
  assert.equal(normalized.instance_id, "fac_test");
  assert.equal(normalized.installation_id, "inst_fac_test_host-a");
  assert.equal(normalized.lease_ttl_sec, 600);

  const validation = validateManagedInstanceLeaseRecord(normalized, {
    nowIso: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(validation.ok, true);

  const staleClock = validateManagedInstanceLeaseRecord({
    ...normalized,
    lease_acquired_at: "2026-01-01T00:10:00.000Z",
    acquired_at: "2026-01-01T00:10:00.000Z",
    lease_expires_at: "2026-01-01T00:20:00.000Z",
    expires_at: "2026-01-01T00:20:00.000Z",
  }, {
    nowIso: "2026-01-01T00:00:00.000Z",
    clockSkewToleranceMs: 0,
  });
  assert.equal(staleClock.ok, false);
  assert.equal(staleClock.reason_code, "stale-clock");

  const invalidTtl = validateManagedInstanceLeaseRecord({
    ...normalized,
    lease_ttl_sec: 0,
  }, {
    nowIso: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(invalidTtl.ok, false);
  assert.equal(invalidTtl.reason_code, "invalid-ttl");

  const missingField = validateManagedInstanceLeaseRecord({
    ...normalized,
    runtime_version: "",
  }, {
    nowIso: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(missingField.ok, false);
  assert.equal(missingField.reason_code, "missing-field");
});

function createInMemoryLeaseClient({ trackingIssueNumber = 1, nowIso = "2026-01-01T00:00:00.000Z" } = {}) {
  const state = {
    trackingIssueNumber: Number(trackingIssueNumber),
    comments: [],
    nextCommentId: 1,
    nowIso,
  };

  function listLeaseComments({ issueNumber }) {
    if (Number(issueNumber) !== state.trackingIssueNumber) {
      return { ok: false, error: "tracking_issue_not_found", comments: [] };
    }
    return {
      ok: true,
      comments: state.comments.map((row) => ({
        id: row.id,
        body: row.body,
        updated_at: row.updated_at,
      })),
      server_now_iso: state.nowIso,
    };
  }

  function getComment({ commentId }) {
    const found = state.comments.find((row) => row.id === Number(commentId));
    if (!found) return { ok: false, error: "comment_not_found" };
    return {
      ok: true,
      etag: `"${found.etag}"`,
      comment: {
        id: found.id,
        body: found.body,
        updated_at: found.updated_at,
      },
      server_now_iso: state.nowIso,
    };
  }

  function updateComment({ commentId, body, etag = "" }) {
    const found = state.comments.find((row) => row.id === Number(commentId));
    if (!found) return { ok: false, error: "comment_not_found" };
    if (String(etag || "") && String(etag) !== `"${found.etag}"`) {
      return { ok: false, precondition_failed: true, error: "etag_mismatch" };
    }
    found.body = String(body || "");
    found.updated_at = state.nowIso;
    found.etag += 1;
    return { ok: true, etag: `"${found.etag}"` };
  }

  function createComment({ issueNumber, body }) {
    if (Number(issueNumber) !== state.trackingIssueNumber) {
      return { ok: false, error: "tracking_issue_not_found" };
    }
    const created = {
      id: state.nextCommentId,
      body: String(body || ""),
      updated_at: state.nowIso,
      etag: 1,
    };
    state.comments.push(created);
    state.nextCommentId += 1;
    return {
      ok: true,
      comment: {
        id: created.id,
        body: created.body,
        updated_at: created.updated_at,
      },
    };
  }

  return {
    listLeaseComments,
    getComment,
    updateComment,
    createComment,
    setNow(iso) {
      state.nowIso = String(iso || state.nowIso);
    },
    snapshot() {
      return structuredClone(state);
    },
  };
}

test("distributed lease contention: one contender acquires, one deterministically defers", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 77 });

  const a = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 77,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-a",
    holderId: buildDeterministicLeaseHolderId({ hostId: "host-a", processId: 10, factoryId: "mothership/factory_supervisor", leaseName: "wave_execute" }),
    leaseSeconds: 300,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  const b = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 77,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-b",
    holderId: buildDeterministicLeaseHolderId({ hostId: "host-b", processId: 11, factoryId: "mothership/factory_supervisor", leaseName: "wave_execute" }),
    leaseSeconds: 300,
    nowEpochMs: Date.parse("2026-01-01T00:00:01.000Z"),
    client,
  });

  assert.equal(a.ok, true);
  assert.equal(a.acquired, true);
  assert.equal(a.lease.schema_version, FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION);
  assert.deepEqual(
    MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS.every((field) => Boolean(String(a.lease?.[field] || "").trim())),
    true,
  );
  assert.equal(a.lease.lease_owner, a.holder_id);
  assert.equal(a.lease.lease_ttl_sec, 300);
  assert.equal(a.lease.lease_acquired_at, a.lease.acquired_at);
  assert.equal(a.lease.lease_expires_at, a.lease.expires_at);
  assert.match(String(a.lease.runtime_version || ""), /\S/);
  assert.equal(b.ok, true);
  assert.equal(b.acquired, false);
  assert.equal(b.reason, "lease_owned_by_other");
});

test("distributed lease idempotent refresh for same run_id", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 88 });

  const first = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 88,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-refresh",
    idempotencyKey: "wave_dispatch:run-refresh",
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  client.setNow("2026-01-01T00:00:20.000Z");
  const second = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 88,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-refresh",
    idempotencyKey: "wave_dispatch:run-refresh",
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:20.000Z"),
    client,
  });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, true);
  assert.equal(second.reason, "lease_refreshed");
  assert.equal(second.lease.run_id, "run-refresh");
  assert.equal(second.lease.acquired_at, first.lease.acquired_at);
  assert.equal(Date.parse(second.lease.expires_at) > Date.parse(first.lease.expires_at), true);
});

test("distributed lease refresh requires matching holder_id and run_id", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 89 });

  const first = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 89,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-same",
    holderId: "host-a:101:mothership/factory_supervisor:wave_dispatch",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(first.acquired, true);

  const denied = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 89,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-same",
    holderId: "host-b:202:mothership/factory_supervisor:wave_dispatch",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:05.000Z"),
    client,
  });

  assert.equal(denied.acquired, false);
  assert.equal(denied.reason, "lease_owned_by_other");
});

test("distributed lease defaults non-positive leaseSeconds to safe 600s window", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 90 });

  const out = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 90,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-empty-lease-seconds",
    holderId: "host-a:303:mothership/factory_supervisor:wave_dispatch",
    // Mimics CLI Number("") empty-arg path from prior implementation.
    leaseSeconds: Number(""),
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  assert.equal(out.acquired, true);
  assert.equal(out.lease.lease_ttl_sec, 600);
  const expiryMs = Date.parse(String(out?.lease?.expires_at || ""));
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  const ttlMs = expiryMs - nowMs;
  assert.equal(ttlMs >= 599_000 && ttlMs <= 601_000, true);
});

test("distributed lease rejects persisted payload missing required managed field with deterministic code", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 901 });

  const malformed = {
    ...makeCanonicalManagedLease({
      trackingIssueNumber: "901",
      leaseTtlSec: 120,
      expiresAt: "2026-01-01T00:02:00.000Z",
    }),
    host_id: "",
  };

  const seeded = client.createComment({
    issueNumber: 901,
    body: upsertFactoryDistributedLeaseInComment("seed", malformed),
  });
  assert.equal(seeded.ok, true);

  const out = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 901,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-new",
    holderId: "host-new:1:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });

  assert.equal(out.ok, false);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "missing-field");
  assert.equal(out.reason_detail, "missing-field:host_id");
});

test("distributed lease release rejects invalid schema with deterministic reason code", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 903 });

  const malformed = {
    ...makeCanonicalManagedLease({
      trackingIssueNumber: "903",
      leaseTtlSec: 120,
      expiresAt: "2026-01-01T00:02:00.000Z",
    }),
    runtime_version: "",
  };

  const seeded = client.createComment({
    issueNumber: 903,
    body: upsertFactoryDistributedLeaseInComment("seed", malformed),
  });
  assert.equal(seeded.ok, true);

  const out = releaseFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 903,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-bad",
    holderId: "host-a:10:mothership/factory_supervisor:wave_execute",
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });

  assert.equal(out.ok, false);
  assert.equal(out.released, false);
  assert.equal(out.reason, "missing-field");
  assert.equal(out.error, "missing-field:runtime_version");
});

test("distributed lease paginates comment discovery and does not split-brain when lease is beyond first page", () => {
  const repo = "recallnet/astrochicken";
  const trackingIssue = 902;
  const factoryId = "mothership/factory_supervisor";
  const leaseName = "wave_execute";

  const existingLease = {
    ...makeCanonicalManagedLease({
      factoryId,
      leaseName,
      trackingIssueNumber: String(trackingIssue),
      holderId: "host-a:10:mothership/factory_supervisor:wave_execute",
      runId: "run-a",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:10:00.000Z",
      leaseTtlSec: 600,
      instanceId: "fac_lease_contract",
      installationId: "inst_fac_lease_contract_host-a",
      hostId: "host-a",
    }),
    idempotency_key: "k-a",
    version: 1,
    version_token: "1",
    reclaim_count: 0,
  };

  const comments = Array.from({ length: 150 }, (_, index) => ({
    id: index + 1,
    body: `noise ${index + 1}`,
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
  comments[119] = {
    id: 120,
    body: upsertFactoryDistributedLeaseInComment("lease", existingLease),
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  let createCalls = 0;
  let paginateCalls = 0;

  const spawn = (_bin, args = []) => {
    const argv = Array.isArray(args) ? args.map((entry) => String(entry)) : [];

    if (argv[0] === "api" && argv.some((entry) => entry === `repos/${repo}/issues/${trackingIssue}/comments`)) {
      if (argv.includes("--paginate")) paginateCalls += 1;
      const list = argv.includes("--paginate") ? comments : comments.slice(0, 100);
      return {
        status: 0,
        stdout: `${list.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        stderr: "",
      };
    }

    if (argv[0] === "api" && argv[1] === "-i" && argv.some((entry) => entry === "repos/recallnet/astrochicken/issues/comments/120")) {
      return {
        status: 0,
        stdout: `etag: "1"\ndate: Thu, 01 Jan 2026 00:00:00 GMT\n\n${JSON.stringify({ id: 120, body: comments[119].body, updated_at: comments[119].updated_at })}`,
        stderr: "",
      };
    }

    if (argv[0] === "api" && argv[1] === "-X" && argv[2] === "POST") {
      createCalls += 1;
      return {
        status: 0,
        stdout: JSON.stringify({ id: 999, body: "created", updated_at: "2026-01-01T00:00:00.000Z" }),
        stderr: "",
      };
    }

    return { status: 1, stdout: "", stderr: `unexpected spawn: ${argv.join(" ")}` };
  };

  const client = createFactoryDistributedLeaseGhClient({ spawn });
  const out = acquireFactoryDistributedLease({
    repo,
    trackingIssueNumber: trackingIssue,
    factoryId,
    leaseName,
    runId: "run-b",
    holderId: "host-b:11:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:01.000Z"),
    client,
  });

  assert.equal(paginateCalls > 0, true);
  assert.equal(createCalls, 0);
  assert.equal(out.ok, true);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "lease_owned_by_other");
});

test("distributed lease stale reclaim transfers ownership after expiry policy", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 91 });

  const first = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 91,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-old",
    holderId: "host-old:999:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 60,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(first.acquired, true);

  client.setNow("2026-01-01T00:02:00.000Z");
  const reclaimed = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 91,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-new",
    holderId: "host-new:1001:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 60,
    reclaimGraceMs: 0,
    nowEpochMs: Date.parse("2026-01-01T00:02:00.000Z"),
    client,
  });

  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.reason, "lease_reclaimed_stale");
  assert.equal(reclaimed.lease.reclaimed_from_run_id, "run-old");
  assert.equal(Number(reclaimed.lease.reclaim_count), 1);
});

test("distributed lease stale TTL short-window returns deterministic stale-lease code", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 914 });

  const staleLease = {
    ...makeCanonicalManagedLease({
      trackingIssueNumber: "914",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:10.000Z",
      leaseTtlSec: 120,
    }),
    lease_ttl_sec: 1200,
    expires_at: "2026-01-01T00:00:10.000Z",
    lease_expires_at: "2026-01-01T00:00:10.000Z",
  };

  const seeded = client.createComment({
    issueNumber: 914,
    body: upsertFactoryDistributedLeaseInComment("seed", staleLease),
  });
  assert.equal(seeded.ok, true);

  const out = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 914,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-new",
    holderId: "host-new:1001:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 60,
    reclaimGraceMs: 0,
    nowEpochMs: Date.parse("2026-01-01T00:02:00.000Z"),
    client,
  });

  assert.equal(out.ok, false);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "stale-lease");
  assert.equal(out.reason_detail, "stale-lease:ttl_window_short");
});

test("distributed lease rejects each missing required managed schema field", () => {
  const requiredFields = [...MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS];

  for (const [index, field] of requiredFields.entries()) {
    const trackingIssueNumber = 930 + index;
    const client = createInMemoryLeaseClient({ trackingIssueNumber });
    const malformed = {
      ...makeCanonicalManagedLease({
        trackingIssueNumber: String(trackingIssueNumber),
      }),
      [field]: "",
    };

    const seeded = client.createComment({
      issueNumber: trackingIssueNumber,
      body: upsertFactoryDistributedLeaseInComment("seed", malformed),
    });
    assert.equal(seeded.ok, true, `seed should succeed for field ${field}`);

    const out = acquireFactoryDistributedLease({
      repo: "recallnet/astrochicken",
      trackingIssueNumber,
      factoryId: "mothership/factory_supervisor",
      leaseName: "wave_execute",
      runId: `run-missing-${field}`,
      holderId: `host-new:${index + 1}:mothership/factory_supervisor:wave_execute`,
      leaseSeconds: 120,
      nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
      client,
    });

    assert.equal(out.ok, false, `expected validation failure for ${field}`);
    assert.equal(out.acquired, false, `expected acquire=false for ${field}`);
    assert.equal(out.reason, "missing-field", `expected missing-field for ${field}`);
    assert.equal(out.reason_detail, `missing-field:${field}`, `expected field-specific detail for ${field}`);
  }
});

test("distributed lease release is owner-scoped and idempotent", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 92 });

  const acquired = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 92,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-release",
    holderId: "host-a:55:mothership/factory_supervisor:wave_dispatch",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });
  assert.equal(acquired.acquired, true);

  const denied = releaseFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 92,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-other",
    holderId: "host-b:77:mothership/factory_supervisor:wave_dispatch",
    reason: "not_owner",
    nowEpochMs: Date.parse("2026-01-01T00:00:01.000Z"),
    client,
  });
  assert.equal(denied.released, false);
  assert.equal(denied.reason, "lease_owned_by_other");

  const deniedSameRunDifferentHolder = releaseFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 92,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-release",
    holderId: "host-b:77:mothership/factory_supervisor:wave_dispatch",
    reason: "not_owner_same_run",
    nowEpochMs: Date.parse("2026-01-01T00:00:01.500Z"),
    client,
  });
  assert.equal(deniedSameRunDifferentHolder.released, false);
  assert.equal(deniedSameRunDifferentHolder.reason, "lease_owned_by_other");

  const released = releaseFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 92,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-release",
    holderId: "host-a:55:mothership/factory_supervisor:wave_dispatch",
    reason: "terminal_complete",
    nowEpochMs: Date.parse("2026-01-01T00:00:02.000Z"),
    client,
  });
  assert.equal(released.released, true);

  const second = releaseFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 92,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_dispatch",
    runId: "run-release",
    holderId: "host-a:55:mothership/factory_supervisor:wave_dispatch",
    reason: "terminal_complete",
    nowEpochMs: Date.parse("2026-01-01T00:00:03.000Z"),
    client,
  });
  assert.equal(second.released, false);
  assert.equal(second.reason, "lease_already_released");
});

test("resolveFactoryTrackingIssueNumber uses factory config tracking issue when repo matches target_repo", () => {
  const previous = process.env.FACTORY_TRACKING_ISSUE_NUMBER;
  delete process.env.FACTORY_TRACKING_ISSUE_NUMBER;
  try {
    const out = resolveFactoryTrackingIssueNumber({
      repo: "acme/target",
      trackingIssueNumber: "",
      factoryConfig: {
        factory_id: "acme",
        target_repo: "acme/target",
        tracking_issue: "https://github.com/acme/target/issues/321",
      },
      client: {
        listOpenIssues: () => ({ ok: false, error: "should_not_be_called" }),
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.source, "factory_config");
    assert.equal(out.tracking_issue_number, "321");
  } finally {
    if (previous === undefined) delete process.env.FACTORY_TRACKING_ISSUE_NUMBER;
    else process.env.FACTORY_TRACKING_ISSUE_NUMBER = previous;
  }
});

test("resolveFactoryTrackingIssueNumber keeps explicit arg precedence over repo default", () => {
  const out = resolveFactoryTrackingIssueNumber({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: "999",
    client: {
      listOpenIssues: () => ({ ok: false, error: "should_not_be_called" }),
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.source, "arg");
  assert.equal(out.tracking_issue_number, "999");
});

test("distributed lease backend unavailable yields deterministic defer output", () => {
  const out = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 99,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-unavailable",
    client: {
      listLeaseComments: () => ({ ok: false, error: "backend_down" }),
      getComment: () => ({ ok: false, error: "backend_down" }),
      updateComment: () => ({ ok: false, error: "backend_down" }),
      createComment: () => ({ ok: false, error: "backend_down" }),
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "lease_backend_unavailable");
});

test("loadLeaseSnapshot exposes candidates and marks ambiguity when two active lease comments exist", () => {
  const client = createInMemoryLeaseClient({ trackingIssueNumber: 940 });

  const leaseA = makeCanonicalManagedLease({
    trackingIssueNumber: "940",
    holderId: "host-a:10:mothership/factory_supervisor:wave_execute",
    runId: "run-a",
    acquiredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:10:00.000Z",
    hostId: "host-a",
  });
  const leaseB = makeCanonicalManagedLease({
    trackingIssueNumber: "940",
    holderId: "host-b:11:mothership/factory_supervisor:wave_execute",
    runId: "run-b",
    acquiredAt: "2026-01-01T00:00:01.000Z",
    expiresAt: "2099-01-01T00:10:01.000Z",
    hostId: "host-b",
    installationId: "inst_fac_lease_contract_host-b",
  });

  client.createComment({ issueNumber: 940, body: upsertFactoryDistributedLeaseInComment("lease-a", leaseA) });
  client.createComment({ issueNumber: 940, body: upsertFactoryDistributedLeaseInComment("lease-b", leaseB) });

  const snapshot = loadLeaseSnapshot({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 940,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    client,
    nowEpochMs: Date.parse("2026-01-01T00:00:05.000Z"),
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.present, true);
  assert.equal(snapshot.ambiguous, true);
  assert.equal(Array.isArray(snapshot.candidates), true);
  assert.equal(snapshot.candidates.length, 2);
  assert.equal(snapshot.candidates.every((candidate) => candidate.active === true), true);
  assert.deepEqual(snapshot.candidates.map((candidate) => candidate.comment_id), [1, 2]);
});

test("distributed lease acquire fails closed on ambiguity, records incident, pauses, and does not create/update", () => {
  resetLeaseSafetyIncidentCacheForTests();

  const client = createInMemoryLeaseClient({ trackingIssueNumber: 941 });
  const leaseA = makeCanonicalManagedLease({
    trackingIssueNumber: "941",
    holderId: "host-a:10:mothership/factory_supervisor:wave_execute",
    runId: "run-a",
    expiresAt: "2099-01-01T00:10:00.000Z",
    hostId: "host-a",
  });
  const leaseB = makeCanonicalManagedLease({
    trackingIssueNumber: "941",
    holderId: "host-b:11:mothership/factory_supervisor:wave_execute",
    runId: "run-b",
    acquiredAt: "2026-01-01T00:00:01.000Z",
    expiresAt: "2099-01-01T00:10:01.000Z",
    hostId: "host-b",
    installationId: "inst_fac_lease_contract_host-b",
  });

  client.createComment({ issueNumber: 941, body: upsertFactoryDistributedLeaseInComment("lease-a", leaseA) });
  client.createComment({ issueNumber: 941, body: upsertFactoryDistributedLeaseInComment("lease-b", leaseB) });

  let createCalls = 0;
  let updateCalls = 0;
  const trackingClient = {
    ...client,
    createComment(args) {
      createCalls += 1;
      return client.createComment(args);
    },
    updateComment(args) {
      updateCalls += 1;
      return client.updateComment(args);
    },
  };

  const persistedPackets = [];
  const controlActions = [];
  const out = acquireFactoryDistributedLease({
    repo: "recallnet/astrochicken",
    trackingIssueNumber: 941,
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-new",
    holderId: "host-c:12:mothership/factory_supervisor:wave_execute",
    leaseSeconds: 120,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client: trackingClient,
    packetRepo: process.cwd(),
    controlStateRootDir: process.cwd(),
    leaseSafetyFn(args) {
      return enforceLeaseSafetyForSnapshot({
        ...args,
        persistIncidentPacketFn({ packet }) {
          persistedPackets.push(packet);
          return { packet_path: "/tmp/incident_packet.json" };
        },
        readExternalFactoryControlStateFn() {
          return {
            action_state: { pause: { active: false } },
          };
        },
        applyExternalFactoryControlActionFn(action) {
          controlActions.push(action);
          return {
            ok: true,
            state_action: "pause",
            state: { action_state: { pause: { active: true } } },
          };
        },
      });
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.acquired, false);
  assert.equal(out.reason, "lease_ambiguous");
  assert.equal(createCalls, 0);
  assert.equal(updateCalls, 0);
  assert.equal(Boolean(out.incident_fingerprint), true);
  assert.equal(out.incident_packet_persisted, true);
  assert.equal(persistedPackets.length, 1);
  assert.equal(persistedPackets[0].classification, "platform");
  assert.equal(persistedPackets[0].instance_id, "mothership/factory_supervisor");
  assert.equal(persistedPackets[0].host_id, "host-c");
  assert.equal(controlActions.length, 1);
  assert.equal(controlActions[0].action, "pause");
  assert.equal(controlActions[0].reason, "lease_split_brain");
  assert.equal(controlActions[0].actor, "lease-safety");
  assert.equal(controlActions[0].factoryId, "mothership/factory_supervisor");
});

test("lease safety helper dedupes split-brain incident + pause on repeated ambiguous acquisitions", () => {
  resetLeaseSafetyIncidentCacheForTests();

  const baseCandidates = [
    {
      comment_id: 1,
      holder_id: "host-a:10:mothership/factory_supervisor:wave_execute",
      run_id: "run-a",
      expires_at: "2099-01-01T00:10:00.000Z",
      status: "active",
      active: true,
      released: false,
      reclaimable: false,
      payload_invalid: false,
    },
    {
      comment_id: 2,
      holder_id: "host-b:11:mothership/factory_supervisor:wave_execute",
      run_id: "run-b",
      expires_at: "2099-01-01T00:10:01.000Z",
      status: "active",
      active: true,
      released: false,
      reclaimable: false,
      payload_invalid: false,
    },
  ];

  const snapshot = {
    ambiguous: true,
    candidates: baseCandidates,
    lease: makeCanonicalManagedLease({
      holderId: "host-a:10:mothership/factory_supervisor:wave_execute",
      runId: "run-a",
      expiresAt: "2099-01-01T00:10:00.000Z",
    }),
  };

  const persistCalls = [];
  const pauseCalls = [];

  const first = enforceLeaseSafetyForSnapshot({
    repo: "recallnet/astrochicken",
    packetRepo: process.cwd(),
    controlStateRootDir: process.cwd(),
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-c",
    holderId: "host-c:12:mothership/factory_supervisor:wave_execute",
    instanceId: "mothership/factory_supervisor",
    hostId: "host-c",
    runtimeVersion: "1.2.3",
    snapshot,
    persistIncidentPacketFn({ packet }) {
      persistCalls.push(packet);
      return { packet_path: "/tmp/incident-1.json" };
    },
    readExternalFactoryControlStateFn() {
      return { action_state: { pause: { active: false } } };
    },
    applyExternalFactoryControlActionFn(action) {
      pauseCalls.push(action);
      return { ok: true, state_action: "pause", state: { action_state: { pause: { active: true } } } };
    },
  });

  const second = enforceLeaseSafetyForSnapshot({
    repo: "recallnet/astrochicken",
    packetRepo: process.cwd(),
    controlStateRootDir: process.cwd(),
    factoryId: "mothership/factory_supervisor",
    leaseName: "wave_execute",
    runId: "run-d",
    holderId: "host-d:13:mothership/factory_supervisor:wave_execute",
    instanceId: "mothership/factory_supervisor",
    hostId: "host-d",
    runtimeVersion: "1.2.3",
    snapshot,
    persistIncidentPacketFn({ packet }) {
      persistCalls.push(packet);
      return { packet_path: "/tmp/incident-2.json" };
    },
    readExternalFactoryControlStateFn() {
      return { action_state: { pause: { active: false } } };
    },
    applyExternalFactoryControlActionFn(action) {
      pauseCalls.push(action);
      return { ok: true, state_action: "pause", state: { action_state: { pause: { active: true } } } };
    },
  });

  assert.equal(first.ambiguous, true);
  assert.equal(first.deduped, false);
  assert.equal(first.incident_packet_persisted, true);
  assert.equal(second.ambiguous, true);
  assert.equal(second.deduped, true);
  assert.equal(second.incident_packet_persisted, false);
  assert.equal(persistCalls.length, 1);
  assert.equal(pauseCalls.length, 1);
  assert.equal(first.incident_fingerprint, second.incident_fingerprint);
});
