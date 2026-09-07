import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const composePath = path.resolve(
  repoRoot,
  "packages/factory-ops/config/postgres/canonical-event-store.compose.yml",
);

function runShell(command, env = {}) {
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `command failed: ${command}`);
  }
  return String(result.stdout || "");
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export function createCanonicalEventStoreFixture() {
  const fixture = {
    stateRoot: "",
    envPath: "",
    composeProject: "",
    connectionString: "",
  };

  return {
    get connectionString() {
      return fixture.connectionString;
    },
    async setup() {
      fixture.stateRoot = mkdtempSync(path.join(tmpdir(), "factory-status-postgres-fixture-"));
      fixture.envPath = path.join(fixture.stateRoot, "postgres.env");
      fixture.composeProject = `status_fixture_${randomUUID().slice(0, 8)}`;
      const password = "astrochicken";
      const db = "astrochicken_factory";
      const user = "astrochicken";
      const port = String(await allocatePort());
      writeFileSync(fixture.envPath, [
        `CANONICAL_EVENT_STORE_ROOT=${fixture.stateRoot}`,
        `POSTGRES_DB=${db}`,
        `POSTGRES_USER=${user}`,
        `POSTGRES_PASSWORD=${password}`,
        `POSTGRES_PORT=${port}`,
      ].join("\n") + "\n");
      runShell(`docker compose -p ${fixture.composeProject} -f ${composePath} --env-file ${fixture.envPath} up -d postgres`);
      runShell(`
        for i in {1..30}; do
          if docker compose -p ${fixture.composeProject} -f ${composePath} --env-file ${fixture.envPath} exec -T postgres pg_isready -U ${user} -d ${db} >/dev/null 2>&1; then
            exit 0
          fi
          sleep 1
        done
        exit 1
      `);
      fixture.connectionString = `postgres://${user}:${password}@127.0.0.1:${port}/${db}`;
      const pool = new Pool({ connectionString: fixture.connectionString });
      try {
        await pool.query(`
          create sequence if not exists canonical_event_commit_seq;
          create table if not exists factory_events (
            event_id uuid primary key,
            commit_cursor bigint not null,
            batch_offset integer not null,
            schema text not null,
            event_family text not null,
            event_version integer not null,
            factory_id text not null,
            run_id text,
            emitter text not null,
            emitted_at timestamptz not null,
            recorded_at timestamptz not null default now(),
            event_origin text not null,
            provenance jsonb not null default '{}'::jsonb,
            payload jsonb not null
          );
        `);
      } finally {
        await pool.end();
      }
    },
    teardown() {
      try {
        if (fixture.composeProject) {
          runShell(`docker compose -p ${fixture.composeProject} -f ${composePath} --env-file ${fixture.envPath} down -v`);
        }
      } finally {
        if (fixture.stateRoot) rmSync(fixture.stateRoot, { recursive: true, force: true });
      }
    },
  };
}
