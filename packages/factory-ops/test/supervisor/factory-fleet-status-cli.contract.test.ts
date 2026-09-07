import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function writeRegistry() {
  const root = mkdtempSync(join(tmpdir(), "fleet-cli-"));
  const path = join(root, "factory-registry.json");
  writeFileSync(path, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    factories: [{
      id: "sample-factory",
      repo: "",
      graphs: [{ id: "tick", path: "factories/sample/graphs/factory_supervisor_tick.dot" }],
      daemonStatus: { status: "stopped" },
    }],
  }, null, 2));
  return path;
}

test("factory fleet-status CLI command wiring includes required flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(source, /class FactoryFleetStatusCommand/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*static paths = \[\["factory", "fleet-status"\]\]/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--registry-path", "factory-registry\.json"\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--lookback-hours", "24"\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.Boolean\("--json", false\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--factory-root", ""\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*resolveFactoryContextOrExit\(this, \{/);
});

test("factory fleet-tui CLI command wiring includes required flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(source, /import\s+\{\s*factoryFleetBootstrapSnapshot\s*\}\s+from\s+"..\/..\/commands\/factory-fleet-status\.mjs";/);
  assert.match(source, /class FactoryFleetTuiCommand/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*static paths = \[\["factory", "fleet-tui"\]\]/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*Option\.String\("--registry-path", "factory-registry\.json"\)/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*Option\.String\("--lookback-hours", "24"\)/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*Option\.String\("--refresh-ms", "10000"\)/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*runFactoryFleetTui\(/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*factoryFleetBootstrapSnapshot\(/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*loadFactoryDetail: async/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*buildFactoryDashboard/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*runFactorySessionBrowserTui\(/);
  assert.match(source, /FactoryFleetTuiCommand[\s\S]*stdin: this\.context\.stdin \|\| process\.stdin/);
});

test("factory fleet-status --json returns fleet contract payload", () => {
  const registryPath = writeRegistry();
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "fleet-status",
    "--registry-path",
    registryPath,
    "--lookback-hours",
    "1",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "{}");
  assert.equal(typeof payload.generated_at, "string");
  assert.equal(payload.registry_path, registryPath);
  assert.ok(payload.kpis && typeof payload.kpis === "object");
  assert.equal(typeof payload.kpis.window_hours, "number");
  assert.ok(payload.fleet_totals && typeof payload.fleet_totals === "object");
  assert.ok(Array.isArray(payload.warnings));
  assert.ok(Array.isArray(payload.factories));
  assert.equal(payload.factories[0].factory_id, "sample-factory");
  assert.ok(Object.hasOwn(payload.factories[0], "health"));
  assert.ok(Object.hasOwn(payload.factories[0], "runtime_version"));
  assert.ok(Object.hasOwn(payload.factories[0], "kind_version"));
  assert.ok(Object.hasOwn(payload.factories[0], "rollout_channel"));
  assert.ok(Object.hasOwn(payload.factories[0], "rollout_status"));
  assert.ok(Object.hasOwn(payload.factories[0], "upgrade_verification_outcome"));
  assert.ok(Object.hasOwn(payload.factories[0], "gate_reason"));
  assert.ok(Object.hasOwn(payload.factories[0], "drift_state"));
  assert.ok(Object.hasOwn(payload.factories[0], "daemon_health"));
});

test("factory fleet-status human output renders per-factory lines and totals", () => {
  const registryPath = writeRegistry();
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "fleet-status",
    "--registry-path",
    registryPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Fleet status generated_at=/);
  assert.match(run.stdout, /Fleet KPIs window=/);
  assert.match(run.stdout, /Fleet totals total=/);
  assert.match(run.stdout, /drift_ready=/);
  assert.match(run.stdout, /sample-factory repo=.* drift=/);
});

test("factory attention CLI command wiring includes required flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(source, /class FactoryAttentionCommand/);
  assert.match(source, /FactoryAttentionCommand[\s\S]*static paths = \[\["factory", "attention"\]\]/);
  assert.match(source, /FactoryAttentionCommand[\s\S]*Option\.String\("--registry-path", "factory-registry\.json"\)/);
  assert.match(source, /FactoryAttentionCommand[\s\S]*Option\.String\("--lookback-hours", "1"\)/);
  assert.match(source, /FactoryAttentionCommand[\s\S]*Option\.Boolean\("--json", false\)/);
});

test("fleet-status from default registry reports managed factories from checked-in registry even when runtime overlay is partial", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "fleet-status",
    "--json",
    "--lookback-hours",
    "1",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_RUNS_DIR: "",
      RUNS_DIR: "",
      HATCH_FACTORY_ROOT: "",
      FACTORY_ROOT: "",
      HATCH_FACTORY_CONFIG_PATH: "",
      FACTORY_CONFIG_PATH: "",
      HATCH_FACTORY_ID: "",
      FACTORY_ID: "",
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "{}");
  const factoryIds = (payload.factories || []).map((row) => String(row.factory_id || "")).sort();
  assert.ok(factoryIds.includes("example-scanner"), "fleet rows must include example-scanner");
  assert.ok(factoryIds.includes("mothership"), "fleet rows must include mothership");
  assert.ok(factoryIds.includes("example-trading"), "fleet rows must include example-trading");

  const replayLab = (payload.factories || []).find((row) => row.factory_id === "example-trading");
  assert.ok(replayLab, "example-trading row must be present");
  assert.equal(replayLab.target_repo, "example-org/example-trading");
  assert.equal(replayLab.control_plane_repo, "recallnet/astrochicken");
  assert.ok(Object.hasOwn(replayLab, "managed_state"));
  assert.ok(Object.hasOwn(replayLab, "runtime_version"));
  assert.ok(Object.hasOwn(replayLab, "kind_version"));
  assert.ok(Object.hasOwn(replayLab, "drift_state"));
  assert.ok(Object.hasOwn(replayLab, "daemon_health"));
  assert.match(String(replayLab.runs_dir || ""), /(?:\.hatch|\.hatch-hosts)[\\/]example-trading[\\/]runs$/);
});
