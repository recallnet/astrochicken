import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { factoryProvisioningDrift } from "../../src/commands/factory-provisioning-drift.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const hostCmdSourcePath = join(repoRoot, "packages/factory-ops/src/cli/commands/factory-host-cmds.ts");

function makeFixtureRoot() {
  return mkdtempSync(path.join(tmpdir(), "factory-provisioning-drift-"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function makeRegistry(root, { targetRepo = "example/example-notes" } = {}) {
  const registryPath = path.join(root, "factory-registry.json");
  writeJson(registryPath, {
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        kind_id: "brainstorm",
        target_repo: targetRepo,
        status: "active",
        assigned_host_id: "unassigned",
        service_tier: "standard",
        scheduler_weight: 1,
        reserved_capacity: 0,
        upgrade_channel: "stable",
        allowed_runtime_version: "*",
        support_owner: "ops",
        feature_flags: {},
      },
    ],
  });
  return registryPath;
}

function makeTargetRepoFixture(root, { targetRepo = "example/example-notes" } = {}) {
  const targetRepoPath = path.join(root, "example-notes");
  mkdirSync(path.join(targetRepoPath, ".github"), { recursive: true });
  mkdirSync(path.join(targetRepoPath, ".hatch"), { recursive: true });
  writeJson(path.join(targetRepoPath, ".hatch", "instance.json"), {
    instance_id: "brainstorm",
    kind_id: "brainstorm",
    workspace_mode: "api_only",
    target_repo: {
      provider: "github",
      repo_id: "R_kgDOExample",
      full_name: targetRepo,
    },
    control_plane_repo: "recallnet/astrochicken",
    intake: {
      issue_selector: {
        labels: ["hatch:intake"],
      },
    },
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "kind:brainstorm"],
      },
    },
  });
  return targetRepoPath;
}

function makeFixtures(root) {
  const registryPath = makeRegistry(root);
  const targetRepoPath = makeTargetRepoFixture(root);

  const templateContent = readFileSync(
    join(repoRoot, "factories", "brainstorm", "issue_templates", "brainstorm-incoming.md"),
    "utf8",
  );
  mkdirSync(path.join(targetRepoPath, ".github", "issue_template"), { recursive: true });
  writeFileSync(path.join(targetRepoPath, ".github", "issue_template", "brainstorm-incoming.md"), templateContent, "utf8");

  const labelsPath = path.join(root, "labels.json");
  writeJson(labelsPath, {
    "example/example-notes": [
      {
        name: "hatch:intake",
        description: "Managed factory intake item",
        color: "1D76DB",
      },
    ],
  });

  const targetRepoMapPath = path.join(root, "target-repos.json");
  writeJson(targetRepoMapPath, { brainstorm: targetRepoPath });

  return {
    registryPath,
    targetRepoPath,
    labelsPath,
    targetRepoMapPath,
  };
}

test("factoryProvisioningDrift returns compliant report for instance", () => {
  const root = makeFixtureRoot();
  try {
    const fixtures = makeFixtures(root);

    const out = factoryProvisioningDrift({
      instanceId: "brainstorm",
      registryPath: fixtures.registryPath,
      repoRoot,
      targetRepoMapJsonPath: resolve(fixtures.targetRepoMapPath),
      labelsJsonPath: resolve(fixtures.labelsPath),
      cwd: root,
    });

    assert.equal(out.ok, true);
    assert.equal(out.checked_count, 1);
    assert.equal(out.drifted_count, 0);
    assert.equal(out.entries[0].drifted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factoryProvisioningDrift reports drift and exits non-zero through CLI", () => {
  const root = makeFixtureRoot();
  try {
    const fixtures = makeFixtures(root);

    const labels = readJson(fixtures.labelsPath);
    labels["example/example-notes"] = [];
    writeJson(fixtures.labelsPath, labels);

    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "provisioning-drift",
      "--instance-id",
      "brainstorm",
      "--registry-path",
      fixtures.registryPath,
      "--repo-root",
      repoRoot,
      "--target-repo-map-json",
      resolve(fixtures.targetRepoMapPath),
      "--labels-json-path",
      resolve(fixtures.labelsPath),
      "--json",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 1, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, false);
    assert.equal(payload.drifted_count, 1);
    assert.deepEqual(payload.entries[0].missing_labels, ["hatch:intake"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory CLI wires provisioning-drift command", () => {
  const source = readFileSync(hostCmdSourcePath, "utf8");
  assert.match(source, /FactoryProvisioningDriftCommand/);
  assert.match(source, /static paths = \[\["factory", "provisioning-drift"\]\]/);
  assert.match(source, /await import\("\.\.\/\.\.\/commands\/factory-provisioning-drift\.ts"\)/);

  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "--help",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG || "en_US.UTF-8",
      PATH: process.env.PATH,
      PWD: repoRoot,
      TERM: process.env.TERM || "xterm",
      FACTORY_CONTEXT_REPO_PATH: repoRoot,
    },
  });

  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.match(output, /factory provisioning-drift/);
});
