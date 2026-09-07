import assert from "node:assert/strict";
import test from "node:test";

import { buildFleetRolloutActionItems } from "../../src/lib/fleet-rollout-action-items.ts";

test("buildFleetRolloutActionItems returns items only for blocked/lagging factories in six-factory fleet", () => {
  const report = {
    factories: [
      {
        factory_id: "factory-a",
        rollout_status: "ready",
        gate_reason: "ready_to_resume",
        status_detail: "resume gate ready",
        required_factory_release: "2.0.0",
      },
      {
        factory_id: "factory-b",
        rollout_status: "lagging",
        gate_reason: "factory_release_below_required",
        status_detail: "factory release 2.0.0 below required 2.3.0",
        required_factory_release: "2.3.0",
      },
      {
        factory_id: "factory-c",
        rollout_status: "blocked",
        gate_reason: "rejected_upstream",
        status_detail: "upstream release rejected",
        required_factory_release: "2.0.0",
      },
      {
        factory_id: "factory-d",
        rollout_status: "ready",
        gate_reason: "ready_to_resume",
        status_detail: "resume gate ready",
        required_factory_release: "3.0.0",
      },
      {
        factory_id: "factory-e",
        rollout_status: "blocked",
        gate_reason: "rejected_upstream",
        status_detail: "upstream release rejected",
        required_factory_release: "2.0.0",
      },
      {
        factory_id: "factory-f",
        rollout_status: "unknown",
        gate_reason: "missing_policy_entry",
        status_detail: "missing policy/manifest targeting entry",
        required_factory_release: "",
      },
    ],
  };

  const items = buildFleetRolloutActionItems({
    report,
    repo: "example/repo",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  const itemsByFactory = new Map(items.map((item) => [item.factory_id, item]));

  assert.equal(itemsByFactory.has("factory-a"), false);
  assert.equal(itemsByFactory.has("factory-d"), false);
  assert.equal(itemsByFactory.has("factory-f"), false);

  assert.ok(itemsByFactory.has("factory-b"));
  assert.ok(itemsByFactory.has("factory-c"));
  assert.ok(itemsByFactory.has("factory-e"));

  for (const factoryId of ["factory-b", "factory-c", "factory-e"]) {
    const item = itemsByFactory.get(factoryId);
    assert.equal(item.factory_id, factoryId);
    assert.ok(String(item.reason || "").trim().length > 0);
    assert.ok(String(item.message || "").trim().length > 0);
    assert.match(String(item.suggested_action || ""), /release-targeting-status/);
  }
});

test("buildFleetRolloutActionItems returns empty for empty factories", () => {
  const items = buildFleetRolloutActionItems({ report: { factories: [] } });
  assert.deepEqual(items, []);
});

test("buildFleetRolloutActionItems returns empty when all factories are ready", () => {
  const items = buildFleetRolloutActionItems({
    report: {
      factories: [
        { factory_id: "alpha", rollout_status: "ready" },
        { factory_id: "beta", rollout_status: "ready" },
      ],
    },
  });
  assert.deepEqual(items, []);
});
