import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureCanonicalEventStoreBootstrap,
  runCanonicalEventStoreBackup,
  runCanonicalEventStoreBootstrapSmoke,
  runCanonicalEventStoreRestore,
  shutdownCanonicalEventStoreBootstrap,
} from "../../src/commands/host-canonical-event-store-postgres.ts";

test("canonical event store bootstrap smoke starts local Postgres and proves backup/restore", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-integration-"));

  try {
    const paths = ensureCanonicalEventStoreBootstrap({ repoRoot });
    const smoke = await runCanonicalEventStoreBootstrapSmoke({ paths });
    assert.equal(smoke.ok, true);
    assert.equal(smoke.health.ok, true);

    const backup = await runCanonicalEventStoreBackup({ paths, backupLabel: "smoke" });
    assert.equal(backup.ok, true);
    assert.match(backup.backupPath, /smoke/);

    const restore = await runCanonicalEventStoreRestore({ paths, backupPath: backup.backupPath });
    assert.equal(restore.ok, true);
  } finally {
    try {
      await shutdownCanonicalEventStoreBootstrap({
        paths: ensureCanonicalEventStoreBootstrap({ repoRoot }),
        removeVolumes: true,
      });
    } catch {}
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
