import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

const RESOLVER_ENV_KEYS = [
  "HATCH_FACTORY_ROOT",
  "FACTORY_ROOT",
  "HATCH_FACTORY_CONFIG_PATH",
  "FACTORY_CONFIG_PATH",
  "HATCH_FACTORY_ID",
  "FACTORY_ID",
  "HATCH_TARGET_REPO",
  "TARGET_REPO",
  "HATCH_GH_REPO",
  "GH_REPO",
  "MOTHERSHIP_REPO",
  "HATCH_CONTROL_PLANE_REPO",
  "CONTROL_PLANE_REPO",
  "HATCH_RUNS_DIR",
  "RUNS_DIR",
  "HATCH_SCENARIOS_ROOT",
  "SCENARIOS_ROOT",
];

function normalizeTmpAlias(value) {
  return String(value || "").replace(/^\/private\//, "/");
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readHeaderValue(text, key) {
  const prefix = `${key}: `;
  const line = String(text || "")
    .split("\n")
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length) : "";
}

function writeFactoryConfig({ rootDir, configPath, factoryRoot }) {
  writeJson(configPath, {
    schema: "hatch.factory.config.v1",
    factory_id: "mothership",
    factory_root: factoryRoot,
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: ".hatch/mothership/runs",
    scenarios: {
      root: "factories/mothership/scenarios",
    },
  });
}

function buildRunFixtures(runsDir) {
  mkdirSync(runsDir, { recursive: true });
  const now = new Date();
  const nowIso = now.toISOString();
  const previousIso = new Date(now.getTime() - 60_000).toISOString();

  writeJson(join(runsDir, "tick-1", "state.json"), {
    runId: "tick-1",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "running",
    pid: process.pid,
    currentNode: "wave_execute",
    startedAt: nowIso,
    updatedAt: nowIso,
    context: {
      goal_count: "3",
      __child_run_id_wave_execute: "wave-1",
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
    activeChildren: {},
    completedNodes: [],
    locksHeld: [],
    records: [],
  });

  writeJson(join(runsDir, "tick-0", "state.json"), {
    runId: "tick-0",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "completed",
    pid: process.pid,
    currentNode: "done",
    startedAt: previousIso,
    updatedAt: previousIso,
    context: {
      goal_count: "2",
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
    activeChildren: {},
    completedNodes: [],
    locksHeld: [],
    records: [],
  });

  writeJson(join(runsDir, "wave-1", "state.json"), {
    runId: "wave-1",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    status: "running",
    pid: process.pid,
    currentNode: "execute_issue",
    startedAt: nowIso,
    updatedAt: nowIso,
    context: {
      issue_number: "205",
      milestone_title: "goal-205-wave-1",
      ready_issue_number: "999",
      processed_issues: "[]",
      milestone_issues: JSON.stringify([{ number: 205, title: "Feature 205" }]),
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: runsDir,
    },
    activeChildren: {},
    completedNodes: [],
    locksHeld: [],
    records: [],
  });
}

function writeFallbackRun(runsDir) {
  const nowIso = new Date().toISOString();
  writeJson(join(runsDir, "fallback-run", "state.json"), {
    runId: "fallback-run",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    status: "running",
    pid: process.pid,
    currentNode: "execute_issue",
    startedAt: nowIso,
    updatedAt: nowIso,
    context: {
      issue_number: "9999",
      milestone_title: "fallback-wave",
      factory_id: "mothership",
      target_repo: "recallnet/astrochicken",
      runs_dir: ".hatch/runs",
    },
    activeChildren: {},
    completedNodes: [],
    locksHeld: [],
    records: [],
  });
}

function runOpsCli(cwd, args) {
  const env = { ...process.env };
  for (const key of RESOLVER_ENV_KEYS) delete env[key];

  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run;
}

const commands = [
  ["factory", "status"],
  ["factory", "tick-status"],
  ["factory", "active-summary"],
];

test("spawned hatch-ops status commands keep portable factory-scoped context across control/external roots", () => {
  const controlRoot = mkdtempSync(join(tmpdir(), "factory-cli-portability-control-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "factory-cli-portability-external-"));

  writeFactoryConfig({
    rootDir: controlRoot,
    configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
    factoryRoot: "factories/mothership",
  });
  writeFactoryConfig({
    rootDir: externalRoot,
    configPath: join(externalRoot, "factory.config.json"),
    factoryRoot: ".",
  });

  const controlRunsDir = join(controlRoot, ".hatch", "mothership", "runs");
  const externalRunsDir = join(externalRoot, ".hatch", "mothership", "runs");
  const controlFallbackRunsDir = join(controlRoot, ".hatch", "runs");
  const externalFallbackRunsDir = join(externalRoot, ".hatch", "runs");

  buildRunFixtures(controlRunsDir);
  buildRunFixtures(externalRunsDir);
  writeFallbackRun(controlFallbackRunsDir);
  writeFallbackRun(externalFallbackRunsDir);

  const controlNestedCwd = join(controlRoot, "factories", "mothership", "graphs", "nested", "deep");
  const externalNestedCwd = join(externalRoot, "graphs", "nested", "deep");
  mkdirSync(controlNestedCwd, { recursive: true });
  mkdirSync(externalNestedCwd, { recursive: true });

  const contexts = [
    {
      name: "control-root",
      cwd: controlRoot,
      expectedFactoryRoot: join(controlRoot, "factories", "mothership"),
      expectedRunsDir: controlRunsDir,
    },
    {
      name: "control-nested",
      cwd: controlNestedCwd,
      expectedFactoryRoot: join(controlRoot, "factories", "mothership"),
      expectedRunsDir: controlRunsDir,
    },
    {
      name: "external-root",
      cwd: externalRoot,
      expectedFactoryRoot: externalRoot,
      expectedRunsDir: externalRunsDir,
    },
    {
      name: "external-nested",
      cwd: externalNestedCwd,
      expectedFactoryRoot: externalRoot,
      expectedRunsDir: externalRunsDir,
    },
  ];

  for (const contextCase of contexts) {
    for (const command of commands) {
      const textRun = runOpsCli(contextCase.cwd, command);
      const textLabel = `${contextCase.name}:${command.join(" ")}:text`;
      assert.match(textRun.stdout, /Factory: /, textLabel);
      assert.match(textRun.stdout, /Factory ID: mothership/, textLabel);
      assert.match(textRun.stdout, /Target Repo: recallnet\/astrochicken/, textLabel);
      assert.match(textRun.stdout, /Runs Dir: /, textLabel);
      assert.doesNotMatch(textRun.stdout, /^\s*\{/m, textLabel);
      assert.equal(
        normalizeTmpAlias(readHeaderValue(textRun.stdout, "Factory")),
        normalizeTmpAlias(contextCase.expectedFactoryRoot),
        textLabel,
      );
      assert.equal(
        normalizeTmpAlias(readHeaderValue(textRun.stdout, "Runs Dir")),
        normalizeTmpAlias(contextCase.expectedRunsDir),
        textLabel,
      );
      assert.equal(
        normalizeTmpAlias(readHeaderValue(textRun.stdout, "Runs Dir")).endsWith("/.hatch/mothership/runs"),
        true,
        textLabel,
      );
      assert.equal(textRun.stdout.includes(".hatch/runs"), false, textLabel);
      assert.equal(textRun.stdout.includes("fallback-run"), false, textLabel);

      const jsonRun = runOpsCli(contextCase.cwd, [...command, "--json"]);
      const jsonLabel = `${contextCase.name}:${command.join(" ")}:json`;
      const payload = JSON.parse(jsonRun.stdout || "{}");
      assert.equal(payload?.context?.factory_id, "mothership", jsonLabel);
      assert.equal(payload?.context?.target_repo, "recallnet/astrochicken", jsonLabel);
      assert.equal(
        normalizeTmpAlias(payload?.context?.factory_root),
        normalizeTmpAlias(contextCase.expectedFactoryRoot),
        jsonLabel,
      );
      assert.equal(
        normalizeTmpAlias(payload?.context?.runs_dir),
        normalizeTmpAlias(contextCase.expectedRunsDir),
        jsonLabel,
      );
      assert.equal(
        String(payload?.context?.runs_dir || "").replace(/\\/g, "/").endsWith("/.hatch/mothership/runs"),
        true,
        jsonLabel,
      );
      assert.equal(jsonRun.stdout.includes("fallback-run"), false, jsonLabel);

      if (command[1] === "status") {
        assert.ok(Array.isArray(payload.active), jsonLabel);
      }
      if (command[1] === "tick-status") {
        assert.ok(Array.isArray(payload.ticks), jsonLabel);
      }
      if (command[1] === "active-summary") {
        assert.ok(Array.isArray(payload.waves), jsonLabel);
        assert.ok(Array.isArray(payload.non_wave_active), jsonLabel);
      }
    }
  }
});
