import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  classifyDuplicateClaims,
  computeCapacitySnapshot,
  measureRefillLatency,
} from "../src/commands/wave-throughput-invariants.ts";
import { waveThroughputReport } from "../src/commands/wave-throughput-report.ts";
import { WAVE_READY_LEASE_EVENT_PREFIX, WAVE_READY_LEASE_EVENT_SCHEMA_VERSION } from "../src/commands/wave-claim.ts";

function event({ action, milestone, issue, at, reason = "" }) {
  return {
    schema_version: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
    action,
    milestone_title: milestone,
    ready_issue_number: String(issue),
    run_id: "run-1",
    pipeline: "wave_execute",
    reason,
    at,
  };
}

function leaseComment(payload) {
  return {
    body: `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify(payload)}`,
    created_at: payload.at,
  };
}

test("computeCapacitySnapshot sets idle_with_runnable_backlog only when backlog and capacity coexist", () => {
  assert.deepEqual(
    computeCapacitySnapshot({ readyWaveCount: 2, activeWaveCount: 1, maxConcurrentWaves: 3 }),
    {
      ready_backlog_count: 2,
      active_wave_count: 1,
      max_concurrent_waves: 3,
      idle_slot_count: 2,
      idle_with_runnable_backlog: true,
    },
  );

  assert.equal(
    computeCapacitySnapshot({ readyWaveCount: 0, activeWaveCount: 1, maxConcurrentWaves: 3 }).idle_with_runnable_backlog,
    false,
  );

  assert.equal(
    computeCapacitySnapshot({ readyWaveCount: 2, activeWaveCount: 3, maxConcurrentWaves: 3 }).idle_with_runnable_backlog,
    false,
  );
});

test("measureRefillLatency computes deterministic samples and percentile summary", () => {
  const out = measureRefillLatency({
    leaseEvents: [
      event({ action: "claim", milestone: "goal-1-wave-2", issue: 302, at: "2026-01-01T00:00:20.000Z" }),
      event({ action: "release", milestone: "goal-1-wave-1", issue: 301, at: "2026-01-01T00:00:10.000Z" }),
      event({ action: "release", milestone: "goal-1-wave-3", issue: 303, at: "2026-01-01T00:00:30.000Z" }),
      event({ action: "claim", milestone: "goal-1-wave-4", issue: 304, at: "2026-01-01T00:00:32.000Z" }),
      event({ action: "release", milestone: "goal-1-wave-5", issue: 305, at: "2026-01-01T00:00:40.000Z" }),
      event({ action: "claim", milestone: "goal-1-wave-6", issue: 306, at: "2026-01-01T00:00:50.000Z" }),
    ],
  });

  assert.equal(out.sample_count, 3);
  assert.deepEqual(out.samples.map((sample) => sample.latency_ms), [10000, 2000, 10000]);
  assert.equal(out.latest_ms, 10000);
  assert.equal(out.p50_ms, 10000);
  assert.equal(out.p95_ms, 10000);
});

test("classifyDuplicateClaims separates expected contention from unsafe drift", () => {
  const out = classifyDuplicateClaims({
    leaseEvents: [
      event({ action: "claim", milestone: "goal-1-wave-1", issue: 101, at: "2026-01-01T00:00:00.000Z" }),
      event({ action: "claim", milestone: "goal-1-wave-1", issue: 101, at: "2026-01-01T00:00:01.000Z" }),
      event({ action: "release", milestone: "goal-1-wave-1", issue: 101, at: "2026-01-01T00:00:02.000Z" }),
      event({ action: "claim", milestone: "goal-2-wave-1", issue: 201, at: "2026-01-01T00:01:00.000Z" }),
      event({ action: "claim", milestone: "goal-2-wave-1", issue: 201, at: "2026-01-01T00:01:01.000Z" }),
    ],
  });

  assert.equal(out.total_duplicate_claims, 2);
  assert.equal(out.expected_contention_count, 1);
  assert.equal(out.unsafe_drift_count, 1);
  assert.equal(out.expected_contention[0].reason, "loser_after_winner_with_release");
  assert.equal(out.unsafe_drift[0].reason, "concurrent_claim_without_matching_release");
});

test("waveThroughputReport returns capacity snapshot, refill latency, and duplicate diagnostics", () => {
  const issues = [
    {
      number: 100,
      title: "Wave Ready: goal-1-wave-1",
      state: "OPEN",
      milestone: { title: "goal-1-wave-1" },
      labels: [{ name: "ready" }],
    },
    {
      number: 101,
      title: "Wave Ready: goal-1-wave-2",
      state: "OPEN",
      milestone: { title: "goal-1-wave-2" },
      labels: [{ name: "ready" }, { name: "wave-in-progress" }],
    },
    {
      number: 102,
      title: "Wave Ready: goal-1-wave-3",
      state: "CLOSED",
      milestone: { title: "goal-1-wave-3" },
      labels: [{ name: "ready" }],
    },
  ];

  const commentsByIssue = new Map([
    ["100", [leaseComment(event({ action: "release", milestone: "goal-1-wave-1", issue: 100, at: "2026-01-01T00:00:00.000Z" }))]],
    ["101", [
      leaseComment(event({ action: "claim", milestone: "goal-1-wave-2", issue: 101, at: "2026-01-01T00:00:03.000Z" })),
      leaseComment(event({ action: "claim", milestone: "goal-1-wave-2", issue: 101, at: "2026-01-01T00:00:04.000Z" })),
    ]],
    ["102", [
      leaseComment(event({ action: "claim", milestone: "goal-1-wave-3", issue: 102, at: "2026-01-01T00:00:05.000Z" })),
      leaseComment(event({ action: "release", milestone: "goal-1-wave-3", issue: 102, at: "2026-01-01T00:00:06.000Z" })),
    ]],
  ]);

  const ghJsonFn = (args) => {
    if (args[0] === "issue" && args[1] === "list") return issues;
    if (args[0] === "api") {
      const m = String(args[1] || "").match(/\/issues\/(\d+)\/comments/);
      return commentsByIssue.get(String(m?.[1] || "")) || [];
    }
    return [];
  };

  const out = waveThroughputReport({
    repo: "recallnet/astrochicken",
    maxConcurrentWaves: 2,
    ghJsonFn,
    nowEpochMs: Date.parse("2026-01-01T02:00:00.000Z"),
  });

  assert.equal(out.ok, true);
  assert.equal(out.capacity_snapshot.ready_backlog_count, 1);
  assert.equal(out.capacity_snapshot.active_wave_count, 1);
  assert.equal(out.capacity_snapshot.max_concurrent_waves, 2);
  assert.equal(out.capacity_snapshot.idle_with_runnable_backlog, true);
  assert.equal(out.refill_latency.sample_count, 1);
  assert.equal(out.refill_latency.latest_ms, 3000);
  assert.equal(out.duplicate_claims.unsafe_drift_count, 1);
});

test("cli wave throughput-report prints deterministic JSON payload", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-throughput-gh-"));
  const fixturePath = join(binDir, "fixture.json");
  const ghPath = join(binDir, "gh");

  const fixture = {
    issues: [
      {
        number: 200,
        title: "Wave Ready: goal-2-wave-1",
        state: "OPEN",
        milestone: { title: "goal-2-wave-1" },
        labels: [{ name: "ready" }],
      },
    ],
    commentsByIssue: {
      "200": [
        leaseComment(event({ action: "release", milestone: "goal-2-wave-1", issue: 200, at: "2026-01-01T00:00:00.000Z" })),
        leaseComment(event({ action: "claim", milestone: "goal-2-wave-1", issue: 200, at: "2026-01-01T00:00:02.000Z" })),
      ],
    },
  };

  writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nconst data = JSON.parse(readFileSync(process.env.WAVE_THROUGHPUT_FIXTURE, "utf8"));\nconst args = process.argv.slice(2);\nif (args[0] === "issue" && args[1] === "list") { process.stdout.write(JSON.stringify(data.issues)); process.exit(0); }\nif (args[0] === "api") { const m = String(args[1] || "").match(/\\/issues\\/(\\d+)\\/comments/); const issue = String(m?.[1] || ""); process.stdout.write(JSON.stringify(data.commentsByIssue?.[issue] || [])); process.exit(0); }\nprocess.stdout.write("[]");\n`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);

  const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
  const previousPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${previousPath}`;
  process.env.WAVE_THROUGHPUT_FIXTURE = fixturePath;

  try {
    const result = spawnSync("node", [
      cliPath,
      "wave",
      "throughput-report",
      "--repo",
      "recallnet/astrochicken",
      "--max-concurrent",
      "1",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0);
    const out = JSON.parse(String(result.stdout || "{}"));
    assert.equal(out.schema_version, "wave_throughput_report/v1");
    assert.equal(out.capacity_snapshot.ready_backlog_count, 0);
    assert.equal(out.capacity_snapshot.active_wave_count, 1);
    assert.equal(out.refill_latency.sample_count, 1);
    assert.equal(out.refill_latency.latest_ms, 2000);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.WAVE_THROUGHPUT_FIXTURE;
  }
});
