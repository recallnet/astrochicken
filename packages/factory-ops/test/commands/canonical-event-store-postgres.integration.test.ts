import { randomUUID } from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createComposeCommand } from "../../../../scripts/test/helpers/compose-command.ts";

import {
  ensureCanonicalEventStoreBootstrap,
  runCanonicalEventStoreBackup,
  runCanonicalEventStoreBootstrapSmoke,
  runCanonicalEventStoreRestore,
  shutdownCanonicalEventStoreBootstrap,
} from "../../src/commands/host-canonical-event-store-postgres.ts";

test("canonical event store bootstrap smoke starts local Postgres and proves backup/restore", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-integration-"));

  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("fixture_port_allocation_failed"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const paths = ensureCanonicalEventStoreBootstrap({ repoRoot, postgresPort: String(port) });
  const project = `canonical_smoke_${randomUUID().slice(0, 8)}`;
  writeFileSync(paths.envPath, readFileSync(paths.envPath, "utf8").replace("astrochicken-canonical-event-store", project));
  const compose = createComposeCommand({ repoRoot, composePath: paths.composePath, project, envPath: paths.envPath });
  const mergedConfig = compose("config", "--format", "json");
  const config = JSON.parse(mergedConfig);
  assert.equal(config.name, project);
  assert.ok(config.services.postgres.volumes.every(({ type }) => type === "volume"));
  assert.ok(Object.values(config.volumes).every(({ name }: { name: string }) => name.startsWith(`${project}_`)));
  paths.composePath = path.join(repoRoot, "test-compose.json");
  writeFileSync(paths.composePath, mergedConfig);
  try {
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
        paths,
        removeVolumes: true,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});
