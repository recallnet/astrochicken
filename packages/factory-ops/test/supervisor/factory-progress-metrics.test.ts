import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectFactoryProgressMetrics, formatFactoryProgressMetrics } from "../../src/commands/factory-progress-metrics.ts";

function makeGraphqlStub() {
  return (query, fallback = {}) => {
    if (String(query).includes("label:goal label:ready")) {
      return {
        data: {
          search: {
            nodes: [
              { number: 1, blockedBy: { nodes: [] } },
              { number: 2, blockedBy: { nodes: [{ number: 99, state: "OPEN" }] } },
            ],
          },
        },
      };
    }
    if (String(query).includes("label:feature")) {
      return {
        data: {
          search: {
            nodes: [
              { number: 10, blockedBy: { nodes: [{ number: 1, state: "CLOSED" }] } },
              { number: 11, blockedBy: { nodes: [{ number: 2, state: "OPEN" }] } },
              { number: 12, blockedBy: { nodes: [] } },
            ],
          },
        },
      };
    }
    if (String(query).includes("label:bug")) {
      return {
        data: {
          search: {
            nodes: [
              { number: 20, blockedBy: { nodes: [] } },
              { number: 21, blockedBy: { nodes: [] } },
            ],
          },
        },
      };
    }
    return fallback;
  };
}

test("collectFactoryProgressMetrics computes unblocked goal/feature counts", () => {
  const out = collectFactoryProgressMetrics({ repo: "recallnet/astrochicken", ghGraphqlFn: makeGraphqlStub() });
  assert.equal(out.goals_ready_total, 2);
  assert.equal(out.goals_ready_unblocked, 1);
  assert.equal(out.goals_ready_blocked, 1);

  assert.equal(out.features_open_total, 3);
  assert.equal(out.features_open_unblocked, 2);
  assert.equal(out.features_open_blocked, 1);

  assert.equal(out.bugs_open_total, 2);
});

test("collectFactoryProgressMetrics surfaces stalled wave telemetry", () => {
  const runsDir = join(tmpdir(), `factory-progress-${Date.now()}`);
  const runId = "run-1";
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId,
    status: "completed",
    context: {
      stalled_wave_telemetry: JSON.stringify([
        {
          wave_issue_number: 40,
          milestone: "goal-10-wave-1",
          reason: "wave_marker_stale",
          wave_stale_minutes: 42,
          threshold_minutes: 20,
          open_feature_count: 2,
          open_feature_numbers: [101, 102],
        },
        {
          wave_issue_number: 41,
          milestone: "goal-10-wave-2",
          reason: "feature_inactivity_stale",
          wave_stale_minutes: 55,
          threshold_minutes: 20,
          open_feature_count: 1,
          open_feature_numbers: [103],
        },
      ]),
    },
  }));

  const out = collectFactoryProgressMetrics({
    repo: "recallnet/astrochicken",
    ghGraphqlFn: makeGraphqlStub(),
    runsDir,
  });

  assert.equal(out.stalled_wave_count, 2);
  assert.equal(out.stalled_wave_feature_count, 3);
  assert.deepEqual(out.stalled_wave_feature_ids, [101, 102, 103]);
  assert.ok(Array.isArray(out.stalled_waves));
  assert.equal(out.stalled_waves.length, 2);
});

test("collectFactoryProgressMetrics counts stalled waves beyond summary cap", () => {
  const runsDir = join(tmpdir(), `factory-progress-${Date.now()}-cap`);
  const runId = "run-2";
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const telemetry = Array.from({ length: 12 }, (_, i) => ({
    wave_issue_number: 200 + i,
    milestone: `goal-99-wave-${i + 1}`,
    reason: "wave_marker_stale",
    wave_stale_minutes: 30 + i,
    threshold_minutes: 20,
    open_feature_count: 1,
    open_feature_numbers: [900 + i],
  }));
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId,
    status: "completed",
    context: {
      stalled_wave_telemetry: JSON.stringify(telemetry),
    },
  }));

  const out = collectFactoryProgressMetrics({
    repo: "recallnet/astrochicken",
    ghGraphqlFn: makeGraphqlStub(),
    runsDir,
  });

  assert.equal(out.stalled_wave_count, 12);
  assert.equal(out.stalled_wave_feature_count, 12);
  assert.equal(out.stalled_waves.length, 10);
});

test("collectFactoryProgressMetrics returns missing_repo error", () => {
  const out = collectFactoryProgressMetrics({ repo: "" });
  assert.equal(out.error, "missing_repo");
});

test("formatFactoryProgressMetrics emits compact line", () => {
  const line = formatFactoryProgressMetrics({
    goals_ready_unblocked: 3,
    goals_ready_total: 8,
    features_open_unblocked: 5,
    features_open_total: 11,
    bugs_open_total: 4,
    stalled_wave_count: 2,
    stalled_wave_feature_count: 3,
    stalled_wave_feature_ids: [101, 102, 103],
  });
  assert.match(line, /goals_ready_unblocked=3\/8/);
  assert.match(line, /features_unblocked=5\/11/);
  assert.match(line, /open_bugs=4/);
  assert.match(line, /stalled_waves=2/);
  assert.match(line, /stalled_wave_features=3/);
  assert.match(line, /stalled_wave_feature_ids=101,102,103/);
});
