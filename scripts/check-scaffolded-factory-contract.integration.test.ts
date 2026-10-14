import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { before, after } from "node:test";
import { createCanonicalEventStoreFixture } from "../packages/factory-ops/test/supervisor/factory-status-postgres-fixture.ts";
import { fileURLToPath } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";
import { scaffoldFactoryFixture } from "./lib/scaffold-factory-fixture.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const contractScriptPath = join(repoRoot, "scripts", "check-scaffolded-factory-contract.ts");

const eventStoreFixture = createCanonicalEventStoreFixture();
const previousEventStoreUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
before(async () => {
  await eventStoreFixture.setup();
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = eventStoreFixture.connectionString;
});
after(() => {
  if (previousEventStoreUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousEventStoreUrl;
  eventStoreFixture.teardown();
});

const FACTORY_CONTEXT_ENV_KEYS = [
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
  "HATCH_CANONICAL_CHECKOUT_PATH",
  "FACTORY_CONTEXT_REPO_PATH",
];

function buildIsolatedFactoryContextEnv() {
  const env = { ...process.env };
  for (const key of FACTORY_CONTEXT_ENV_KEYS) delete env[key];
  return env;
}

function seedWorkspace(tempRoot) {
  const templateSource = join(repoRoot, "factories", "_templates", "factory");
  const templateTarget = join(tempRoot, "factories", "_templates", "factory");
  const policyPackSource = join(repoRoot, "factories", "_templates", "policy-pack");
  const policyPackTarget = join(tempRoot, "factories", "_templates", "policy-pack");

  mkdirSync(join(tempRoot, "factories", "_templates"), { recursive: true });
  mkdirSync(join(tempRoot, "docs", "contracts"), { recursive: true });
  cpSync(templateSource, templateTarget, { recursive: true });
  cpSync(policyPackSource, policyPackTarget, { recursive: true });

  writeFileSync(
    join(tempRoot, "docs", "contracts", "benchmark-job-registry.json"),
    `${JSON.stringify({ schema_version: "benchmark_job_registry/v1", jobs: [{ job_id: "supervisor.tick.review", description: "fixture", nodes: [{ graph: "factory_supervisor_tick.dot", node_id: "supervisor_review" }] }] }, null, 2)}\n`,
  );

  writeFileSync(
    join(tempRoot, "factory-registry.json"),
    `${JSON.stringify({ schema: "hatch.factory.registry.v1", factories: [] }, null, 2)}\n`,
  );
}

async function scaffoldFactory(tempRoot) {
  return scaffoldFactoryFixture({
    repoRoot,
    rootDir: tempRoot,
    factoryId: "health-contract-fixture",
    repo: "example-org/health-contract-fixture",
    controlPlane: "recallnet/astrochicken",
    runsDir: ".hatch/health-contract-fixture/runs",
    trackingIssue: {
      url: "https://github.com/recallnet/astrochicken/issues/1626",
      number: 1626,
      created: false,
    },
  });
}

test("check-scaffolded-factory-contract forwards --factory-root/--repo-root to factory:health", async () => {
  ensureHatchBuild({ repoRoot });
  const tempRoot = mkdtempSync(join(tmpdir(), "scaffold-contract-health-"));

  try {
    seedWorkspace(tempRoot);
    const scaffoldResult = await scaffoldFactory(tempRoot);
    // Exercise real health forwarding with a bounded local workflow and isolated
    // event store; a generated factory must not contact example GitHub targets.
    const smokeGraph = join(scaffoldResult.factoryRoot, "conformance", "factory_supervisor_tick.dot");
    mkdirSync(dirname(smokeGraph), { recursive: true });
    cpSync(join(repoRoot, "factories/_shared/conformance/factory_supervisor_tick.dot"), smokeGraph);
    const configPath = join(scaffoldResult.factoryRoot, "factory.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.conformance = { ...config.conformance, smoke_graph: smokeGraph };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    const run = spawnSync(
      "node",
      [
        contractScriptPath,
        "--factory-root",
        scaffoldResult.factoryRoot,
        "--repo-root",
        tempRoot,
      ],
      {
        cwd: repoRoot,
        env: {
          ...buildIsolatedFactoryContextEnv(),
          HATCH_FACTORY_GITHUB_TOKEN: "test-token",
        },
        encoding: "utf8",
      },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /\[scaffold-contract\] phase=factory-health result=ok exit=0/);
    assert.match(run.stderr, /factory_health phase=config_schema result=ok/);
    assert.match(run.stderr, /factory_health result=ok failed_phase=/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("check-scaffolded-factory-contract accepts --silent for release-quality invocation", async () => {
  ensureHatchBuild({ repoRoot });
  const run = spawnSync(
    "node",
    [
      contractScriptPath,
      "--silent",
    ],
    {
      cwd: repoRoot,
      env: buildIsolatedFactoryContextEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.doesNotMatch(run.stdout, /\[scaffold-contract\]/);
});
