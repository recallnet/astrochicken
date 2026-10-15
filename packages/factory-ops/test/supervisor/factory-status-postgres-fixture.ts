import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, after } from "node:test";

import { Pool } from "pg";

import { createComposeCommand, waitForComposePostgres } from "../../../../scripts/test/helpers/compose-command.ts";
import { buildPacketPublishedEvent } from "../../src/lib/canonical-domain-events.ts";
import { appendCanonicalEvents } from "../../src/lib/canonical-event-log.ts";
import { ensureFactoryFleetProjectionSchema } from "../../src/lib/factory-fleet-postgres-projection.ts";
import { findPacketRegistryEntry, isDurablePacketType } from "../../src/lib/packet-core.ts";


const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const composePath = path.resolve(
  repoRoot,
  "packages/factory-ops/config/postgres/canonical-event-store.compose.yml",
);


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
    compose: null,
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
      fixture.compose = createComposeCommand({ repoRoot, composePath, project: fixture.composeProject, envPath: fixture.envPath });
      fixture.compose("up", "-d", "postgres");
      await waitForComposePostgres(fixture.compose, user, db);
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
        await ensureFactoryFleetProjectionSchema({ pool });
      } finally {
        await pool.end();
      }
    },
    async resetEvents() {
      if (!fixture.connectionString) throw new Error("fixture_not_started");
      const pool = new Pool({ connectionString: fixture.connectionString });
      try {
        await pool.query("truncate table factory_events");
        await pool.query("drop table if exists factory_status_projection");
        await pool.query("truncate table factory_fleet_projection");
      } finally { await pool.end(); }
    },
    async seedPacketFile({ packetPath }) {
      const packet = JSON.parse(readFileSync(packetPath, "utf8"));
      const registryEntry = findPacketRegistryEntry(packet.packet_type);
      if (!registryEntry) throw new Error("unregistered_fixture_packet_type");
      await appendCanonicalEvents({
        connectionString: fixture.connectionString,
        events: [buildPacketPublishedEvent({
          factoryId: packet.factory_id,
          runId: packet.run_id,
          packet,
          packetPath,
          storageClass: "factory_run_packet",
          family: registryEntry.family,
          durable: isDurablePacketType(packet.packet_type),
        })],
      });
    },
    async resetProjections() {
      if (!fixture.connectionString) throw new Error("fixture_not_started");
      const pool = new Pool({ connectionString: fixture.connectionString });
      try {
        await pool.query("truncate table factory_fleet_projection");
      } finally {
        await pool.end();
      }
    },
    // @context:regression Status fixtures must establish canonical run membership as well as local artifacts.
    async seedRuns({ runsDir, factoryId = "mothership" }) {
      if (!fixture.connectionString) throw new Error("fixture_not_started");
      const pool = new Pool({ connectionString: fixture.connectionString });
      try {
        await pool.query("truncate table factory_events");
        await pool.query("drop table if exists factory_status_projection");
      } finally {
        await pool.end();
      }
      const events = [];
      for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        let state;
        try { state = JSON.parse(readFileSync(path.join(runsDir, entry.name, "state.json"), "utf8")); }
        catch { continue; }
        events.push({
          event_id: randomUUID(),
          schema: "canonical_event_envelope/v1",
          event_family: "hatch.run.started",
          event_version: 1,
          factory_id: factoryId,
          run_id: state.runId || entry.name,
          emitter: "test.fixture",
          emitted_at: state.startedAt || state.updatedAt || "2026-03-10T00:00:00.000Z",
          event_origin: "runtime",
          payload: { run_id: state.runId || entry.name, node: state.currentNode || "" },
        });
      }
      await appendCanonicalEvents({ connectionString: fixture.connectionString, runsDir, events });
    },
    teardown() {
      try {
        if (fixture.composeProject) {
          fixture.compose?.("down", "-v");
        }
      } finally {
        if (fixture.stateRoot) rmSync(fixture.stateRoot, { recursive: true, force: true });
      }
    },
  };
}

export function useCanonicalEventStoreFixture() {
  const fixture = createCanonicalEventStoreFixture();
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  before(async () => {
    await fixture.setup();
    process.env.HATCH_CANONICAL_EVENT_STORE_URL = fixture.connectionString;
  });
  after(() => {
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
    fixture.teardown();
  });
  return fixture;
}
