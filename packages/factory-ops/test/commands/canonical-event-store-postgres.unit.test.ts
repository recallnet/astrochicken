import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureCanonicalEventStoreBootstrap,
  resolveCanonicalEventStoreBootstrapPaths,
} from "../../src/commands/host-canonical-event-store-postgres.ts";

test("canonical event store bootstrap writes persistent-volume compose contract and backup paths", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-bootstrap-"));

  try {
    const paths = ensureCanonicalEventStoreBootstrap({ repoRoot });
    const composeText = readFileSync(paths.composePath, "utf8");
    const envText = readFileSync(paths.envPath, "utf8");

    assert.match(composeText, /healthcheck:/);
    assert.match(composeText, /pg_isready/);
    assert.match(composeText, /\/var\/lib\/postgresql\/data/);
    assert.match(composeText, /\/backups/);
    assert.match(envText, /POSTGRES_DB=astrochicken_factory/);
    assert.equal(paths.backupsDir.endsWith(path.join("backups")), true);
    assert.equal(paths.dataDir.endsWith(path.join("data")), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("canonical event store bootstrap resolves deterministic state paths under repo .hatch", () => {
  const paths = resolveCanonicalEventStoreBootstrapPaths({
    repoRoot: "/repo/root",
  });

  assert.equal(paths.stateRoot, path.resolve("/repo/root", ".hatch", "postgres", "canonical-event-store"));
  assert.equal(paths.composePath.endsWith(path.join("canonical-event-store.compose.yml")), true);
  assert.equal(paths.envPath.endsWith(path.join("canonical-event-store.env")), true);
});
