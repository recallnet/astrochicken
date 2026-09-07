import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFleetQueueRow,
  formatBlastRadius,
  buildFleetTriageQueuesView,
  buildFleetTriageBlastRadiusView,
  runFleetTriageQueues,
  runFleetTriageBlastRadius,
  formatFleetTriageQueuesHuman,
  formatFleetTriageBlastRadiusHuman,
} from "../../src/commands/factory-fleet-triage.ts";

function sampleProjection() {
  return {
    schema_version: "fleet_triage_queues.v1",
    generated_at: "2026-03-17T05:00:00.000Z",
    queue_metadata: {},
    platform_incidents: [
      {
        fingerprint: "fp-shared",
        queue_reasons: ["severity=error"],
        severity: "error",
        support_owner: "ops-platform",
        service_tier: "premium",
        affected_instances: ["alpha", "beta"],
        blast_radius: {
          affected_instance_count: 2,
          services_impacted: ["example/alpha", "example/beta"],
          support_owner: "ops-platform",
          service_tier: "premium",
        },
        ranking: {
          rank: 1,
          priority_score: 250.5,
        },
      },
    ],
    local_instance_incidents: [],
    blocked_instances: [
      {
        fingerprint: "blocked:alpha",
        queue_reasons: ["blocked_local"],
        severity: "medium",
        instance_id: "alpha",
        support_owner: "ops-platform",
        service_tier: "premium",
        blocked_duration_seconds: 120,
        backlog_age_seconds: 360,
        ranking: {
          rank: 1,
          priority_score: 100,
        },
      },
    ],
    repeated_failure_risk: [],
    upgrade_drift: [],
    host_capacity_pressure: [],
  };
}

test("formatFleetQueueRow normalizes queue fields", () => {
  const row = formatFleetQueueRow({
    queueType: "blocked_instances",
    item: sampleProjection().blocked_instances[0],
  });

  assert.equal(row.queueType, "blocked_instances");
  assert.equal(row.fingerprint, "blocked:alpha");
  assert.equal(row.priorityScore, 100);
  assert.equal(row.blockedDuration, 120);
  assert.equal(row.backlogAge, 360);
  assert.equal(row.supportOwner, "ops-platform");
  assert.equal(row.serviceTier, "premium");
  assert.deepEqual(row.affectedInstances, ["alpha"]);
});

test("formatBlastRadius projects deduped platform fingerprint details", () => {
  const blast = formatBlastRadius({
    queueType: "platform_incidents",
    item: sampleProjection().platform_incidents[0],
  });

  assert.equal(blast.fingerprint, "fp-shared");
  assert.equal(blast.affectedInstanceCount, 2);
  assert.deepEqual(blast.servicesImpacted, ["example/alpha", "example/beta"]);
  assert.equal(blast.supportOwner, "ops-platform");
});

test("buildFleetTriageQueuesView flattens and ranks all queue rows", () => {
  const report = buildFleetTriageQueuesView({ projection: sampleProjection() });
  assert.equal(report.schemaVersion, "fleet_triage_queues.v1");
  assert.equal(report.generatedAt, "2026-03-17T05:00:00.000Z");
  assert.equal(report.items.length, 2);
  assert.equal(report.items[0].fingerprint, "fp-shared");
});

test("buildFleetTriageBlastRadiusView returns deterministic error and success payloads", () => {
  const missing = buildFleetTriageBlastRadiusView({ projection: sampleProjection(), fingerprint: "" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error_code, "fingerprint_required");

  const found = buildFleetTriageBlastRadiusView({ projection: sampleProjection(), fingerprint: "fp-shared" });
  assert.equal(found.ok, true);
  assert.equal(found.blastRadius.fingerprint, "fp-shared");
});

test("runFleetTriageQueues and runFleetTriageBlastRadius consume injected projection loader", async () => {
  const projection = sampleProjection();
  const loadProjectionFn = async () => projection;

  const queues = await runFleetTriageQueues({ loadProjectionFn });
  assert.equal(queues.items.length, 2);

  const blast = await runFleetTriageBlastRadius({ loadProjectionFn, fingerprint: "fp-shared" });
  assert.equal(blast.ok, true);
  assert.equal(blast.blastRadius.affectedInstanceCount, 2);

  const bad = await runFleetTriageBlastRadius({ loadProjectionFn, fingerprint: "" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error_code, "fingerprint_required");
});

test("human formatters include key triage columns", () => {
  const queuesText = formatFleetTriageQueuesHuman(buildFleetTriageQueuesView({ projection: sampleProjection() }));
  assert.match(queuesText, /rank queue\s+priority blocked\s+backlog\s+owner\s+tier\s+affected/i);
  assert.match(queuesText, /fp-shared/);

  const blastText = formatFleetTriageBlastRadiusHuman({
    blastRadius: formatBlastRadius({ queueType: "platform_incidents", item: sampleProjection().platform_incidents[0] }),
  });
  assert.match(blastText, /fingerprint=fp-shared/);
  assert.match(blastText, /routing\s+: owner=ops-platform tier=premium/);
});
