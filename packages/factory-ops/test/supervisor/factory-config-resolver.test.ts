import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveGhRepo } from "../../src/commands/common-resolve-gh-repo.ts";
import {
  loadFactoryConfig,
  resolveControlPlaneRepo,
  resolveTargetRepo,
} from "../../src/commands/factory-config-loader.ts";
import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";
import { resolveFactoryContext } from "../../src/lib/factory-context-resolver.ts";
import { buildFactoryRepoRoleContextFromFactory } from "../../src/lib/factory-repo-roles.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function writeFactoryConfig(rootDir, config) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(join(rootDir, "factory.config.json"), JSON.stringify(config, null, 2));
}

function withCleanResolverEnv(callback) {
  const keys = [
    "HATCH_FACTORY_ROOT",
    "FACTORY_ROOT",
    "HATCH_FACTORY_CONFIG_PATH",
    "FACTORY_CONFIG_PATH",
    "HATCH_FACTORY_ID",
    "FACTORY_ID",
    "HATCH_TARGET_REPO",
    "HOME_REPO",
    "HATCH_TARGET_REPO",
    "TARGET_REPO",
    "HATCH_GH_REPO",
    "GH_REPO",
    "MOTHERSHIP_REPO",
    "HATCH_CONTROL_PLANE_REPO",
    "CONTROL_PLANE_REPO",
    "HATCH_KIND_ID",
    "KIND_ID",
    "HATCH_INSTANCE_ID",
    "INSTANCE_ID",
    "HATCH_DESTINATIONS_JSON",
    "DESTINATIONS_JSON",
    "HATCH_RUNS_DIR",
    "RUNS_DIR",
    "HATCH_SCENARIOS_ROOT",
    "SCENARIOS_ROOT",
    "HATCH_FACTORY_GITHUB_TOKEN",
    "FACTORY_GITHUB_TOKEN",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function captureErrorMessage(fn) {
  try {
    fn();
    return "";
  } catch (error) {
    return String(error?.message || error);
  }
}

const BASE_CONFIG = {
  factory_id: "factory-a",
  target_repo: "acme/target",
  control_plane_repo: "acme/control",
  tracking_issue: 77,
  model: "openai/gpt-5.3-codex",
  provider: "openrouter",
  scenarios: {
    root: "factories/factory-a/scenarios/factory-a",
  },
};

test("resolveGhRepo prefers explicit --repo over factory config target_repo", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-"));
  writeFactoryConfig(root, BASE_CONFIG);

  const out = resolveGhRepo("owner/explicit", { factoryRoot: root });
  assert.equal(out, "owner/explicit");
});

test("resolveGhRepo falls back to factory config target_repo for legacy mothership", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-"));
  writeFactoryConfig(root, {
    ...BASE_CONFIG,
    factory_id: "mothership",
    control_plane_repo: "acme/control",
  });

  const keys = ["HATCH_TARGET_REPO", "HOME_REPO", "HATCH_TARGET_REPO", "TARGET_REPO", "HATCH_GH_REPO", "GH_REPO", "MOTHERSHIP_REPO"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const out = resolveGhRepo("", { factoryRoot: root });
    assert.equal(out, "acme/target");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("resolveGhRepo honors HATCH_TARGET_REPO env override over factory config", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-env-home-"));
  writeFactoryConfig(root, {
    ...BASE_CONFIG,
    target_repo: "acme/config-home",
  });

  withCleanResolverEnv(() => {
    process.env.HATCH_TARGET_REPO = "dtb/my-research";
    const out = resolveGhRepo("", { factoryRoot: root });
    assert.equal(out, "dtb/my-research");
  });
});

test("resolveGhRepo prefers HATCH_TARGET_REPO over GH_REPO when both are set", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-env-shadow-"));
  writeFactoryConfig(root, {
    ...BASE_CONFIG,
    target_repo: "acme/config-home",
  });

  withCleanResolverEnv(() => {
    process.env.HATCH_TARGET_REPO = "dtb/my-research";
    process.env.GH_REPO = "recallnet/astrochicken";
    const out = resolveGhRepo("", { factoryRoot: root });
    assert.equal(out, "dtb/my-research");
  });
});

test("resolveTargetRepo resolves target_repo for any factory", () => {
  assert.equal(
    resolveTargetRepo({
      factory_id: "brainstorm",
      target_repo: "acme/target",
      control_plane_repo: "acme/control",
    }),
    "acme/target",
  );
});

test("resolveGhRepo throws deterministic resolver error when explicit factory root is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-missing-"));

  // Pass an empty env to prevent ambient process env repo vars (e.g. FACTORY_REPO,
  // HATCH_GH_REPO) from short-circuiting the factory-root config lookup.
  try {
    assert.throws(
      () => resolveGhRepo("", { factoryRoot: join(root, "does-not-exist"), env: {} }),
      /\[factory-context\] unable to load factory\.config\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("kind -> instance -> installation chain resolves managed target_repo for ops identity", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-managed-chain-"));

  const kindRoot = join(root, "factories", "brainstorm");
  mkdirSync(kindRoot, { recursive: true });
  writeFileSync(join(kindRoot, "kind.json"), JSON.stringify({
    kind_id: "brainstorm",
    schema_version: 1,
    managed: true,
    execution_mode: "issues_only",
    shared_supervisor_shell: "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
    domain_graph: "docs/contracts/workflow-ir/brainstorm/domain_brainstorm.dot",
    supported_destinations: ["goal_issues"],
    required_labels: ["hatch:intake"],
  }, null, 2));

  const instanceRoot = join(root, ".hatch");
  mkdirSync(instanceRoot, { recursive: true });
  writeFileSync(join(instanceRoot, "instance.json"), JSON.stringify({
    instance_id: "fac_01JQ7M8JABC",
    kind_id: "brainstorm",
    target_repo: {
      provider: "github",
      repo_id: "R_kgDOExample",
      full_name: "example-org/brainstorm-lab",
    },
    control_plane_repo: "recallnet/astrochicken",
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
    },
  }, null, 2));

  const installationRoot = join(root, ".hatch-hosts", "installations", "fac_01JQ7M8JABC");
  mkdirSync(installationRoot, { recursive: true });
  writeFileSync(join(installationRoot, "installation.json"), JSON.stringify({
    installation_id: "inst_01JQ7ME8XYZ",
    instance_id: "fac_01JQ7M8JABC",
    host_id: "host_devrel_mac_01",
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: join(installationRoot, "logs"),
  }, null, 2));

  const kind = JSON.parse(readFileSync(join(kindRoot, "kind.json"), "utf8"));
  const instance = JSON.parse(readFileSync(join(instanceRoot, "instance.json"), "utf8"));
  const installation = JSON.parse(readFileSync(join(installationRoot, "installation.json"), "utf8"));

  assert.equal(kind.kind_id, instance.kind_id);
  assert.equal(instance.instance_id, installation.instance_id);
  assert.equal(instance.target_repo.full_name, "example-org/brainstorm-lab");
  assert.equal(installation.workspace_mode, "api_only");
  assert.equal(installation.work_dir, null);
});

test("resolveFactoryContext legacy config without target_repo fails closed", () => {
  withCleanResolverEnv(() => {
    const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-legacy-"));
    writeFactoryConfig(root, {
      factory_id: "factory-a",
      repo: "acme/legacy",
      control_plane: "acme/control-legacy",
      tracking_issue: 77,
      model: "openai/gpt-5.3-codex",
      provider: "openrouter",
      scenarios: { root: "scenarios/factory-a" },
      runs_dir: ".hatch/factory-a/runs",
    });

    const message = captureErrorMessage(() => resolveFactoryContext({ factoryRoot: root, requireTargetRepo: true }));
    assert.match(message, /(missing required keys: target_repo, control_plane_repo|unable to resolve target_repo)/);
  });
});

test("loadFactoryConfig throws when target_repo/control_plane_repo are missing", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-invalid-"));
  writeFactoryConfig(root, {
    factory_id: "factory-a",
    tracking_issue: 77,
    model: "openai/gpt-5.3-codex",
    provider: "openrouter",
  });

  assert.throws(
    () => loadFactoryConfig({ factoryRoot: root, requiredKeys: ["target_repo", "control_plane_repo"] }),
    /missing required keys: target_repo, control_plane_repo/,
  );
});

test("resolveControlPlaneRepo returns canonical control_plane_repo", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-config-resolver-fallback-"));
  writeFactoryConfig(root, BASE_CONFIG);

  const loaded = loadFactoryConfig({ factoryRoot: root });
  assert.equal(resolveControlPlaneRepo(loaded.config), "acme/control");
});

test("shipped acme-support example resolves non-mothership target + mothership control plane", () => {
  const loaded = loadFactoryConfig({
    configPath: "examples/external-factories/acme-support/factory.config.json",
    requiredKeys: ["factory_id", "target_repo", "control_plane_repo"],
  });

  assert.equal(loaded.config.factory_id, "acme-support");
  assert.equal(loaded.config.target_repo, "acme/support-factory");
  assert.equal(resolveControlPlaneRepo(loaded.config), "recallnet/astrochicken");
  assert.notEqual(loaded.config.target_repo, resolveControlPlaneRepo(loaded.config));
});

test("shipped example-trading factory resolves managed target/control-plane/runs/work_dir", () => {
  const loaded = loadFactoryConfig({
    configPath: "factories/example-trading/factory.config.json",
    requiredKeys: ["factory_id", "target_repo", "control_plane_repo", "runs_dir"],
  });

  assert.equal(loaded.config.factory_id, "example-trading");
  assert.equal(loaded.config.target_repo, "example-org/example-trading");
  assert.equal(resolveControlPlaneRepo(loaded.config), "recallnet/astrochicken");
  assert.equal(loaded.config.runs_dir, ".hatch/example-trading/runs");
  assert.equal(loaded.config.work_dir, "/path/to/example-trading");
});

test("resolveFactoryContext resolves example-trading context from shipped config", () => {
  withCleanResolverEnv(() => {
    const context = resolveFactoryContext({
      cwd: repoRoot,
      factoryConfigPath: "factories/example-trading/factory.config.json",
    });

    assert.equal(context.factory_id, "example-trading");
    assert.equal(context.target_repo, "example-org/example-trading");
    assert.equal(context.control_plane_repo, "recallnet/astrochicken");
    assert.match(context.runs_dir, /\.hatch\/example-trading\/runs$/);
  });
});

test("resolveFactoryContext resolves brainstorm context from shipped config", () => {
  withCleanResolverEnv(() => {
    const context = resolveFactoryContext({
      cwd: repoRoot,
      factoryConfigPath: "factories/brainstorm/factory.config.json",
    });

    assert.equal(context.factory_id, "brainstorm");
    assert.equal(context.target_repo, "example-org/example-notes");
    assert.equal(context.control_plane_repo, "recallnet/astrochicken");
    assert.match(context.runs_dir, /\.hatch\/brainstorm\/runs$/);
  });
});

test("buildFactoryRepoRoleContextFromFactory resolves target_repo and control_plane_repo", () => {
  const roleContext = buildFactoryRepoRoleContextFromFactory({
    context: {
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
    config: {
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
  });

  assert.equal(roleContext.targetRepo, "recallnet/astrochicken");
  assert.equal(roleContext.controlPlaneRepo, "recallnet/astrochicken");
  assert.deepEqual(roleContext.destinationRepos, []);
});

test("common resolve-factory-config reads example-trading work_dir from active factory context", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "common",
    "resolve-factory-config",
    "--factory-id",
    "example-trading",
    "--factory-root",
    "factories/example-trading",
    "--key",
    "work_dir",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal((run.stdout || "").trim(), "/path/to/example-trading");
});

test("resolveFactoryContext keeps config directory authoritative for factory_root (no doubled path)", () => {
  const tempRepoRoot = mkdtempSync(join(tmpdir(), "factory-context-root-"));
  const factoryRoot = join(tempRepoRoot, "factories", "mothership");
  writeFactoryConfig(factoryRoot, {
    ...BASE_CONFIG,
    factory_root: "factories/mothership",
  });

  withCleanResolverEnv(() => {
    const context = resolveFactoryContext({
      cwd: tempRepoRoot,
      factoryConfigPath: join(factoryRoot, "factory.config.json"),
    });

    assert.equal(context.factory_root, factoryRoot);
  });
});

test("resolveFactoryContext fails closed when isolation auth repo mismatches resolved target", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-context-isolation-repo-"));
  const factoryRoot = join(repoRoot, "factories", "factory-a");
  writeFactoryConfig(factoryRoot, {
    ...BASE_CONFIG,
    factory_root: "factories/factory-a",
    runs_dir: ".hatch/factory-a/runs",
    isolation: {
      auth: {
        github: {
          tokenEnvVar: "FACTORY_GITHUB_TOKEN",
          repo: "acme/other-repo",
          factoryId: "factory-a",
        },
      },
      paths: {
        runs: ".factory-runtime/factory-a/runs",
      },
    },
  });

  withCleanResolverEnv(() => {
    process.env.FACTORY_GITHUB_TOKEN = "ghp_test";
    const message = captureErrorMessage(
      () => resolveFactoryContext({ cwd: repoRoot, factoryConfigPath: join(factoryRoot, "factory.config.json") }),
    );
    assert.match(message, /expected isolation\.auth\.github\.repo=acme\/other-repo but resolved factory target=acme\/target/);
    assert.match(message, /Update factory\.config\.json isolation\.auth\.github\.repo or resolve the correct factory context\./);
  });
});

test("resolveFactoryContext fails closed when isolation factoryId mismatches requested factory", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-context-isolation-id-"));
  const factoryRoot = join(repoRoot, "factories", "factory-a");
  writeFactoryConfig(factoryRoot, {
    ...BASE_CONFIG,
    factory_root: "factories/factory-a",
    runs_dir: ".hatch/factory-a/runs",
    isolation: {
      auth: {
        github: {
          tokenEnvVar: "FACTORY_GITHUB_TOKEN",
          repo: "acme/target",
          factoryId: "factory-b",
        },
      },
    },
  });

  withCleanResolverEnv(() => {
    process.env.FACTORY_GITHUB_TOKEN = "ghp_test";
    const message = captureErrorMessage(
      () => resolveFactoryContext({ cwd: repoRoot, factoryConfigPath: join(factoryRoot, "factory.config.json") }),
    );
    assert.match(message, /expected isolation\.auth\.github\.factoryId=factory-b but resolved factory_id=factory-a/);
    assert.match(message, /Use the matching --factory-id\/--factory-root or update isolation\.auth\.github\.factoryId\./);
  });
});

test("resolveFactoryContext fails early when required isolation token env var is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-context-isolation-token-"));
  const factoryRoot = join(repoRoot, "factories", "factory-a");
  writeFactoryConfig(factoryRoot, {
    ...BASE_CONFIG,
    factory_root: "factories/factory-a",
    runs_dir: ".hatch/factory-a/runs",
    isolation: {
      auth: {
        github: {
          tokenEnvVar: "FACTORY_GITHUB_TOKEN",
          repo: "acme/target",
          factoryId: "factory-a",
        },
      },
    },
  });

  withCleanResolverEnv(() => {
    const message = captureErrorMessage(
      () => resolveFactoryContext({ cwd: repoRoot, factoryConfigPath: join(factoryRoot, "factory.config.json") }),
    );
    assert.match(message, /missing required env var for isolation\.auth\.github\.tokenEnvVar=FACTORY_GITHUB_TOKEN/);
    assert.match(message, /Export FACTORY_GITHUB_TOKEN for factory factory-a before running hatch-ops\./);
  });
});

test("resolveFactoryContext uses isolation paths.runs when declared", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-context-isolation-runs-"));
  const factoryRoot = join(repoRoot, "factories", "factory-a");
  writeFactoryConfig(factoryRoot, {
    ...BASE_CONFIG,
    factory_root: "factories/factory-a",
    runs_dir: ".hatch/factory-a/runs",
    isolation: {
      auth: {
        github: {
          tokenEnvVar: "FACTORY_GITHUB_TOKEN",
          repo: "acme/target",
          factoryId: "factory-a",
        },
      },
      paths: {
        runs: ".factory-runtime/factory-a/runs",
      },
    },
  });

  withCleanResolverEnv(() => {
    process.env.FACTORY_GITHUB_TOKEN = "ghp_test";
    const context = resolveFactoryContext({ cwd: repoRoot, factoryConfigPath: join(factoryRoot, "factory.config.json") });
    assert.equal(context.runs_dir, join(repoRoot, ".factory-runtime", "factory-a", "runs"));
  });
});

test("buildStateSnapshot treats repo===config.target_repo as remote when control plane differs", () => {
  const snapshot = JSON.parse(buildStateSnapshot({
    repo: "acme/target",
    controlPlaneRepo: "acme/control",
    factoryConfig: {
      ...BASE_CONFIG,
      control_plane_repo: "acme/control",
    },
    ghJsonFn: () => [],
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => ([
      {
        run_id: "run-remote",
        pipeline: "factories/factory-a/graphs/factory_supervisor_tick.dot",
        node: "execute_issue",
        crash_type: "module_not_found",
        file_path: "/tmp/missing.mjs",
        error_excerpt: "ERR_MODULE_NOT_FOUND",
      },
    ]),
  }));

  const incident = (snapshot.action_items || []).find(
    (item) => String(item?.remediation_packet?.packet_type || "") === "remote_cli_runtime_crash",
  );
  assert.ok(incident);
  assert.equal(String(incident?.ownership_decision || ""), "control_plane");
  assert.equal(String(incident?.remediation_packet?.packet_type || ""), "remote_cli_runtime_crash");
});

test("buildStateSnapshot treats target_repo===control_plane_repo as local even when repo differs", () => {
  const snapshot = JSON.parse(buildStateSnapshot({
    repo: "acme/control",
    targetRepo: "acme/target",
    controlPlaneRepo: "acme/target",
    factoryConfig: {
      ...BASE_CONFIG,
      control_plane_repo: "acme/target",
    },
    ghJsonFn: () => [],
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => ([
      {
        run_id: "run-local",
        pipeline: "factories/factory-a/graphs/factory_supervisor_tick.dot",
        node: "execute_issue",
        crash_type: "module_not_found",
        file_path: "/tmp/missing.mjs",
        error_excerpt: "ERR_MODULE_NOT_FOUND",
      },
    ]),
  }));

  const incident = (snapshot.action_items || []).find((item) => String(item.problem || "").startsWith("CLI_RUNTIME_CRASH:"));
  assert.ok(incident);
  assert.equal(String(incident?.diagnostics?.remediation_policy || ""), "LOCAL_FACTORY_IMMEDIATE_FIX");
  assert.equal(String(incident?.remediation_packet?.packet_type || ""), "local_cli_runtime_crash");
});
