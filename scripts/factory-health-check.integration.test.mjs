import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { before, after } from "node:test";
import { createCanonicalEventStoreFixture } from "../packages/factory-ops/test/supervisor/factory-status-postgres-fixture.ts";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";
import { runFactoryHealthCheck } from "./factory-health-check.mjs";

// Test operator visibility against a disposable store, never the host's live database.
const postgresFixture = createCanonicalEventStoreFixture();
const previousEventStoreUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
before(async () => {
	await postgresFixture.setup();
	process.env.HATCH_CANONICAL_EVENT_STORE_URL = postgresFixture.connectionString;
});
after(() => {
	if (previousEventStoreUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
	else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousEventStoreUrl;
	postgresFixture.teardown();
});

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const initModulePath = join(repoRoot, "apps", "hatch", "dist", "factory", "init.js");
const cliPath = join(repoRoot, "scripts", "factory-health-check.mjs");

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

async function withIsolatedFactoryContextEnv(callback) {
  const previousEnv = new Map();
  for (const key of FACTORY_CONTEXT_ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return await callback();
  } finally {
    for (const key of FACTORY_CONTEXT_ENV_KEYS) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
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
    join(tempRoot, "factory-registry.json"),
    `${JSON.stringify({ schema: "hatch.factory.registry.v1", factories: [] }, null, 2)}\n`,
  );
  writeFileSync(
    join(tempRoot, "docs", "contracts", "benchmark-job-registry.json"),
    `${JSON.stringify({
      schema_version: "benchmark_job_registry/v1",
      jobs: [
        {
          job_id: "fixture.placeholder",
          description: "fixture placeholder",
          nodes: [{ graph: "factory_supervisor_tick.dot", node_id: "start" }],
        },
      ],
    }, null, 2)}\n`,
  );
}

async function scaffoldFactory(tempRoot) {
  const { initFactory } = await import(pathToFileURL(initModulePath).href);
  return initFactory(
    {
      factoryId: "health-fixture",
      repo: "example-org/health-fixture",
      controlPlane: "recallnet/astrochicken",
      force: false,
      rootDir: tempRoot,
      runsDir: ".hatch/health-fixture/runs",
    },
    {
      resolveTrackingIssue: () => ({
        url: "https://github.com/recallnet/astrochicken/issues/1626",
        number: 1626,
        created: false,
      }),
    },
  );
}

test("runFactoryHealthCheck emits deterministic phase markers for healthy scaffold", async () => {
  ensureHatchBuild({ repoRoot });
  const tempRoot = mkdtempSync(join(tmpdir(), "factory-health-check-"));

  try {
    seedWorkspace(tempRoot);
    const scaffoldResult = await scaffoldFactory(tempRoot);

    const markers = [];
    const originalToken = process.env.HATCH_FACTORY_GITHUB_TOKEN;

    let result;
    try {
      result = await withIsolatedFactoryContextEnv(async () => {
        process.env.HATCH_FACTORY_GITHUB_TOKEN = originalToken || "test-token";
        return runFactoryHealthCheck({
          factoryRoot: scaffoldResult.factoryRoot,
          repoRoot: tempRoot,
          skipBuild: true,
          emitMarker(line) {
            markers.push(line);
          },
        });
      });
    } finally {
      if (originalToken === undefined) delete process.env.HATCH_FACTORY_GITHUB_TOKEN;
      else process.env.HATCH_FACTORY_GITHUB_TOKEN = originalToken;
    }

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.exitStatus, 0);

    const expectedPhases = [
      "build_hatch",
      "config_schema",
      "graph_validate",
      "dot_lint",
      "recovery_ownership",
      "run_dir_isolation",
      "supervisor_tick_smoke",
      "operational_e2e",
      "ops_contract",
    ];

    for (const phase of expectedPhases) {
      assert.ok(
        markers.some((line) => line.includes(`factory_health phase=${phase} result=ok`)),
        `missing ok marker for phase=${phase}`,
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("factory-health CLI fails with deterministic parse_args marker when factory root is missing", () => {
  const run = spawnSync("node", [cliPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /factory_health phase=parse_args result=fail detail="--factory-root is required"/);
});

test("factory-health CLI fails with deterministic parse_args marker for missing path", () => {
  const run = spawnSync("node", [cliPath, "--factory-root", join(repoRoot, "missing-factory-root")], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /factory_health phase=parse_args result=fail detail="factory root not found:/);
});
