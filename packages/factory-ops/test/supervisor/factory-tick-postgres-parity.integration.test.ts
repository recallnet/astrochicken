import { buildLifecycleEvents } from "./canonical-parity.fixture.ts";
import { appendFixtureBatch } from "./canonical-parity.fixture.ts";
import { writeRunState } from "./canonical-parity.fixture.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import { tickStatus as commandTickStatus } from "../../src/commands/factory-tick-status.ts";
import { ensureFactoryTickProjectionSchema, projectFactoryTickToPostgres, readFactoryTickProjection,  } from "../../src/lib/factory-tick-postgres-projection.ts";
import { buildTickProjectionFromStates } from "../../src/lib/factory-tick-run-projection.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";


function readStateMap(runsDir) {
  const states = new Map();
  for (const runId of readdirSync(runsDir)) {
    const file = join(runsDir, runId, "state.json");
    try {
      states.set(runId, JSON.parse(readFileSync(file, "utf8")));
    } catch {}
  }
  return states;
}

function compareKey(value = {}) {
  const entry = value && typeof value === "object" ? value : {};
  return JSON.stringify([
    String(entry.id || entry.run_id || ""),
    String(entry.stage || entry.node || entry.current_node || ""),
    String(entry.status || ""),
    String(entry.issue || entry.goalIssueNumber || ""),
  ]);
}




const fixture = createCanonicalEventStoreFixture();

before(async () => {
  await fixture.setup();
});

after(() => {
  fixture.teardown();
});

for (const scenario of [
  "normal tick",
  "stale tick",
  "paused daemon",
  "active child progress",
]) {
  test(`canonical tick parity: ${scenario}`, async (t) => {
    const rootDir = mkdtempSync(join(tmpdir(), "factory-tick-parity-"));
    const runsDir = join(rootDir, ".hatch", "example-trading", "runs");
    mkdirSync(runsDir, { recursive: true });
    const factoryId = "example-trading";
    const fixedNow = Date.parse("2026-03-26T20:00:00.000Z");
    const tickStartedAt = "2026-03-26T19:30:00.000Z";
    const tickUpdatedAt = scenario === "active child progress"
      ? "2026-03-26T19:30:10.000Z"
      : (scenario === "stale tick" ? "2026-03-26T19:40:00.000Z" : "2026-03-26T19:58:00.000Z");

    const events = [];
    if (scenario === "paused daemon") {
      writeRunState(runsDir, "tick-paused", {
        status: "completed",
        pipelineFile: "factories/example-trading/graphs/factory_supervisor_tick.dot",
        currentNode: "supervisor_review",
        startedAt: "2026-03-26T19:00:00.000Z",
        updatedAt: "2026-03-26T19:10:00.000Z",
        context: {},
      });
      events.push(...buildLifecycleEvents({
        factoryId,
        runId: "tick-paused",
        startedAt: "2026-03-26T19:00:00.000Z",
        updatedAt: "2026-03-26T19:10:00.000Z",
        currentNode: "supervisor_review",
        status: "completed",
        graph: "factory_supervisor_tick",
      }));
    } else {
      const tickState = {
        status: "running",
        pipelineFile: "factories/example-trading/graphs/factory_supervisor_tick.dot",
        currentNode: scenario === "active child progress" ? "run_domain_graph" : "wave_execute",
        startedAt: tickStartedAt,
        updatedAt: tickUpdatedAt,
        context: scenario === "active child progress" ? { __child_run_id_run_domain_graph: "child-1" } : {},
        activeChildren: scenario === "active child progress" ? {
          run_domain_graph__child_1: {
            parentNodeId: "run_domain_graph",
            childRunId: "child-1",
            status: "running",
            currentNode: "fan_out_goal_run",
          },
        } : undefined,
      };
      writeRunState(runsDir, "tick-1", tickState);
      events.push(...buildLifecycleEvents({
        factoryId,
        runId: "tick-1",
        startedAt: tickStartedAt,
        updatedAt: tickUpdatedAt,
        currentNode: tickState.currentNode,
        status: "running",
        graph: "factory_supervisor_tick",
      }));

      if (scenario === "active child progress") {
        writeRunState(runsDir, "child-1", {
          status: "running",
          pipelineFile: "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot",
          currentNode: "fan_out_goal_run",
          startedAt: tickStartedAt,
          updatedAt: "2026-03-26T19:59:30.000Z",
          context: { goal_issue_number: "1462" },
        });
        events.push(...buildLifecycleEvents({
          factoryId,
          runId: "child-1",
          startedAt: tickStartedAt,
          updatedAt: "2026-03-26T19:59:30.000Z",
          currentNode: "fan_out_goal_run",
          status: "running",
          issue: "1462",
          graph: "managed_software_delivery_domain",
        }));
      }
    }

    const pool = new Pool({ connectionString: fixture.connectionString });
    try {
      await pool.query("truncate table factory_events");
      await pool.query("drop table if exists factory_tick_projection");
      await appendFixtureBatch(pool, events);
    } finally {
      await pool.end();
    }

    const restoreNow = t.mock.method(Date, "now", () => fixedNow);
    try {
      const legacyProjection = normalizeDeep(buildTickProjectionFromStates({
        allStates: readStateMap(runsDir),
        runsDir,
        context: { factory_id: factoryId, runs_dir: runsDir, canonical_event_store_url: fixture.connectionString },
        now: fixedNow,
      }));
      await ensureFactoryTickProjectionSchema({ connectionString: fixture.connectionString });
      await projectFactoryTickToPostgres({
        connectionString: fixture.connectionString,
        factoryId,
        runsDir,
        context: { factory_id: factoryId, runs_dir: runsDir, canonical_event_store_url: fixture.connectionString },
        now: fixedNow,
      });
      const projected = await readFactoryTickProjection({
        connectionString: fixture.connectionString,
        factoryId,
      });
      assert.deepEqual(normalizeDeep(projected?.projection || {}), legacyProjection);
    } finally {
      restoreNow.mock.restore();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
}

test("tick cutover: tick-status honors the canonical projection timestamp instead of local wall clock", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-tick-cutover-"));
  const runsDir = join(rootDir, ".hatch", "example-trading", "runs");
  mkdirSync(runsDir, { recursive: true });
  const factoryId = "example-trading";
  const fixedNow = Date.parse("2026-03-26T19:40:00.000Z");

  writeRunState(runsDir, "tick-1", {
    status: "running",
    pipelineFile: "factories/example-trading/graphs/factory_supervisor_tick.dot",
    currentNode: "wave_execute",
    startedAt: "2026-03-26T19:30:00.000Z",
    updatedAt: "2026-03-26T19:58:00.000Z",
    context: {},
  });

  const events = buildLifecycleEvents({
    factoryId,
    runId: "tick-1",
    startedAt: "2026-03-26T19:30:00.000Z",
    updatedAt: "2026-03-26T19:58:00.000Z",
    currentNode: "wave_execute",
    status: "running",
    graph: "factory_supervisor_tick",
  });

  const pool = new Pool({ connectionString: fixture.connectionString });
  try {
    await pool.query("truncate table factory_events");
    await pool.query("drop table if exists factory_tick_projection");
    await appendFixtureBatch(pool, events);
  } finally {
    await pool.end();
  }

  try {
    await ensureFactoryTickProjectionSchema({ connectionString: fixture.connectionString });
    await projectFactoryTickToPostgres({
      connectionString: fixture.connectionString,
      factoryId,
      runsDir,
      context: { factory_id: factoryId, runs_dir: runsDir, canonical_event_store_url: fixture.connectionString },
      now: fixedNow,
    });
    const projected = await readFactoryTickProjection({
      connectionString: fixture.connectionString,
      factoryId,
    });

    const legacyIgnoringNow = buildTickProjectionFromStates({
      allStates: readStateMap(runsDir),
      runsDir,
      context: { factory_id: factoryId, runs_dir: runsDir, canonical_event_store_url: fixture.connectionString },
    });
    assert.notDeepEqual(
      normalizeDeep(legacyIgnoringNow),
      normalizeDeep(projected?.projection || {}),
      "legacy command behavior should drift because it cannot honor the explicit canonical projection timestamp",
    );

    const cutover = commandTickStatus({
      runsDir,
      context: {
        factory_id: factoryId,
        runs_dir: runsDir,
        canonical_event_store_url: fixture.connectionString,
      },
      now: fixedNow,
    });

    assert.equal(cutover.ticks.length, 1);
    assert.deepEqual(normalizeDeep(cutover), normalizeDeep({
      ...projected.projection,
      context: { ...projected.projection.context, canonical_event_store_url: fixture.connectionString },
    }));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function normalizeDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDeep(entry)).sort((left, right) => compareKey(left).localeCompare(compareKey(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeDeep(entry)]),
    );
  }
  return value;
}
