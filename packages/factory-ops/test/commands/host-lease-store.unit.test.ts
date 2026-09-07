import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readLeaseRecord, resolveLeaseRecordPath, writeLeaseRecord } from "../../src/lib/host-lease-store.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("writeLeaseRecord persists canonical lease contract and readLeaseRecord returns it", () => {
  const root = makeTmpDir("host-lease-store-");
  try {
    const installationManifestPath = join(root, "installation.json");
    const now = Date.parse("2026-03-10T01:02:03.000Z");
    const out = writeLeaseRecord({
      instanceId: "mothership",
      installationId: "inst_mothership_host_test",
      hostId: "host_test",
      leaseOwner: "host_test:123:mothership:managed_host_assignment",
      leaseAcquiredAt: now,
      leaseExpiresAt: now + 600_000,
      leaseTtlSec: 600_000,
      runtimeVersion: "1.2.3",
    }, { installationManifestPath });

    assert.match(out.leaseRecordPath, /lease\.json$/);
    assert.equal(out.lease.instance_id, "mothership");
    assert.equal(out.lease.installation_id, "inst_mothership_host_test");
    assert.equal(out.lease.host_id, "host_test");
    assert.equal(out.lease.lease_owner, "host_test:123:mothership:managed_host_assignment");
    assert.equal(out.lease.lease_ttl_sec, 600);
    assert.equal(out.lease.runtime_version, "1.2.3");

    const read = readLeaseRecord({ installationManifestPath });
    assert.equal(read.exists, true);
    assert.deepEqual(read.lease, out.lease);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLeaseRecord rejects malformed records when required fields are missing", () => {
  const root = makeTmpDir("host-lease-store-invalid-");
  try {
    const installationManifestPath = join(root, "installation.json");
    assert.throws(
      () => writeLeaseRecord({
        instanceId: "mothership",
        installationId: "",
        hostId: "host_test",
        leaseOwner: "owner",
        leaseAcquiredAt: "2026-03-10T01:02:03.000Z",
        leaseExpiresAt: "2026-03-10T01:12:03.000Z",
        leaseTtlSec: 600,
        runtimeVersion: "1.2.3",
      }, { installationManifestPath }),
      /missing_required_field:installation_id/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLeaseRecord writes atomically without leftover tmp artifacts", () => {
  const root = makeTmpDir("host-lease-store-atomic-");
  try {
    const installationManifestPath = join(root, "installation.json");
    writeLeaseRecord({
      instanceId: "example-trading",
      installationId: "inst_replay_host_test",
      hostId: "host_test",
      leaseOwner: "host_test:123:example-trading:managed_host_assignment",
      leaseAcquiredAt: "2026-03-10T01:02:03.000Z",
      leaseExpiresAt: "2026-03-10T01:12:03.000Z",
      leaseTtlSec: 600,
      runtimeVersion: "2.0.0",
    }, { installationManifestPath });

    const files = readdirSync(root);
    assert.equal(files.includes("lease.json"), true);
    assert.equal(files.some((name) => name.startsWith(".lease.")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveLeaseRecordPath requires installation manifest path when explicit path missing", () => {
  assert.throws(
    () => resolveLeaseRecordPath({}),
    /lease_record_path_requires_installation_manifest_path/,
  );
});
