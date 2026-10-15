import { normalizeTmpAlias, writeJson, pathRelativeFactoryRoot, seedCanonicalTickFixtures, buildReleaseManifestFixture } from "./factory-context-resolution.fixture.ts";
import { resolveControlPlaneHatchRoot } from "../../src/lib/control-plane-status.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { PassThrough } from "node:stream";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import { buildCli } from "../../src/cli/index.ts";
import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";
import { syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const canonicalEventStore = createCanonicalEventStoreFixture();

before(async () => {
  await canonicalEventStore.setup();
});

after(() => {
  canonicalEventStore.teardown();
});


function readHeaderValue(text, key) {
  const prefix = `${key}: `;
  const line = String(text || "")
    .split("\n")
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length) : "";
}


function buildRunFixtures(rootDir, runsDir) {
  mkdirSync(runsDir, { recursive: true });
  const now = new Date();
  const nowIso = now.toISOString();
  const previousIso = new Date(now.getTime() - 60_000).toISOString();

  writeJson(join(runsDir, "tick-1", "state.json"), {
    runId: "tick-1",
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
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
    pipelineFile: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
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
    pipelineFile: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
    pipeline: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
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

  writeJson(join(rootDir, ".hatch", "marker.json"), { ok: true });

  // Write a valid stable release manifest so the control-plane status resolves
  // to ready_to_resume instead of control_plane_manifest_unavailable.
  const sourceManifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v9.9.9",
    entries: [
      {
        source_repo: "example/external-factory",
        source_issue: 42,
        source_issue_url: "https://example/42",
        summary: "control-plane",
        factory_id: "external/issue_worker",
        required_factory_release: "9.9.9",
        status: "blocked_upstream",
        signature_hash: "sha256:42",
        linkage: {
          schema_version: "factory_link.v1",
          linkage_key: "sha256:42",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 9001,
          source_repo: "example/external-factory",
          source_issue: 42,
          status: "blocked_upstream",
          factory_id: "external/issue_worker",
          required_factory_release: "9.9.9",
          signature_hash: "sha256:42",
        },
      },
    ],
  });
  sourceManifest.rollout.controller = {
    ...sourceManifest.rollout.controller,
    status: "promoted",
  };
  const sourceManifestPath = join(rootDir, ".hatch", "releases", "v9.9.9", "release-manifest.json");
  mkdirSync(dirname(sourceManifestPath), { recursive: true });
  writeFileSync(sourceManifestPath, JSON.stringify(sourceManifest, null, 2));
  syncControlPlaneManifest({ manifestPath: sourceManifestPath, repoRoot: rootDir });
}




async function clearCanonicalEvents(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("truncate table factory_events");
  } finally {
    await pool.end();
  }
}

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
    scenarios: { root: "factories/mothership/scenarios" },
    runs_dir: ".hatch/mothership/runs",
    ...overrides,
  });
}



async function runCliFromCwd(cwd, args, envOverrides = {}) {
  const cli = buildCli();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";
  stdout.on("data", (chunk) => { stdoutText += chunk.toString(); });
  stderr.on("data", (chunk) => { stderrText += chunk.toString(); });

  const originalCwd = process.cwd();
  const resolverEnvKeys = [
    "HATCH_RUNS_DIR",
    "RUNS_DIR",
    "HATCH_FACTORY_ROOT",
    "FACTORY_ROOT",
    "HATCH_FACTORY_CONFIG_PATH",
    "FACTORY_CONFIG_PATH",
    "HATCH_FACTORY_ID",
    "FACTORY_ID",
    "HATCH_INSTANCE_ID",
    "INSTANCE_ID",
    "HATCH_FACTORY_INSTANCE_ID",
    "HATCH_KIND_ID",
    "KIND_ID",
    "HATCH_FACTORY_MODE",
    "FACTORY_MODE",
    "HATCH_TARGET_REPO",
    "TARGET_REPO",
    "HATCH_GH_REPO",
    "GH_REPO",
    "MOTHERSHIP_REPO",
    "HATCH_CONTROL_PLANE_REPO",
    "CONTROL_PLANE_REPO",
    "HATCH_DESTINATIONS_JSON",
    "DESTINATIONS_JSON",
    "HATCH_SCENARIOS_ROOT",
    "SCENARIOS_ROOT",
    "HATCH_FACTORY_MUTATION_CONTEXT_JSON",
    "HATCH_FACTORY_REPO_ROLES_JSON",
    "FACTORY_CONTEXT_REPO_PATH",
    "HATCH_CANONICAL_CHECKOUT_PATH",
    "HATCH_HOST_BASE_DIR",
    "FACTORY_HOST_ROOT",
  ];
  const previousEnv = Object.fromEntries(resolverEnvKeys.map((key) => [key, process.env[key]]));
  const overrideKeys = ["HATCH_CANONICAL_EVENT_STORE_URL", ...Object.keys(envOverrides)];
  const previousOverrideEnv = Object.fromEntries(overrideKeys.map((key) => [key, process.env[key]]));

  process.chdir(cwd);
  for (const key of resolverEnvKeys) delete process.env[key];
  Object.assign(process.env, {
    HATCH_CANONICAL_EVENT_STORE_URL: canonicalEventStore.connectionString,
    ...envOverrides,
  });

  try {
    const exitCode = await cli.run(args, { stdin: process.stdin, stdout, stderr });
    return { exitCode, stdout: stdoutText, stderr: stderrText };
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of Object.entries(previousOverrideEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function stripHeaderBlock(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !line.startsWith("Factory:")
      && !line.startsWith("Factory ID:")
      && !line.startsWith("Factory Mode:")
      && !line.startsWith("Target Repo:")
      && !line.startsWith("Kind ID:")
      && !line.startsWith("Instance ID:")
      && !line.startsWith("Control Plane:")
      && !line.startsWith("Runs Dir:"))
    .join("\n")
    .trim();
}

function normalizeDynamicText(text) {
  return stripHeaderBlock(text)
    .replace(/^  Required release floor: .*\n?/gm, "")
    .replace(/^  Manifest: (local_fs \.hatch\/releases\/stable\/release-manifest\.json @ ).*$/gm, "  Manifest: $1<manifest-ref>")
    .replace(/^Managed state: action=.* health=/gm, "Managed state: action=<action> health=")
    .replace(/(factory session-tail --run-id [^ ]+ --runs-dir ').*?(' --follow)/g, "$1<runs-dir>$2")
    .replace(/\b\d+(?:ms|s|m\d+s|h\d+m) ago\b/g, "<age>")
    .replace(/\b\d+(?:ms|s|m\d+s|h\d+m)\b/g, "<dur>")
    .replace(/Elapsed: .*\(started .*\)/g, "Elapsed: <elapsed>");
}

test("factory status/active-summary/tick-status resolve context in control-plane and external roots", async () => {
  await seedCanonicalTickFixtures(canonicalEventStore.connectionString);
  const controlRoot = mkdtempSync(join(tmpdir(), "factory-context-control-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "factory-context-external-"));

  buildConfig({
    rootDir: controlRoot,
    configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
  });
  buildConfig({
    rootDir: externalRoot,
    configPath: join(externalRoot, "factory.config.json"),
  });

  buildRunFixtures(controlRoot, join(controlRoot, ".hatch", "mothership", "runs"));
  buildRunFixtures(externalRoot, join(externalRoot, ".hatch", "mothership", "runs"));

  const expectedControlFactoryRoot = join(controlRoot, "factories", "mothership");
  const expectedExternalFactoryRoot = externalRoot;
  const expectedControlRunsDir = join(controlRoot, ".hatch", "mothership", "runs");
  const expectedExternalRunsDir = join(externalRoot, ".hatch", "mothership", "runs");
  const expectedControlScenariosRoot = join(controlRoot, "factories", "mothership", "scenarios");
  const expectedExternalScenariosRoot = join(externalRoot, "factories", "mothership", "scenarios");

  const controlNestedCwd = join(controlRoot, "factories", "mothership", "graphs", "nested", "deep");
  const externalNestedCwd = join(externalRoot, "graphs", "nested", "deep");
  mkdirSync(controlNestedCwd, { recursive: true });
  mkdirSync(externalNestedCwd, { recursive: true });

  const statusControl = await runCliFromCwd(controlRoot, ["factory", "status"]);
  const statusExternal = await runCliFromCwd(externalRoot, ["factory", "status"]);
  assert.equal(statusControl.exitCode, 0, statusControl.stderr);
  assert.equal(statusExternal.exitCode, 0, statusExternal.stderr);
  assert.match(statusControl.stdout, /Factory ID: mothership/);
  assert.match(statusExternal.stdout, /Factory ID: mothership/);
  assert.doesNotMatch(statusControl.stdout, /^\s*\{/);
  assert.doesNotMatch(statusExternal.stdout, /^\s*\{/);
  assert.equal(
    normalizeTmpAlias(readHeaderValue(statusControl.stdout, "Factory")),
    normalizeTmpAlias(expectedControlFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(statusExternal.stdout, "Factory")),
    normalizeTmpAlias(expectedExternalFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(statusControl.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedControlRunsDir),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(statusExternal.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedExternalRunsDir),
  );
  assert.match(statusControl.stdout, /Target Repo: recallnet\/astrochicken/);
  assert.match(statusExternal.stdout, /Target Repo: recallnet\/astrochicken/);
  assert.match(statusControl.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.match(statusExternal.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.equal(normalizeDynamicText(statusControl.stdout), normalizeDynamicText(statusExternal.stdout));

  const statusControlJson = await runCliFromCwd(controlRoot, ["factory", "status", "--json"]);
  const statusExternalJson = await runCliFromCwd(externalRoot, ["factory", "status", "--json"]);
  const parsedStatusControl = JSON.parse(statusControlJson.stdout);
  const parsedStatusExternal = JSON.parse(statusExternalJson.stdout);
  assert.ok(Array.isArray(parsedStatusControl.active));
  assert.ok(Array.isArray(parsedStatusControl.runs));
  assert.equal(parsedStatusControl.sections, undefined);
  assert.ok(Array.isArray(parsedStatusExternal.active));
  assert.ok(Array.isArray(parsedStatusExternal.runs));
  assert.equal(parsedStatusExternal.sections, undefined);
  assert.equal(parsedStatusControl.context.factory_id, "mothership");
  assert.equal(parsedStatusExternal.context.factory_id, "mothership");
  assert.equal(normalizeTmpAlias(parsedStatusControl.context.factory_root), normalizeTmpAlias(expectedControlFactoryRoot));
  assert.equal(normalizeTmpAlias(parsedStatusExternal.context.factory_root), normalizeTmpAlias(expectedExternalFactoryRoot));
  assert.equal(parsedStatusControl.context.target_repo, "recallnet/astrochicken");
  assert.equal(parsedStatusExternal.context.target_repo, "recallnet/astrochicken");
  assert.equal(parsedStatusControl.context.target_repo, "recallnet/astrochicken");
  assert.equal(parsedStatusExternal.context.target_repo, "recallnet/astrochicken");
  assert.equal(normalizeTmpAlias(parsedStatusControl.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(parsedStatusExternal.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(parsedStatusControl.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(parsedStatusExternal.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));

  const statusControlNested = await runCliFromCwd(controlNestedCwd, ["factory", "status"]);
  const statusExternalNested = await runCliFromCwd(externalNestedCwd, ["factory", "status"]);
  assert.equal(statusControlNested.exitCode, 0, statusControlNested.stderr);
  assert.equal(statusExternalNested.exitCode, 0, statusExternalNested.stderr);
  assert.equal(normalizeDynamicText(statusControlNested.stdout), normalizeDynamicText(statusControl.stdout));
  assert.equal(normalizeDynamicText(statusExternalNested.stdout), normalizeDynamicText(statusExternal.stdout));

  const statusControlNestedJson = JSON.parse((await runCliFromCwd(controlNestedCwd, ["factory", "status", "--json"])).stdout);
  const statusExternalNestedJson = JSON.parse((await runCliFromCwd(externalNestedCwd, ["factory", "status", "--json"])).stdout);
  assert.equal(normalizeTmpAlias(statusControlNestedJson.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(statusExternalNestedJson.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(statusControlNestedJson.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(statusExternalNestedJson.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));

  const summaryControl = await runCliFromCwd(controlRoot, ["factory", "active-summary"]);
  const summaryExternal = await runCliFromCwd(externalRoot, ["factory", "active-summary"]);
  assert.equal(summaryControl.exitCode, 0, summaryControl.stderr);
  assert.equal(summaryExternal.exitCode, 0, summaryExternal.stderr);
  assert.match(summaryControl.stdout, /Factory ID: mothership/);
  assert.match(summaryExternal.stdout, /Factory ID: mothership/);
  assert.doesNotMatch(summaryControl.stdout, /^\s*\{/);
  assert.doesNotMatch(summaryExternal.stdout, /^\s*\{/);
  assert.equal(
    normalizeTmpAlias(readHeaderValue(summaryControl.stdout, "Factory")),
    normalizeTmpAlias(expectedControlFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(summaryExternal.stdout, "Factory")),
    normalizeTmpAlias(expectedExternalFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(summaryControl.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedControlRunsDir),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(summaryExternal.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedExternalRunsDir),
  );
  assert.match(summaryControl.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.match(summaryExternal.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.equal(normalizeDynamicText(summaryControl.stdout), normalizeDynamicText(summaryExternal.stdout));

  const summaryControlJson = await runCliFromCwd(controlRoot, ["factory", "active-summary", "--json"]);
  const summaryExternalJson = await runCliFromCwd(externalRoot, ["factory", "active-summary", "--json"]);
  const parsedSummaryControl = JSON.parse(summaryControlJson.stdout);
  const parsedSummaryExternal = JSON.parse(summaryExternalJson.stdout);
  assert.ok(Array.isArray(parsedSummaryControl.waves));
  assert.ok(Array.isArray(parsedSummaryControl.non_wave_active));
  assert.equal(parsedSummaryControl.sections, undefined);
  assert.ok(Array.isArray(parsedSummaryExternal.waves));
  assert.ok(Array.isArray(parsedSummaryExternal.non_wave_active));
  assert.equal(parsedSummaryExternal.sections, undefined);
  assert.equal(parsedSummaryControl.context.factory_id, "mothership");
  assert.equal(parsedSummaryExternal.context.factory_id, "mothership");
  assert.equal(normalizeTmpAlias(parsedSummaryControl.context.factory_root), normalizeTmpAlias(expectedControlFactoryRoot));
  assert.equal(normalizeTmpAlias(parsedSummaryExternal.context.factory_root), normalizeTmpAlias(expectedExternalFactoryRoot));
  assert.equal(normalizeTmpAlias(parsedSummaryControl.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(parsedSummaryExternal.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(parsedSummaryControl.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(parsedSummaryExternal.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));

  const summaryControlNested = await runCliFromCwd(controlNestedCwd, ["factory", "active-summary"]);
  const summaryExternalNested = await runCliFromCwd(externalNestedCwd, ["factory", "active-summary"]);
  assert.equal(summaryControlNested.exitCode, 0, summaryControlNested.stderr);
  assert.equal(summaryExternalNested.exitCode, 0, summaryExternalNested.stderr);
  assert.equal(normalizeDynamicText(summaryControlNested.stdout), normalizeDynamicText(summaryControl.stdout));
  assert.equal(normalizeDynamicText(summaryExternalNested.stdout), normalizeDynamicText(summaryExternal.stdout));

  const summaryControlNestedJson = JSON.parse((await runCliFromCwd(controlNestedCwd, ["factory", "active-summary", "--json"])).stdout);
  const summaryExternalNestedJson = JSON.parse((await runCliFromCwd(externalNestedCwd, ["factory", "active-summary", "--json"])).stdout);
  assert.equal(normalizeTmpAlias(summaryControlNestedJson.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(summaryExternalNestedJson.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(summaryControlNestedJson.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(summaryExternalNestedJson.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));

  const tickControl = await runCliFromCwd(controlRoot, ["factory", "tick-status"]);
  const tickExternal = await runCliFromCwd(externalRoot, ["factory", "tick-status"]);
  assert.equal(tickControl.exitCode, 0, tickControl.stderr);
  assert.equal(tickExternal.exitCode, 0, tickExternal.stderr);
  assert.match(tickControl.stdout, /CURRENT TICK/);
  assert.match(tickExternal.stdout, /CURRENT TICK/);
  assert.doesNotMatch(tickControl.stdout, /^\s*\{/);
  assert.doesNotMatch(tickExternal.stdout, /^\s*\{/);
  assert.equal(
    normalizeTmpAlias(readHeaderValue(tickControl.stdout, "Factory")),
    normalizeTmpAlias(expectedControlFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(tickExternal.stdout, "Factory")),
    normalizeTmpAlias(expectedExternalFactoryRoot),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(tickControl.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedControlRunsDir),
  );
  assert.equal(
    normalizeTmpAlias(readHeaderValue(tickExternal.stdout, "Runs Dir")),
    normalizeTmpAlias(expectedExternalRunsDir),
  );
  assert.match(tickControl.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.match(tickExternal.stdout, /Control Plane: recallnet\/astrochicken/);
  assert.equal(normalizeDynamicText(tickControl.stdout), normalizeDynamicText(tickExternal.stdout));
  assert.match(tickControl.stdout, /CURRENT TICK/);
  assert.match(tickControl.stdout, /LAST TICK/);
  assert.match(tickExternal.stdout, /CURRENT TICK/);
  assert.match(tickExternal.stdout, /LAST TICK/);

  const tickControlJson = await runCliFromCwd(controlRoot, ["factory", "tick-status", "--json"]);
  const tickExternalJson = await runCliFromCwd(externalRoot, ["factory", "tick-status", "--json"]);
  const parsedTickControl = JSON.parse(tickControlJson.stdout);
  const parsedTickExternal = JSON.parse(tickExternalJson.stdout);
  assert.ok(Array.isArray(parsedTickControl.ticks));
  assert.equal(parsedTickControl.sections, undefined);
  assert.ok(Array.isArray(parsedTickExternal.ticks));
  assert.equal(parsedTickExternal.sections, undefined);
  assert.equal(parsedTickControl.context.factory_id, "mothership");
  assert.equal(parsedTickExternal.context.factory_id, "mothership");
  assert.equal(normalizeTmpAlias(parsedTickControl.context.factory_root), normalizeTmpAlias(expectedControlFactoryRoot));
  assert.equal(normalizeTmpAlias(parsedTickExternal.context.factory_root), normalizeTmpAlias(expectedExternalFactoryRoot));
  assert.equal(parsedTickControl.context.control_plane_repo, "recallnet/astrochicken");
  assert.equal(parsedTickExternal.context.control_plane_repo, "recallnet/astrochicken");
  assert.equal(normalizeTmpAlias(parsedTickControl.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(parsedTickExternal.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(parsedTickControl.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(parsedTickExternal.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));

  const tickControlNested = await runCliFromCwd(controlNestedCwd, ["factory", "tick-status"]);
  const tickExternalNested = await runCliFromCwd(externalNestedCwd, ["factory", "tick-status"]);
  assert.equal(tickControlNested.exitCode, 0, tickControlNested.stderr);
  assert.equal(tickExternalNested.exitCode, 0, tickExternalNested.stderr);
  assert.equal(normalizeDynamicText(tickControlNested.stdout), normalizeDynamicText(tickControl.stdout));
  assert.equal(normalizeDynamicText(tickExternalNested.stdout), normalizeDynamicText(tickExternal.stdout));

  const tickControlNestedJson = JSON.parse((await runCliFromCwd(controlNestedCwd, ["factory", "tick-status", "--json"])).stdout);
  const tickExternalNestedJson = JSON.parse((await runCliFromCwd(externalNestedCwd, ["factory", "tick-status", "--json"])).stdout);
  assert.equal(normalizeTmpAlias(tickControlNestedJson.context.runs_dir), normalizeTmpAlias(expectedControlRunsDir));
  assert.equal(normalizeTmpAlias(tickExternalNestedJson.context.runs_dir), normalizeTmpAlias(expectedExternalRunsDir));
  assert.equal(normalizeTmpAlias(tickControlNestedJson.context.scenarios_root), normalizeTmpAlias(expectedControlScenariosRoot));
  assert.equal(normalizeTmpAlias(tickExternalNestedJson.context.scenarios_root), normalizeTmpAlias(expectedExternalScenariosRoot));
});

test("factory active-summary resolves context deterministically in both roots after the canonical cutover", async () => {
  await clearCanonicalEvents(canonicalEventStore.connectionString);
  const controlRoot = mkdtempSync(join(tmpdir(), "factory-context-summary-control-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "factory-context-summary-external-"));

  buildConfig({
    rootDir: controlRoot,
    configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
  });
  buildConfig({
    rootDir: externalRoot,
    configPath: join(externalRoot, "factory.config.json"),
  });

  const writeNonWaveRuns = (runsDir) => {
    mkdirSync(runsDir, { recursive: true });
    const nowIso = new Date().toISOString();
    for (let i = 1; i <= 7; i++) {
      writeJson(join(runsDir, `nonwave-${i}`, "state.json"), {
        runId: `nonwave-${i}`,
        pipeline: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_queue.dot",
        status: "running",
        pid: process.pid,
        currentNode: `node_${i}`,
        startedAt: nowIso,
        updatedAt: nowIso,
        context: {},
      });
    }
  };

  writeNonWaveRuns(join(controlRoot, ".hatch", "mothership", "runs"));
  writeNonWaveRuns(join(externalRoot, ".hatch", "mothership", "runs"));
  buildReleaseManifestFixture(controlRoot);
  buildReleaseManifestFixture(externalRoot);

  const summaryControl = await runCliFromCwd(controlRoot, ["factory", "active-summary"]);
  const summaryExternal = await runCliFromCwd(externalRoot, ["factory", "active-summary"]);

  assert.equal(summaryControl.exitCode, 0, summaryControl.stderr);
  assert.equal(summaryExternal.exitCode, 0, summaryExternal.stderr);
  assert.doesNotMatch(summaryControl.stdout, /^\s*\{/);
  assert.doesNotMatch(summaryExternal.stdout, /^\s*\{/);
  assert.match(summaryControl.stdout, /Active runs: 0/);
  assert.match(summaryExternal.stdout, /Active runs: 0/);
  assert.match(summaryControl.stdout, /Active waves: 0/);
  assert.match(summaryExternal.stdout, /Active waves: 0/);
  assert.doesNotMatch(summaryControl.stdout, /factory session-tail/);
  assert.doesNotMatch(summaryExternal.stdout, /factory session-tail/);
  assert.equal(normalizeDynamicText(summaryControl.stdout), normalizeDynamicText(summaryExternal.stdout));

  const summaryControlJson = JSON.parse((await runCliFromCwd(controlRoot, ["factory", "active-summary", "--json"])).stdout);
  const summaryExternalJson = JSON.parse((await runCliFromCwd(externalRoot, ["factory", "active-summary", "--json"])).stdout);
  assert.equal(summaryControlJson.sections, undefined);
  assert.equal(summaryExternalJson.sections, undefined);
  assert.ok(Array.isArray(summaryControlJson.non_wave_active));
  assert.ok(Array.isArray(summaryExternalJson.non_wave_active));
  assert.equal(summaryControlJson.non_wave_active.length, 0);
  assert.equal(summaryExternalJson.non_wave_active.length, 0);
});

test("common resolve-factory-config resolves active factory context across control-plane/external roots", async () => {
  const controlRoot = mkdtempSync(join(tmpdir(), "factory-context-common-control-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "factory-context-common-external-"));

  buildConfig({
    rootDir: controlRoot,
    configPath: join(controlRoot, "factories", "mothership", "factory.config.json"),
    overrides: {
      max_concurrent_waves: 8,
    },
  });

  buildConfig({
    rootDir: externalRoot,
    configPath: join(externalRoot, "factory.config.json"),
    overrides: {
      factory_id: "acme-support",
      factory_root: ".",
      target_repo: "acme/support-factory",
      control_plane_repo: "recallnet/astrochicken",
      runs_dir: ".hatch/acme-support/runs",
      scenarios: { root: "scenarios/acme-support" },
      max_concurrent_waves: 11,
    },
  });

  const control = await runCliFromCwd(controlRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
  ]);
  const external = await runCliFromCwd(externalRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
  ]);

  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(external.exitCode, 0, external.stderr);
  assert.equal(control.stdout.trim(), "8");
  assert.equal(external.stdout.trim(), "11");

  const controlNestedCwd = join(controlRoot, "factories", "mothership", "graphs", "nested");
  const externalNestedCwd = join(externalRoot, "graphs", "nested");
  mkdirSync(controlNestedCwd, { recursive: true });
  mkdirSync(externalNestedCwd, { recursive: true });

  const controlNested = await runCliFromCwd(controlNestedCwd, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
  ]);
  const externalNested = await runCliFromCwd(externalNestedCwd, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
  ]);

  assert.equal(controlNested.exitCode, 0, controlNested.stderr);
  assert.equal(externalNested.exitCode, 0, externalNested.stderr);
  assert.equal(controlNested.stdout.trim(), "8");
  assert.equal(externalNested.stdout.trim(), "11");

  const overrideConfigPath = join(controlRoot, "override.factory.config.json");
  writeJson(overrideConfigPath, {
    factory_id: "override-factory",
    target_repo: "override/target",
    control_plane_repo: "override/control",
    scenarios: { root: "factories/override-factory/scenarios/override-factory" },
    max_concurrent_waves: 13,
  });
  const explicitOverride = await runCliFromCwd(externalRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
    "--factory-config-path",
    overrideConfigPath,
  ]);
  assert.equal(explicitOverride.exitCode, 0, explicitOverride.stderr);
  assert.equal(explicitOverride.stdout.trim(), "13");

  const aliasOverride = await runCliFromCwd(externalRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
    "--config-path",
    overrideConfigPath,
  ]);
  assert.equal(aliasOverride.exitCode, 0, aliasOverride.stderr);
  assert.equal(aliasOverride.stdout.trim(), "13");

  const canonicalOverrideConfigPath = join(controlRoot, "canonical.factory.config.json");
  writeJson(canonicalOverrideConfigPath, {
    factory_id: "canonical-factory",
    target_repo: "canonical/target",
    control_plane_repo: "canonical/control",
    scenarios: { root: "factories/canonical-factory/scenarios/canonical-factory" },
    max_concurrent_waves: 15,
  });
  const precedence = await runCliFromCwd(externalRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
    "--factory-config-path",
    canonicalOverrideConfigPath,
    "--config-path",
    overrideConfigPath,
  ]);
  assert.equal(precedence.exitCode, 0, precedence.stderr);
  assert.equal(precedence.stdout.trim(), "15");

  const keyMissingFallback = await runCliFromCwd(controlRoot, [
    "common",
    "resolve-factory-config",
    "--key",
    "unknown_key",
    "--fallback",
    "3",
  ]);
  assert.equal(keyMissingFallback.exitCode, 0, keyMissingFallback.stderr);
  assert.equal(keyMissingFallback.stdout.trim(), "3");
});

test("common resolve-factory-config exits 2 on context resolution failure", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "factory-context-common-error-"));
  const out = await runCliFromCwd(cwd, [
    "common",
    "resolve-factory-config",
    "--key",
    "max_concurrent_waves",
    "--fallback",
    "3",
    "--factory-config-path",
    "does/not/exist/factory.config.json",
  ]);

  assert.equal(out.exitCode, 2);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /\[factory-context\] unable to load factory\.config\.json/);
});

test("factory fleet-status command is discoverable and forwards shared context flags", () => {
  const source = readFileSync(new URL("../../src/cli/commands/factory-status-cmds.ts", import.meta.url), "utf8");
  assert.match(source, /class FactoryFleetStatusCommand/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*static paths = \[\["factory", "fleet-status"\]\]/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.Boolean\("--json", false\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--lookback-hours", "24"\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--factory-root", ""\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--factory-config-path", ""\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*Option\.String\("--factory-id", ""\)/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*resolveFactoryContextOrExit\(this, \{/);
  assert.match(source, /FactoryFleetStatusCommand[\s\S]*context,\n\s*lookbackHours:/);
});

// @context:regression External factories must not inherit an unrelated ancestor release store.
test("external factory release lookup ignores an unrelated two-parent hatch directory", () => {
  const root = mkdtempSync(join(tmpdir(), "external-release-root-"));
  const externalRoot = join(root, "nested", "external");
  const runsDir = join(externalRoot, ".hatch", "mothership", "runs");
  mkdirSync(join(root, ".hatch"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  assert.equal(resolveControlPlaneHatchRoot({ runsDir, context: { factory_root: externalRoot } }), join(externalRoot, ".hatch"));
});
