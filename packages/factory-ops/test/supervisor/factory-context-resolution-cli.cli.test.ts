import { normalizeTmpAlias, writeJson, pathRelativeFactoryRoot, seedCanonicalTickFixtures, buildReleaseManifestFixture } from "./factory-context-resolution.fixture.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";


import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

const resolverEnvKeys = [
  "HATCH_RUNS_DIR",
  "RUNS_DIR",
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
  "HATCH_SCENARIOS_ROOT",
  "SCENARIOS_ROOT",
  "FACTORY_CONTEXT_REPO_PATH",
  // Host-level env vars that leak the live factory's release manifest path; must
  // be cleared so that isolated test roots do not inherit real release state.
  "HATCH_CANONICAL_CHECKOUT_PATH",
  "HATCH_HOST_BASE_DIR",
  "HATCH_INSTANCE_ID",
  "HATCH_FACTORY_INSTANCE_ID",
  "FACTORY_HOST_ROOT",
];

const hookEnvKeys = [
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
  "INIT_CWD",
];



function buildConfig({ rootDir, configPath, overrides = {} }) {
  writeJson(configPath, {
    schema: "hatch.factory.config.v1",
    factory_id: "mothership",
    factory_root: pathRelativeFactoryRoot(configPath, rootDir),
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: 1414,
    model: "openai/gpt-5.3-codex",
    provider: "openrouter",
    dispatch: { graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
    skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
    scenarios: { root: "factories/mothership/scenarios" },
    pipeline: { supervisor_tick: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
    runs_dir: ".hatch/mothership/runs",
    trust: {
      domain: "mothership.local",
      roles: ["mothership.local.tool", "mothership.local.codergen"],
    },
    ...overrides,
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
    },
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
    },
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
    },
  });
}





function runCliFromCwd(cwd, args, envOverrides = {}) {
  const env = {};
  for (const key of [
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "TMP",
    "TMPDIR",
    "TEMP",
    "USER",
  ]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  for (const key of Object.keys(process.env)) {
    if (resolverEnvKeys.includes(key)) {
      continue;
    }
    if (hookEnvKeys.includes(key)) {
      continue;
    }
    if (
      key === "NODE_OPTIONS" ||
      key === "NODE_PATH" ||
      key === "NODE_UNIQUE_ID" ||
      key.startsWith("NODE_TEST_") ||
      key.startsWith("npm_") ||
      key.startsWith("PNPM_")
    ) {
      // @context:regression !critical This portability contract launches the
      // real factory CLI from synthetic control-plane and external roots. It
      // must model an operator shell, not inherit node-test/pnpm/git-hook
      // bookkeeping from the parent runner, because those ephemeral vars can
      // point at temp roots and break workspace package resolution before
      // context normalization is even exercised.
      continue;
    }
  }
  Object.assign(env, envOverrides);

  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  return {
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

function normalizeContext(payload, expectedFactoryRoot, expectedRunsDir, expectedScenariosRoot, expectedTargetRepo, expectedControlPlaneRepo) {
  const context = payload?.context || {};
  assert.equal(context.factory_id, "mothership");
  assert.equal(normalizeTmpAlias(context.factory_root), normalizeTmpAlias(expectedFactoryRoot));
  assert.equal(normalizeTmpAlias(context.runs_dir), normalizeTmpAlias(expectedRunsDir));
  assert.equal(normalizeTmpAlias(context.scenarios_root), normalizeTmpAlias(expectedScenariosRoot));
  assert.equal(context.target_repo, expectedTargetRepo);
  assert.equal(context.control_plane_repo, expectedControlPlaneRepo);

  return {
    factory_id: context.factory_id,
    factory_root: "<factory-root>",
    runs_dir: "<runs-dir>",
    scenarios_root: "<scenarios-root>",
    target_repo: context.target_repo,
    control_plane_repo: context.control_plane_repo,
  };
}

function assertHumanReadableOutput(text, expected) {
  const normalized = normalizeTmpAlias(text);
  assert.match(normalized, /Factory: /);
  assert.match(normalized, /Factory ID: mothership/);
  assert.match(normalized, new RegExp(`Target Repo: ${expected.targetRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(normalized, new RegExp(`Control Plane: ${expected.controlPlaneRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(normalized, /Runs Dir: /);
  assert.equal(normalized.includes("/.hatch/runs\n"), false);
  assert.equal(normalized.includes("/.hatch/runs\r\n"), false);
}

function pruneDynamicFieldsStatus(payload) {
  return {
    context: payload.context,
    active_len: Array.isArray(payload.active) ? payload.active.length : 0,
    runs_len: Array.isArray(payload.runs) ? payload.runs.length : 0,
    completed: Number(payload.completed || 0),
    failed: Number(payload.failed || 0),
    blocked_control_plane_len: Array.isArray(payload.blocked_control_plane) ? payload.blocked_control_plane.length : 0,
    managed_health: String(payload?.managed_state?.health_classification || ""),
    control_plane_reason: String(payload?.control_plane?.resume_reason || ""),
  };
}

function pruneDynamicFieldsSummary(payload) {
  return {
    context: payload.context,
    active_run_count: Number(payload.active_run_count || 0),
    active_wave_count: Number(payload.active_wave_count || 0),
    waves_len: Array.isArray(payload.waves) ? payload.waves.length : 0,
    non_wave_len: Array.isArray(payload.non_wave_active) ? payload.non_wave_active.length : 0,
    blocked_control_plane_len: Array.isArray(payload.blocked_control_plane) ? payload.blocked_control_plane.length : 0,
  };
}

function pruneDynamicFieldsTick(payload) {
  return {
    context: payload.context,
    ticks_len: Array.isArray(payload.ticks) ? payload.ticks.length : 0,
    top_stage: Array.isArray(payload.ticks) && payload.ticks[0] ? String(payload.ticks[0].stage || "") : "",
    top_stage_label: Array.isArray(payload.ticks) && payload.ticks[0] ? String(payload.ticks[0].stageLabel || "") : "",
  };
}

test("spawned status commands preserve normalized context parity across control-plane and external roots", async () => {
  const canonicalEventStore = createCanonicalEventStoreFixture();
  await canonicalEventStore.setup();
  await seedCanonicalTickFixtures(canonicalEventStore.connectionString);
  const statusEnv = {
    HATCH_CANONICAL_EVENT_STORE_URL: canonicalEventStore.connectionString,
  };

  try {
  const controlRoot = mkdtempSync(join(tmpdir(), "factory-context-cli-control-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "factory-context-cli-external-"));

  buildConfig({
    rootDir: controlRoot,
    configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
  });
  buildConfig({
    rootDir: externalRoot,
    configPath: join(externalRoot, "factory.config.json"),
  });

  const controlRunsDir = join(controlRoot, ".hatch", "mothership", "runs");
  const externalRunsDir = join(externalRoot, ".hatch", "mothership", "runs");
  buildRunFixtures(controlRunsDir);
  buildRunFixtures(externalRunsDir);
  buildReleaseManifestFixture(controlRoot);
  buildReleaseManifestFixture(externalRoot);

  const controlNestedCwd = join(controlRoot, "factories", "mothership", "graphs", "nested", "deep");
  const externalNestedCwd = join(externalRoot, "graphs", "nested", "deep");
  mkdirSync(controlNestedCwd, { recursive: true });
  mkdirSync(externalNestedCwd, { recursive: true });

  const expectedControl = {
    factoryRoot: join(controlRoot, "factories", "mothership"),
    runsDir: controlRunsDir,
    scenariosRoot: join(controlRoot, "factories", "mothership", "scenarios"),
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  };
  const expectedExternal = {
    factoryRoot: externalRoot,
    runsDir: externalRunsDir,
    scenariosRoot: join(externalRoot, "factories", "mothership", "scenarios"),
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  };

  const commandMatrix = [
    {
      name: "status",
      args: ["factory", "status"],
      prune: pruneDynamicFieldsStatus,
      humanNeedle: /Active runs:|No active runs\./,
    },
    {
      name: "active-summary",
      args: ["factory", "active-summary"],
      prune: pruneDynamicFieldsSummary,
      humanNeedle: /Active runs:|No active runs\./,
    },
    {
      name: "tick-status",
      args: ["factory", "tick-status"],
      prune: pruneDynamicFieldsTick,
      humanNeedle: /CURRENT TICK|LAST TICK/,
    },
  ];

  for (const command of commandMatrix) {
    const controlText = runCliFromCwd(controlRoot, command.args, statusEnv);
    const externalText = runCliFromCwd(externalRoot, command.args, statusEnv);
    const controlNestedText = runCliFromCwd(controlNestedCwd, command.args, statusEnv);
    const externalNestedText = runCliFromCwd(externalNestedCwd, command.args, statusEnv);

    assertHumanReadableOutput(controlText.stdout, expectedControl);
    assertHumanReadableOutput(externalText.stdout, expectedExternal);
    assertHumanReadableOutput(controlNestedText.stdout, expectedControl);
    assertHumanReadableOutput(externalNestedText.stdout, expectedExternal);

    assert.match(controlText.stdout, command.humanNeedle);
    assert.match(externalText.stdout, command.humanNeedle);
    assert.match(controlNestedText.stdout, command.humanNeedle);
    assert.match(externalNestedText.stdout, command.humanNeedle);

    const controlJsonRaw = runCliFromCwd(controlRoot, [...command.args, "--json"], statusEnv);
    const externalJsonRaw = runCliFromCwd(externalRoot, [...command.args, "--json"], statusEnv);
    const controlNestedJsonRaw = runCliFromCwd(controlNestedCwd, [...command.args, "--json"], statusEnv);
    const externalNestedJsonRaw = runCliFromCwd(externalNestedCwd, [...command.args, "--json"], statusEnv);

    const controlJson = JSON.parse(controlJsonRaw.stdout || "{}");
    const externalJson = JSON.parse(externalJsonRaw.stdout || "{}");
    const controlNestedJson = JSON.parse(controlNestedJsonRaw.stdout || "{}");
    const externalNestedJson = JSON.parse(externalNestedJsonRaw.stdout || "{}");

    const controlNormalizedContext = normalizeContext(
      controlJson,
      expectedControl.factoryRoot,
      expectedControl.runsDir,
      expectedControl.scenariosRoot,
      expectedControl.targetRepo,
      expectedControl.controlPlaneRepo,
    );
    const externalNormalizedContext = normalizeContext(
      externalJson,
      expectedExternal.factoryRoot,
      expectedExternal.runsDir,
      expectedExternal.scenariosRoot,
      expectedExternal.targetRepo,
      expectedExternal.controlPlaneRepo,
    );
    const controlNestedNormalizedContext = normalizeContext(
      controlNestedJson,
      expectedControl.factoryRoot,
      expectedControl.runsDir,
      expectedControl.scenariosRoot,
      expectedControl.targetRepo,
      expectedControl.controlPlaneRepo,
    );
    const externalNestedNormalizedContext = normalizeContext(
      externalNestedJson,
      expectedExternal.factoryRoot,
      expectedExternal.runsDir,
      expectedExternal.scenariosRoot,
      expectedExternal.targetRepo,
      expectedExternal.controlPlaneRepo,
    );

    controlJson.context = controlNormalizedContext;
    externalJson.context = externalNormalizedContext;
    controlNestedJson.context = controlNestedNormalizedContext;
    externalNestedJson.context = externalNestedNormalizedContext;

    const controlPruned = command.prune(controlJson);
    const externalPruned = command.prune(externalJson);
    const controlNestedPruned = command.prune(controlNestedJson);
    const externalNestedPruned = command.prune(externalNestedJson);

    assert.deepEqual(controlPruned, externalPruned, `${command.name}: root control/external parity`);
    assert.deepEqual(controlNestedPruned, controlPruned, `${command.name}: control root/nested parity`);
    assert.deepEqual(externalNestedPruned, externalPruned, `${command.name}: external root/nested parity`);
  }
  } finally {
    canonicalEventStore.teardown();
  }
});
