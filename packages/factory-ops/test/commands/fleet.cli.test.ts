import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "fleet-report-cli-"));
  mkdirSync(join(root, "factories", "mothership"), { recursive: true });
  writeJson(join(root, "factories", "mothership", "factory.config.json"), {
    schema: "hatch.factory.config.v1",
    factory_id: "mothership",
    kind_id: "mothership",
    instance_id: "mothership",
    factory_root: "factories/mothership",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: ".hatch/mothership/runs",
    scenarios: {
      root: "factories/mothership/scenarios",
    },
  });

  writeJson(join(root, "factory-registry.json"), {
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "alpha",
        kind_id: "brainstorm",
        target_repo: "example/alpha",
      },
    ],
  });

  const mirrorRoot = join(root, "mirror-store");
  const alphaDir = join(mirrorRoot, "alpha");
  mkdirSync(alphaDir, { recursive: true });

  writeJson(join(alphaDir, "snapshot.json"), {
    schema_version: "managed-factory-snapshot-mirror/v1",
    factory_id: "alpha",
    instance_id: "alpha",
    mirror_updated_at: "2026-03-16T00:05:00.000Z",
    queue_depth: 2,
    oldest_work_age_seconds: 120,
    unresolved_actions: 1,
    lifecycle_state: "blocked_local",
  });

  writeJson(join(mirrorRoot, "events.json"), [
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "completed",
      runtime_version: "1.2.0",
      kind_version: "2026.03.10",
      policy_profile: "stable",
      started_at: "2026-03-16T00:00:00.000Z",
      ended_at: "2026-03-16T00:00:05.000Z",
      total_tokens: 100,
      estimated_cost_usd: 0.01,
      host_id: "host-a",
    },
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "failed",
      runtime_version: "1.2.0",
      kind_version: "2026.03.10",
      policy_profile: "stable",
      incident_fingerprint: "inc-1",
      started_at: "2026-03-16T00:01:00.000Z",
      ended_at: "2026-03-16T00:01:30.000Z",
      total_tokens: 40,
      host_id: "host-a",
    },
    {
      factory_id: "alpha",
      instance_id: "alpha",
      kind_id: "brainstorm",
      status: "completed",
      runtime_version: "1.2.1",
      kind_version: "2026.03.11",
      policy_profile: "stable",
      incident_fingerprint: "inc-1",
      started_at: "2026-03-16T00:02:00.000Z",
      ended_at: "2026-03-16T00:04:00.000Z",
      total_tokens: 60,
      estimated_cost_usd: 0.02,
      host_id: "host-a",
    },
  ]);

  return { root, mirrorRoot };
}

function runCli(args, { cwd = repoRoot, expectStatus = 0 } = {}) {
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("fleet report --view throughput --json returns schema payload", () => {
  const { root, mirrorRoot } = makeFixtureRoot();
  try {
    const run = runCli([
      "fleet",
      "report",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      join(root, "factories", "mothership", "factory.config.json"),
      "--factory-id",
      "mothership",
      "--registry-path",
      join(root, "factory-registry.json"),
      "--mirror-dir",
      mirrorRoot,
      "--view",
      "throughput",
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.schema, "fleet-report.v1");
    assert.equal(payload.view, "throughput");
    assert.equal(payload.payload.completed_total, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fleet report supports all required views in json mode", () => {
  const { root, mirrorRoot } = makeFixtureRoot();
  try {
    const views = [
      "throughput",
      "failure-rates",
      "backlog-age",
      "model-cost",
      "version-drift",
      "host-pressure",
      "time-to-resolution",
    ];

    for (const view of views) {
      const run = runCli([
        "fleet",
        "report",
        "--factory-root",
        join(root, "factories", "mothership"),
        "--factory-config-path",
        join(root, "factories", "mothership", "factory.config.json"),
        "--factory-id",
        "mothership",
        "--registry-path",
        join(root, "factory-registry.json"),
        "--mirror-dir",
        mirrorRoot,
        "--view",
        view,
        "--json",
      ], { cwd: root });

      const payload = JSON.parse(String(run.stdout || "{}"));
      assert.equal(payload.schema, "fleet-report.v1");
      assert.equal(payload.view, view);
      assert.equal(typeof payload.payload, "object");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fleet report applies --instance and --from/--to window filters", () => {
  const { root, mirrorRoot } = makeFixtureRoot();
  try {
    const run = runCli([
      "fleet",
      "report",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      join(root, "factories", "mothership", "factory.config.json"),
      "--factory-id",
      "mothership",
      "--registry-path",
      join(root, "factory-registry.json"),
      "--mirror-dir",
      mirrorRoot,
      "--view",
      "throughput",
      "--instance",
      "alpha",
      "--from",
      "2026-03-16T00:03:50.000Z",
      "--to",
      "2026-03-16T00:04:10.000Z",
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.payload.completed_total, 1);
    assert.equal(payload.instance_id, "alpha");
    assert.equal(payload.window.from, "2026-03-16T00:03:50.000Z");
    assert.equal(payload.window.to, "2026-03-16T00:04:10.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fleet report validates view and exits non-zero on invalid input", () => {
  const { root, mirrorRoot } = makeFixtureRoot();
  try {
    const run = runCli([
      "fleet",
      "report",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      join(root, "factories", "mothership", "factory.config.json"),
      "--factory-id",
      "mothership",
      "--registry-path",
      join(root, "factory-registry.json"),
      "--mirror-dir",
      mirrorRoot,
      "--view",
      "not-a-view",
      "--json",
    ], { cwd: root, expectStatus: 2 });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.ok, false);
    assert.equal(payload.error_code, "invalid_view");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
