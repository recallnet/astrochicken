import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FactoryStateReader } from "../../src/lib/factory-state-reader.ts";

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeRun(runsDir, runId, state = {}) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, "state.json"), {
    runId,
    status: "failed",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    startedAt: "2026-03-17T00:00:00.000Z",
    updatedAt: "2026-03-17T00:10:00.000Z",
    createdAt: "2026-03-17T00:00:00.000Z",
    context: {},
    ...state,
  });
}

test("asFleetTriage groups shared fingerprint rows and aggregates affected_instances", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-triage-contract-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    makeRun(runsDir, "run-alpha", {
      context: {
        factory_id: "alpha",
        incident: {
          queue_type: "platform_incident",
          incident_fingerprint: "fp-shared",
          support_owner: "ops-platform",
          service_tier: "premium",
          affected_instance_id: "alpha",
          blocked_since: "2026-03-16T23:40:00.000Z",
        },
      },
    });

    makeRun(runsDir, "run-beta", {
      context: {
        factory_id: "beta",
        triage: {
          incident: {
            queue_type: "platform_incident",
            incident_fingerprint: "fp-shared",
            support_owner: "ops-platform",
            service_tier: "premium",
            affected_instance_id: "beta",
            blocked_since: "2026-03-16T23:45:00.000Z",
          },
        },
      },
    });

    const reader = new FactoryStateReader(runsDir);
    const report = reader.asFleetTriage({ now: Date.parse("2026-03-17T01:00:00.000Z") });

    assert.equal(report.ok, true);
    assert.equal(Array.isArray(report.queue), true);
    assert.equal(report.queue.length, 1);

    const item = report.queue[0];
    assert.equal(item.queue_type, "platform_incident");
    assert.equal(item.fingerprint, "fp-shared");
    assert.equal(item.support_owner, "ops-platform");
    assert.equal(item.service_tier, "premium");
    assert.deepEqual(item.affected_instances, ["alpha", "beta"]);
    assert.equal(typeof item.backlog_age, "number");
    assert.equal(item.backlog_age > 0, true);
    assert.equal(typeof item.blocked_since, "string");

    assert.equal(report.totals.queue_items, 1);
    assert.equal(report.totals.fingerprints, 1);
    assert.equal(report.totals.affected_instances, 2);
    assert.equal(report.totals.by_queue_type.platform_incident, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("asFleetTriage returns empty queue when incident context is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-triage-missing-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    makeRun(runsDir, "run-no-incident", {
      context: {
        factory_id: "alpha",
        note: "no incident payload",
      },
    });

    const reader = new FactoryStateReader(runsDir);
    const report = reader.asFleetTriage({ now: Date.parse("2026-03-17T01:00:00.000Z") });

    assert.equal(report.ok, true);
    assert.deepEqual(report.queue, []);
    assert.equal(report.totals.queue_items, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
