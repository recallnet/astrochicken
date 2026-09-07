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
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeFactoryConfig(rootDir, factoryId = "mothership") {
  const factoryRoot = join(rootDir, "factories", factoryId);
  mkdirSync(factoryRoot, { recursive: true });
  const configPath = join(factoryRoot, "factory.config.json");
  writeJson(configPath, {
    schema: "hatch.factory.config.v1",
    factory_id: factoryId,
    kind_id: factoryId,
    instance_id: factoryId,
    factory_root: `factories/${factoryId}`,
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: `.hatch/${factoryId}/runs`,
    scenarios: {
      root: `factories/${factoryId}/scenarios`,
    },
  });
  return { configPath, factoryRoot };
}

function makeRun(runsDir, runId, state = {}) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const nowIso = new Date().toISOString();
  writeJson(join(runDir, "state.json"), {
    runId,
    status: "failed",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    startedAt: nowIso,
    updatedAt: nowIso,
    createdAt: nowIso,
    context: {},
    ...state,
  });
}

function runCli(args, { cwd = repoRoot, expectStatus = 0 } = {}) {
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("factory fleet-triage-queues --json returns expected schema fields", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-triage-cli-contract-"));
  const runsDir = join(root, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    const { configPath } = writeFactoryConfig(root, "mothership");

    makeRun(runsDir, "run-alpha", {
      context: {
        incident: {
          queue_type: "platform_incident",
          incident_fingerprint: "fp-cli-shared",
          support_owner: "ops-platform",
          service_tier: "premium",
          affected_instance_id: "alpha",
          blocked_since: "2026-03-16T23:40:00.000Z",
        },
      },
    });

    makeRun(runsDir, "run-beta", {
      context: {
        triage: {
          incident: {
            queue_type: "platform_incident",
            incident_fingerprint: "fp-cli-shared",
            support_owner: "ops-platform",
            service_tier: "premium",
            affected_instance_id: "beta",
            blocked_since: "2026-03-16T23:45:00.000Z",
          },
        },
      },
    });

    const run = runCli([
      "factory",
      "fleet-triage-queues",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "mothership",
      "--runs-dir",
      runsDir,
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, true);
    assert.equal(Array.isArray(payload.queue), true);
    assert.equal(payload.queue.length, 1);
    assert.equal(typeof payload.schema_version, "string");
    assert.equal(typeof payload.generated_at, "string");
    assert.equal(typeof payload.totals, "object");

    const item = payload.queue[0];
    assert.equal(item.queue_type, "platform_incident");
    assert.equal(item.fingerprint, "fp-cli-shared");
    assert.equal(item.support_owner, "ops-platform");
    assert.equal(item.service_tier, "premium");
    assert.deepEqual(item.affected_instances, ["alpha", "beta"]);
    assert.equal(typeof item.blocked_since, "string");
    assert.equal(typeof item.backlog_age, "number");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
