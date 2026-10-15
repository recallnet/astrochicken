import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_QUALITY_FAMILY_MANIFEST,
  resolvePlatformInvariantMatches,
  resolveReleaseQualityGatePlan,
} from "./lib/platform-invariant-manifest.ts";
import { buildPlatformGateEnv, resolveParallelGateConcurrency, runGateEntries } from "./run-platform-invariant-gates.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(scriptsDir, "run-platform-invariant-gates.mjs");

const FACTORY_PORTABILITY_PATHS = Object.freeze([
  "packages/factory-ops/src/lib/factory-context-resolver.ts",
  "packages/factory-ops/src/lib/runs-dir-resolver.ts",
  "packages/factory-ops/src/commands/factory-status.ts",
  "packages/factory-ops/src/commands/factory-tick-status.ts",
  "packages/factory-ops/src/commands/common-resolve-default.ts",
  "packages/factory-ops/src/cli/commands/factory.ts",
  "packages/factory-ops/src/cli/commands/common.ts",
]);

const INVARIANT_COVERAGE_CASES = Object.freeze([
  Object.freeze({
    path: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
    invariantIds: Object.freeze(["factory_shared_surfaces"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/cli-run-config.test.ts",
    invariantIds: Object.freeze(["cli_context_portability"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/runs-context-portability.integration.test.ts",
    invariantIds: Object.freeze(["cli_context_portability"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/test/supervisor/factory-context-resolution-cli.cli.test.ts",
    invariantIds: Object.freeze(["cli_context_portability", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/test/supervisor/factory-cli-context-portability-spawn.integration.test.ts",
    invariantIds: Object.freeze(["cli_context_portability", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/pipeline/graph-recovery-invariants.ts",
    invariantIds: Object.freeze(["supervisor_recovery"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/test/supervisor/fixtures/state-machines/external-factory-lifecycle.machine.json",
    invariantIds: Object.freeze(["supervisor_recovery"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/commands/common-resolve-gh-repo.ts",
    invariantIds: Object.freeze(["external_factory_compat"]),
  }),
  Object.freeze({
    path: "factory-registry.json",
    invariantIds: Object.freeze(["scaffold_contract", "managed-factory-config-surfaces", "provisioning_drift", "factory_registry_consistency"]),
  }),
  Object.freeze({
    path: "docs/contracts/factory-public-contract.v1.json",
    invariantIds: Object.freeze(["factory_public_contract"]),
  }),
  Object.freeze({
    path: "docs/contracts/runtime-release-manifest.json",
    invariantIds: Object.freeze(["runtime_external_entrypoints_contract"]),
  }),
  Object.freeze({
    path: "apps/hatch/package.json",
    invariantIds: Object.freeze(["runtime_external_entrypoints_contract"]),
  }),
  Object.freeze({
    path: "factories/_templates/factory/factory.config.json.template",
    invariantIds: Object.freeze(["scaffold_contract", "factory_public_contract"]),
  }),
  Object.freeze({
    path: "factories/brainstorm/kind.json",
    invariantIds: Object.freeze(["managed-factory-config-surfaces", "provisioning_drift", "factory_registry_consistency", "managed_supervisor_shell_contract"]),
  }),
  Object.freeze({
    path: "factories/brainstorm/factory.config.json",
    invariantIds: Object.freeze(["factory_env_contracts", "managed-factory-config-surfaces", "provisioning_drift"]),
  }),
  Object.freeze({
    path: "factories/mothership/env.contract.json",
    invariantIds: Object.freeze(["factory_env_contracts"]),
  }),
  Object.freeze({
    path: "factories/mothership/.env.example",
    invariantIds: Object.freeze(["factory_env_contracts"]),
  }),
  Object.freeze({
    path: "config/testing/factory-env/shared-env.contract.json",
    invariantIds: Object.freeze(["factory_env_contracts"]),
  }),
  Object.freeze({
    path: "scripts/check-provisioning-drift.ts",
    invariantIds: Object.freeze(["cli_context_portability", "provisioning_drift"]),
  }),
  Object.freeze({
    path: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
    invariantIds: Object.freeze(["managed_supervisor_shell_contract", "managed-factory-mutation-boundaries", "managed-factory-telemetry-contract"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/lib/external-factory-control-state.ts",
    invariantIds: Object.freeze(["managed_supervisor_shell_contract"]),
  }),
  Object.freeze({
    path: "packages/factory-runtime/telemetry/managed-factory-telemetry.mjs",
    invariantIds: Object.freeze(["managed-factory-telemetry-contract"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/lib/daemon.ts",
    invariantIds: Object.freeze(["managed-factory-telemetry-contract"]),
  }),
  Object.freeze({
    path: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
    invariantIds: Object.freeze(["managed_supervisor_shell_contract", "managed-factory-mutation-boundaries", "managed-factory-telemetry-contract", "managed_factory_telemetry_contract", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "scripts/test/golden/managed-boundary-violation.dot",
    invariantIds: Object.freeze(["cli_context_portability", "managed-factory-mutation-boundaries"]),
  }),
  Object.freeze({
    path: "docs/contracts/factory-label-contract.json",
    invariantIds: Object.freeze(["managed-factory-mutation-boundaries", "factory_label_contract"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/commands/supervisor-artifact.ts",
    invariantIds: Object.freeze(["managed-factory-mutation-boundaries", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
    invariantIds: Object.freeze(["managed-factory-mutation-boundaries", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "packages/factory-ops/src/lib/incident-packet.ts",
    invariantIds: Object.freeze(["managed-factory-mutation-boundaries", "supervisor_recovery"]),
  }),
  Object.freeze({
    path: "examples/external-factories/acme-support/graphs/factory_supervisor_tick.dot",
    invariantIds: Object.freeze(["external_factory_compat", "external_factory_portability_matrix", "external_factory_smoke"]),
  }),
  Object.freeze({
    path: "examples/external-factories/acme-support/factory.config.json",
    invariantIds: Object.freeze(["external_factory_compat", "external_factory_portability_matrix", "external_factory_smoke"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/factory/external-factory-portability.contract.test.ts",
    invariantIds: Object.freeze(["scaffold_contract", "external_factory_portability_matrix"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/factory/public-factory-contract.contract.test.ts",
    invariantIds: Object.freeze(["scaffold_contract", "external_factory_portability_matrix", "factory_public_contract"]),
  }),
  Object.freeze({
    path: "apps/hatch/src/pipeline/context.ts",
    invariantIds: Object.freeze(["external_factory_portability_matrix"]),
  }),
  ...FACTORY_PORTABILITY_PATHS.map((path) => Object.freeze({
    path,
    invariantIds: Object.freeze(["factory_portability"]),
  })),
  Object.freeze({
    path: "factories/_shared/surfaces/graphs/release_report_flow.dot.template",
    invariantIds: Object.freeze(["factory_shared_surfaces", "factory_shared_surface_consumption", "factory_shared_surface_manifest", "factory_label_contract"]),
  }),
  Object.freeze({
    path: "docs/contracts/shared-surface-manifest.json",
    invariantIds: Object.freeze(["factory_shared_surface_manifest"]),
  }),
]);

const RELEASE_QUALITY_FAMILY_IDS = Object.freeze([
  "core_invariants",
  "recovery_graph_invariants",
  "scaffold_golden_conformance",
  "external_factory_portability",
  "external_factory_portability_matrix",
  "docs_skills_template_contracts",
]);

function toNulDelimited(paths) {
  if (!paths.length) {
    return Buffer.alloc(0);
  }
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function extractTelemetryIds(streamOutput, key) {
  return [...new Set([...streamOutput.matchAll(new RegExp(`${key}=([a-z0-9_-]+)`, "g"))].map(([, id]) => id))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

test("manifest matching is deterministic and ordered by priority", () => {
  const matches = resolvePlatformInvariantMatches([
    "docs/skills/factory-design/SKILL.md",
    "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);

  assert.deepEqual(matches.map((entry) => entry.id), [
    "cli_context_portability",
    "managed-factory-mutation-boundaries",
    "supervisor_recovery",
    "docs_skills_templates",
  ]);
});

test("release-quality manifest contains the required invariant families", () => {
  assert.deepEqual(
    RELEASE_QUALITY_FAMILY_MANIFEST.map((family) => family.id),
    RELEASE_QUALITY_FAMILY_IDS,
  );

  for (const family of RELEASE_QUALITY_FAMILY_MANIFEST) {
    assert.equal(typeof family.evidenceRole, "string");
    assert.equal(family.evidenceRole.length > 0, true);
    assert.equal(typeof family.sourceInvariantId, "string");
    assert.equal(family.sourceInvariantId.length > 0, true);
  }
});

test("buildPlatformGateEnv strips hook-scoped git repository plumbing vars", () => {
  const env = buildPlatformGateEnv({
    GIT_DIR: "/tmp/bare/worktrees/repo",
    GIT_PREFIX: "packages/factory-ops/",
    GIT_WORK_TREE: "/tmp/repo",
    NODE_OPTIONS: "--max-old-space-size=16384",
    NODE_PATH: "/tmp/global-node-path",
    KEEP_ME: "yes",
  });

  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_PREFIX, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.KEEP_ME, "yes");
});

test("buildPlatformGateEnv strips npm and pnpm bookkeeping vars for plain node entries", () => {
  const env = buildPlatformGateEnv({
    npm_config_user_agent: "pnpm",
    PNPM_HOME: "/tmp/pnpm-home",
    INIT_CWD: "/tmp/hook-temp",
    KEEP_ME: "yes",
  }, { command: "node" });

  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.PNPM_HOME, undefined);
  assert.equal(env.INIT_CWD, undefined);
  assert.equal(env.KEEP_ME, "yes");
});

test("buildPlatformGateEnv preserves pnpm bookkeeping vars for pnpm entries except INIT_CWD", () => {
  const env = buildPlatformGateEnv({
    npm_config_user_agent: "pnpm",
    PNPM_HOME: "/tmp/pnpm-home",
    INIT_CWD: "/tmp/hook-temp",
  }, { command: "pnpm" });

  assert.equal(env.npm_config_user_agent, "pnpm");
  assert.equal(env.PNPM_HOME, "/tmp/pnpm-home");
  assert.equal(env.INIT_CWD, undefined);
});

test("resolveParallelGateConcurrency fails closed to a laptop-safe default", () => {
  const original = process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  try {
    assert.equal(resolveParallelGateConcurrency({}), 2);
  } finally {
    if (original === undefined) {
      delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
    } else {
      process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY = original;
    }
  }
});

test("resolveParallelGateConcurrency honors explicit env overrides", () => {
  const original = process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY = "5";
  try {
    assert.equal(resolveParallelGateConcurrency({}), 5);
  } finally {
    if (original === undefined) {
      delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
    } else {
      process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY = original;
    }
  }
});

test("release-quality gate plan runs all families when any shared-platform trigger path is staged", () => {
  const plan = resolveReleaseQualityGatePlan([
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);

  assert.equal(plan.shouldRun, true);
  assert.deepEqual(plan.matchedPaths, ["scripts/pre-commit-staged-file-classifier.mjs"]);
  assert.deepEqual(plan.families.map((family) => family.id), RELEASE_QUALITY_FAMILY_IDS);
});

test("platform_invariants skips invariants already covered by release_quality", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "platform_invariants", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited([
        "apps/hatch/src/cli-run-config.test.ts",
        "packages/factory-ops/test/supervisor/factory-context-resolution-cli.cli.test.ts",
      ]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /gate_skip gate=platform_invariants reason=no_matching_invariants/);
  assert.doesNotMatch(run.stdout, /invariant=cli_context_portability/);
  assert.doesNotMatch(run.stdout, /invariant=supervisor_recovery/);
});

test("contract-critical invariant paths map to deterministic invariant sets", () => {
  for (const { path, invariantIds } of INVARIANT_COVERAGE_CASES) {
    const matches = resolvePlatformInvariantMatches([path]);
    assert.deepEqual(matches.map((entry) => entry.id), invariantIds, `${path} should match ${invariantIds.join(",")}`);
  }
});

test("runner dry-run executes matching invariant once and emits deterministic gate telemetry", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["packages/factory-runtime/telemetry/managed-factory-telemetry.mjs"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=platform_invariants invariant=managed-factory-telemetry-contract/);
  assert.match(run.stdout, /gate_pass gate=platform_invariants invariant=managed-factory-telemetry-contract/);
  assert.doesNotMatch(run.stdout, /invariant=supervisor_recovery/);
});

test("runner dry-run executes factory_shared_surface_consumption and factory_shared_surface_manifest invariants for shared surfaces", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["factories/_shared/surfaces/graphs/release_report_flow.dot.template"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=platform_invariants invariant=factory_shared_surfaces/);
  assert.match(run.stdout, /gate_pass gate=platform_invariants invariant=factory_shared_surfaces/);
  assert.match(run.stdout, /gate_start gate=platform_invariants invariant=factory_shared_surface_consumption/);
  assert.match(run.stdout, /gate_pass gate=platform_invariants invariant=factory_shared_surface_consumption/);
  assert.match(run.stdout, /gate_start gate=platform_invariants invariant=factory_shared_surface_manifest/);
  assert.match(run.stdout, /gate_pass gate=platform_invariants invariant=factory_shared_surface_manifest/);
});

test("runner dry-run emits deterministic gate telemetry for contract-critical paths", () => {
  const releaseQualitySourceIds = new Set(
    RELEASE_QUALITY_FAMILY_MANIFEST.map((family) => family.sourceInvariantId).filter(Boolean),
  );

  for (const { path, invariantIds } of INVARIANT_COVERAGE_CASES) {
    const platformInvariantIds = invariantIds.filter((id) => !releaseQualitySourceIds.has(id));

    const run = spawnSync(
      "node",
      [runnerPath, "--stdin0", "--dry-run"],
      {
        input: toNulDelimited([path]),
        encoding: "utf8",
      },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);

    if (platformInvariantIds.length === 0) {
      assert.match(
        run.stdout,
        /gate_skip gate=platform_invariants reason=no_matching_invariants/,
        `${path} should produce no platform_invariants (all covered by release_quality)`,
      );
      continue;
    }

    for (const invariantId of platformInvariantIds) {
      assert.match(run.stdout, new RegExp(`gate_start gate=platform_invariants invariant=${invariantId}`), `${path} missing gate_start for ${invariantId}`);
      assert.match(run.stdout, new RegExp(`gate_pass gate=platform_invariants invariant=${invariantId}`), `${path} missing gate_pass for ${invariantId}`);
    }
    assert.deepEqual(
      extractTelemetryIds(run.stdout, "invariant"),
      [...platformInvariantIds].sort((left, right) => left.localeCompare(right, "en")),
      `${path} runner invariant set mismatch`,
    );
  }
});

test("runner release-quality dry-run executes all families and emits deterministic telemetry", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["scripts/pre-commit-staged-file-classifier.mjs"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);

  for (const familyId of RELEASE_QUALITY_FAMILY_IDS) {
    assert.match(run.stdout, new RegExp(`gate_start gate=release_quality family=${familyId}`));
    assert.match(run.stdout, new RegExp(`gate_pass gate=release_quality family=${familyId}`));
  }

  assert.deepEqual(
    extractTelemetryIds(run.stdout, "family"),
    [...RELEASE_QUALITY_FAMILY_IDS].sort((left, right) => left.localeCompare(right, "en")),
  );
});

test("runGateEntries executes release_quality families sequentially", async () => {
  const started = [];
  const settled = [];
  let active = 0;
  let maxActive = 0;
  const entries = [{ id: "a" }, { id: "b" }, { id: "c" }];

  const result = await runGateEntries(
    entries,
    { gate: "release_quality" },
    { idField: "family", executionMode: "sequential" },
    async (entry) => {
      started.push(entry.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      settled.push(entry.id);
      return { ok: true, exitStatus: 0 };
    },
  );

  assert.deepEqual(started, ["a", "b", "c"]);
  assert.deepEqual(settled, ["a", "b", "c"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(result, { ok: true, exitStatus: 0 });
});

test("runGateEntries caps parallel platform invariants to bounded concurrency", async () => {
  const started = [];
  const settled = [];
  let active = 0;
  let maxActive = 0;
  const entries = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

  const result = await runGateEntries(
    entries,
    { gate: "platform_invariants", maxParallelEntries: 2 },
    { idField: "invariant", executionMode: "parallel" },
    async (entry) => {
      started.push(entry.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      settled.push(entry.id);
      return { ok: true, exitStatus: 0 };
    },
  );

  assert.deepEqual(started, ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...settled].sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(maxActive, 2);
  assert.deepEqual(result, { ok: true, exitStatus: 0 });
});

test("runGateEntries uses the safe default bounded concurrency for platform invariants", async () => {
  const original = process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  let active = 0;
  let maxActive = 0;
  const entries = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  try {
    const result = await runGateEntries(
      entries,
      { gate: "platform_invariants" },
      { idField: "invariant", executionMode: "parallel" },
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true, exitStatus: 0 };
      },
    );

    assert.equal(maxActive, 2);
    assert.deepEqual(result, { ok: true, exitStatus: 0 });
  } finally {
    if (original === undefined) {
      delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
    } else {
      process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY = original;
    }
  }
});

test("runner dry-run emits bounded parallel plan telemetry for platform invariants", () => {
  const original = process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
  try {
    const run = spawnSync(
      "node",
      [runnerPath, "--stdin0", "--dry-run"],
      {
        input: toNulDelimited(["packages/factory-runtime/telemetry/managed-factory-telemetry.mjs"]),
        encoding: "utf8",
      },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /gate_plan gate=platform_invariants entries=1 execution_mode=parallel max_parallel_entries=2 rss_bytes=\d+/);
  } finally {
    if (original === undefined) {
      delete process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY;
    } else {
      process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY = original;
    }
  }
});

test("runGateEntries retries failed release_quality families once before failing closed", async () => {
  const attempts = [];
  let firstAttempt = true;
  let telemetry = "";

  const result = await runGateEntries(
    [{ id: "external_factory_portability_matrix" }],
    {
      gate: "release_quality",
      telemetryPrefix: "pre-push",
      stdout: {
        write(chunk) {
          telemetry += String(chunk);
        },
      },
    },
    { idField: "family", executionMode: "sequential" },
    async (entry) => {
      attempts.push(entry.id);
      if (firstAttempt) {
        firstAttempt = false;
        return { ok: false, exitStatus: 1 };
      }
      return { ok: true, exitStatus: 0 };
    },
  );

  assert.deepEqual(attempts, ["external_factory_portability_matrix", "external_factory_portability_matrix"]);
  assert.match(
    telemetry,
    /gate_retry gate=release_quality family=external_factory_portability_matrix attempt=1/,
  );
  assert.deepEqual(result, { ok: true, exitStatus: 0 });
});

test("runGateEntries fail-closes after exhausting release_quality retries", async () => {
  const attempts = [];

  const result = await runGateEntries(
    [{ id: "recovery_graph_invariants" }],
    {
      gate: "release_quality",
      telemetryPrefix: "pre-push",
      stdout: { write() {} },
    },
    { idField: "family", executionMode: "sequential" },
    async (entry) => {
      attempts.push(entry.id);
      return { ok: false, exitStatus: 1 };
    },
  );

  assert.deepEqual(attempts, ["recovery_graph_invariants", "recovery_graph_invariants"]);
  assert.deepEqual(result, { ok: false, exitStatus: 1 });
});

test("runner release-quality dry-run failure emits first_failure with family id and exits non-zero", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run", "--dry-run-fail", "scaffold_golden_conformance"],
    {
      input: toNulDelimited(["scripts/pre-commit-staged-file-classifier.mjs"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 1);
  assert.match(run.stderr, /gate_failed gate=release_quality family=scaffold_golden_conformance/);
  assert.match(run.stderr, /first_failure phase=quality_gate target=release_quality family=scaffold_golden_conformance/);
});

test("runner release-quality mode emits deterministic gate_skip marker when no family matches", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["context/notes.txt"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_skip gate=release_quality reason=no_matching_families/);
});

test("runner dry-run failure emits first_failure with invariant id and exits non-zero", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run", "--dry-run-fail", "managed-factory-telemetry-contract"],
    {
      input: toNulDelimited(["packages/factory-runtime/telemetry/managed-factory-telemetry.mjs"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 1);
  assert.match(run.stderr, /gate_failed gate=platform_invariants invariant=managed-factory-telemetry-contract/);
  assert.match(run.stderr, /first_failure phase=quality_gate target=platform_invariants invariant=managed-factory-telemetry-contract/);
});

test("runner dry-run executes factory portability invariant for status entrypoints", () => {
  // factory_portability is a release_quality source invariant (external_factory_portability family),
  // so the platform_invariants gate deduplicates it; verify it runs via release_quality instead.
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["packages/factory-ops/src/commands/factory-status.ts"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=release_quality family=external_factory_portability/);
  assert.match(run.stdout, /gate_pass gate=release_quality family=external_factory_portability/);
});

test("runner dry-run executes external_factory_portability_matrix invariant for shared factory paths", () => {
  // external_factory_portability_matrix is a release_quality source invariant,
  // so the platform_invariants gate deduplicates it; verify it runs via release_quality instead.
  const run = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["apps/hatch/src/pipeline/context.ts"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=release_quality family=external_factory_portability_matrix/);
  assert.match(run.stdout, /gate_pass gate=release_quality family=external_factory_portability_matrix/);
});

test("runner dry-run executes external_factory_smoke invariant for smoke script path", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["scripts/check-external-factory-smoke.ts"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=platform_invariants invariant=external_factory_smoke/);
  assert.match(run.stdout, /gate_pass gate=platform_invariants invariant=external_factory_smoke/);
});

test("template config path resolves to scaffold_contract + factory_public_contract invariants", () => {
  const matches = resolvePlatformInvariantMatches([
    "factories/_templates/factory/factory.config.json.template",
  ]);

  assert.deepEqual(matches.map((entry) => entry.id), ["scaffold_contract", "factory_public_contract"]);

  // scaffold_contract is a release_quality source invariant (scaffold_golden_conformance family)
  // and is deduped from platform_invariants; verify factory_public_contract still runs there
  // and scaffold_contract runs via the release_quality gate.
  const platformRun = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["factories/_templates/factory/factory.config.json.template"]),
      encoding: "utf8",
    },
  );

  assert.equal(platformRun.status, 0, platformRun.stderr || platformRun.stdout);
  assert.doesNotMatch(platformRun.stdout, /invariant=scaffold_contract/);
  assert.match(platformRun.stdout, /gate_start gate=platform_invariants invariant=factory_public_contract/);
  assert.match(platformRun.stdout, /gate_pass gate=platform_invariants invariant=factory_public_contract/);

  const releaseQualityRun = spawnSync(
    "node",
    [runnerPath, "--gate", "release_quality", "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["factories/_templates/factory/factory.config.json.template"]),
      encoding: "utf8",
    },
  );

  assert.equal(releaseQualityRun.status, 0, releaseQualityRun.stderr || releaseQualityRun.stdout);
  assert.match(releaseQualityRun.stdout, /gate_start gate=release_quality family=scaffold_golden_conformance/);
  assert.match(releaseQualityRun.stdout, /gate_pass gate=release_quality family=scaffold_golden_conformance/);
});

test("runner emits deterministic gate_skip marker when no invariant matches", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--stdin0", "--dry-run"],
    {
      input: toNulDelimited(["context/notes.txt"]),
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_skip gate=platform_invariants reason=no_matching_invariants/);
});

test("runner supports whole-repo invariant checks via --all-tracked", () => {
  const run = spawnSync(
    "node",
    [runnerPath, "--all-tracked", "--dry-run", "--telemetry-prefix", "pre-merge"],
    {
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[pre-merge\] gate_start gate=platform_invariants invariant=/);
  assert.match(run.stdout, /\[pre-merge\] gate_pass gate=platform_invariants invariant=/);
});

test("runner accepts direct invariant gate id with --files", () => {
  const run = spawnSync(
    "node",
    [
      runnerPath,
      "--gate",
      "managed-factory-telemetry-contract",
      "--files",
      "packages/factory-runtime/example-event.js",
      "--dry-run",
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /gate_start gate=managed-factory-telemetry-contract invariant=managed-factory-telemetry-contract/);
  assert.match(run.stdout, /gate_pass gate=managed-factory-telemetry-contract invariant=managed-factory-telemetry-contract/);
});
