import assert from "node:assert/strict";
import test from "node:test";

import {
  factoryFleetTriageQueues,
  formatFleetTriageQueues,
} from "../../src/commands/factory-fleet-triage-queues.ts";

test("factoryFleetTriageQueues returns projection from reader.asFleetTriage", () => {
  const out = factoryFleetTriageQueues({
    lookbackHours: 12,
    now: Date.parse("2026-03-17T03:00:00.000Z"),
    reader: {
      asFleetTriage(opts = {}) {
        assert.equal(opts.lookbackHours, 12);
        return {
          ok: true,
          schema_version: "fleet_triage_incidents.v1",
          generated_at: "2026-03-17T03:00:00.000Z",
          queue: [
            {
              queue_type: "platform_incident",
              backlog_age: 360,
              support_owner: "ops-platform",
              service_tier: "premium",
              affected_instances: ["alpha", "beta"],
              fingerprint: "fp-shared",
            },
          ],
          totals: {
            queue_items: 1,
            fingerprints: 1,
            affected_instances: 2,
            by_queue_type: { platform_incident: 1 },
          },
          warnings: [],
        };
      },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.queue.length, 1);
  assert.equal(out.queue[0].fingerprint, "fp-shared");
});

test("formatFleetTriageQueues renders deterministic human table", () => {
  const text = formatFleetTriageQueues({
    generated_at: "2026-03-17T03:00:00.000Z",
    queue: [
      {
        queue_type: "platform_incident",
        backlog_age: 125,
        support_owner: "ops-platform",
        service_tier: "premium",
        affected_instances: ["alpha", "beta"],
        fingerprint: "fp-shared",
      },
    ],
  });

  assert.match(text, /Fleet incident triage generated_at=2026-03-17T03:00:00.000Z items=1/);
  assert.match(text, /queue_type\s+backlog\s+owner\s+tier\s+affected\s+fingerprint/i);
  assert.match(text, /platform_incident/);
  assert.match(text, /fp-shared/);
});
