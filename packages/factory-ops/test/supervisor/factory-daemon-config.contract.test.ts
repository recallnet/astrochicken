import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const daemonPath = "scripts/factory-daemon.sh";
const supervisorPath = "factories/mothership/scripts/factory_supervisor_loop.sh";
const packageJsonPath = "package.json";
const factoryCliPath = null; // replaced by factoryCli concatenation below
const legacyRepoEnvKey = ["INTENTS", "REPO"].join("_");

test("factory daemon shell entrypoint is a thin wrapper over Node daemon", async () => {
  const script = readFileSync(daemonPath, "utf8");
  const lineCount = script.trimEnd().split(/\r?\n/).length;
  const execTargetMatch = script.match(/exec node "\$SCRIPT_DIR\/\.\.\/([^"]+)" "\$FACTORY_ID"/);
  const execTarget = execTargetMatch?.[1] || "";

  assert.ok(lineCount <= 50, `daemon wrapper must be <= 50 lines (got ${lineCount})`);

  assert.match(script, /^FACTORY_ID="\$\{1:\?Usage: factory-daemon\.sh <factory-id>\}"$/m);
  assert.match(script, /^if ! mkdir "\$LOCK_DIR" 2>\/dev\/null; then$/m);
  assert.match(script, /^trap cleanup EXIT INT TERM$/m);
  assert.match(script, /exec node "\$SCRIPT_DIR\/\.\.\/packages\/factory-ops\/src\/lib\/daemon\.(?:mjs|ts)" "\$FACTORY_ID"/);
  assert.ok(execTarget, "daemon wrapper must exec a Node daemon module");
  assert.ok(existsSync(execTarget), `daemon wrapper exec target must exist (got ${execTarget || "missing"})`);

  assert.match(script, /rm -f "\$PID_FILE"/);
  assert.match(script, /rmdir "\$LOCK_DIR" 2>\/dev\/null \|\| true/);

  assert.doesNotMatch(script, /npm install/);
  assert.doesNotMatch(script, /npm run build/);
  assert.doesNotMatch(script, /git pull/);
  assert.doesNotMatch(script, /hatch run/);
  assert.doesNotMatch(script, /resolve_factory_runtime/);
  assert.doesNotMatch(script, /read_config_value/);

  const daemonSource = readFileSync("packages/factory-ops/src/lib/daemon.ts", "utf8");
  assert.match(daemonSource, /export const ACTIVE_SLEEP_MS = \d[\d_]*;/);
  assert.match(daemonSource, /export const IDLE_SLEEP_BASE_MS = \d[\d_]*;/);
  assert.match(daemonSource, /export const IDLE_SLEEP_MAX_MS = \d[\d_]*;/);
  assert.match(daemonSource, /export async function runDaemon\(/);
  assert.match(daemonSource, /export function detectOrphanPids\(/);
  assert.match(daemonSource, /export function shouldRunInstall\(/);
  assert.match(daemonSource, /export function resolveTickSleep\(/);
});

test("runtime repo defaults use mothership repo only across entrypoints", () => {
  const supervisorScript = readFileSync(supervisorPath, "utf8");
  const packageJson = readFileSync(packageJsonPath, "utf8");
  const factoryCli = [
    "packages/factory-ops/src/cli/factory-command-helpers.ts",
    "packages/factory-ops/src/cli/commands/factory-status-cmds.ts",
  ].map((f) => readFileSync(f, "utf8")).join("\n");

  assert.match(supervisorScript, /^MOTHERSHIP_REPO="\$\{MOTHERSHIP_REPO:-recallnet\/astrochicken\}"$/m);
  assert.match(supervisorScript, /if \[\[ -z "\$\{MOTHERSHIP_REPO:-\}" \]\]; then/);
  assert.doesNotMatch(supervisorScript, /ASTROCHICKEN_REPO/);
  assert.doesNotMatch(supervisorScript, new RegExp(legacyRepoEnvKey));

  assert.match(
    packageJson,
    /"supervisor:status"\s*:\s*"node packages\/factory-ops\/src\/cli\.ts supervisor status --repo \$\{MOTHERSHIP_REPO:-recallnet\/astrochicken\}"/,
  );
  assert.doesNotMatch(packageJson, /ASTROCHICKEN_REPO/);
  assert.doesNotMatch(packageJson, new RegExp(legacyRepoEnvKey));

  assert.match(factoryCli, /resolveRepoOrExit\(command, rawRepo = ""\)/);
  assert.match(factoryCli, /resolveGhRepo\(rawRepo\)/);
  assert.match(factoryCli, /repo = Option\.String\("--repo", ""\)/);
  assert.doesNotMatch(factoryCli, /ASTROCHICKEN_REPO/);
  assert.doesNotMatch(factoryCli, new RegExp(legacyRepoEnvKey));
});

test("example-trading factory.config.json contains all required daemon runtime fields", () => {
  const raw = readFileSync("factories/example-trading/factory.config.json", "utf8");
  const config = JSON.parse(raw);

  assert.equal(config.factory_id, "example-trading", "factory_id must be example-trading");
  assert.equal(typeof config.target_repo, "string", "target_repo must be a string");
  assert.ok(config.target_repo.length > 0, "target_repo must be non-empty");
  assert.equal(config.target_repo, "example-org/example-trading", "target_repo must be example-org/example-trading for cross-repo factory");
  assert.equal(typeof config.pipeline?.supervisor_tick, "string", "pipeline.supervisor_tick must be a string");
  assert.ok(config.pipeline.supervisor_tick.length > 0, "pipeline.supervisor_tick must be non-empty");
  assert.equal(typeof config.runs_dir, "string", "runs_dir must be a string");
  assert.ok(config.runs_dir.length > 0, "runs_dir must be non-empty");
  assert.equal(typeof config.work_dir, "string", "work_dir must be a string");
  assert.ok(config.work_dir.length > 0, "work_dir must be non-empty");
});

test("mothership factory.config.json splits dispatch reactor from maintenance supervisor tick", () => {
  const raw = readFileSync("factories/mothership/factory.config.json", "utf8");
  const config = JSON.parse(raw);

  assert.equal(config.factory_id, "mothership");
  assert.equal(config.dispatch.graph, "factories/mothership/workflows/dispatch-control/factory_dispatch_reactor.workflow-source.mjs");
  assert.equal(config.dispatch.latency_slo_seconds, 15);
  assert.equal(
    config.pipeline.supervisor_tick,
    "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
  );
  assert.equal(config.pipeline.maintenance_interval_seconds, 300);
  assert.notEqual(config.dispatch.graph, config.pipeline.supervisor_tick);
  assert.ok(config.pipeline.maintenance_interval_seconds > config.dispatch.latency_slo_seconds);
});
