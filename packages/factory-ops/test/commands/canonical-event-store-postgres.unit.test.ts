import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import {
  ensureCanonicalEventStoreBootstrap,
  resolveCanonicalEventStoreBootstrapPaths,
  runCanonicalEventStoreBootstrapSmoke,
  runCanonicalEventStoreRestore,
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


test("canonical PostgreSQL commands preserve hostile paths, credentials, and SQL as data without a shell", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "canonical-argv-"));
  const calls = [];
  mock.method(childProcess, "spawnSync", (command, args, options) => {
    assert.equal(command, "docker", "Docker commands must not start a host shell");
    calls.push({ args, options });
    return { status: 0, stdout: args.includes("-Atqc") ? "1" : "-- backup SQL" };
  });
  syncBuiltinESMExports();
  try {
    const paths = ensureCanonicalEventStoreBootstrap({ repoRoot: root, stateRoot: path.join(root, "space $(touch NEVER_EXECUTE)") });
    paths.composePath = path.join(root, "compose `touch NEVER_EXECUTE`.yml");
    const password = "literal $(touch NEVER_EXECUTE); 'quoted'";
    writeFileSync(paths.envPath, readFileSync(paths.envPath, "utf8").replace("POSTGRES_PASSWORD=astrochicken", `POSTGRES_PASSWORD=${password}`));
    assert.equal((await runCanonicalEventStoreBootstrapSmoke({ paths })).ok, true);
    const sql = "select '$' || '$(touch NEVER_EXECUTE)' || '`touch NEVER_EXECUTE`';";
    const backupPath = path.join(root, "restore with spaces.sql");
    writeFileSync(backupPath, sql);
    await runCanonicalEventStoreRestore({ paths, backupPath });
    assert.equal(calls.at(-1).options.input, sql);
    assert.ok(calls.some(({ args }) => args.includes(`PGPASSWORD=${password}`)));
    for (const { args, options } of calls) {
      assert.ok(args.includes(paths.composePath));
      assert.ok(args.includes(paths.envPath));
      assert.equal(options.shell, undefined);
      assert.equal(options.env.PATH, process.env.PATH);
    }
    assert.ok(calls.some(({ args }) => args.includes("pg_isready") && args.includes("127.0.0.1")));
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
