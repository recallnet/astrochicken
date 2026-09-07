import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { provisionFactoryRepo } from "../../src/commands/factory-provision-repo.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const hostCmdSourcePath = join(repoRoot, "packages/factory-ops/src/cli/commands/factory-host-cmds.ts");

function makeFixtureRoot() {
  return mkdtempSync(path.join(tmpdir(), "factory-provision-repo-"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createRegistry(root, { kindId = "brainstorm", targetRepo = "example-org/example-notes" } = {}) {
  const registryPath = path.join(root, "factory-registry.json");
  writeJson(registryPath, {
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        kind_id: kindId,
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

function readFixtureFile(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function resolveRepoFromArgs(args = []) {
  const idx = args.indexOf("--repo");
  if (idx < 0) return "";
  return String(args[idx + 1] || "").trim();
}

function buildLabelListExec() {
  return (args) => {
    const repo = resolveRepoFromArgs(args);
    if (repo !== "example-org/example-notes") return [];
    return [];
  };
}

function createTargetRepoFixture(root, { withManifest = false } = {}) {
  const targetRepoPath = path.join(root, "example-notes");
  mkdirSync(targetRepoPath, { recursive: true });
  mkdirSync(path.join(targetRepoPath, ".github"), { recursive: true });

  if (withManifest) {
    writeJson(path.join(targetRepoPath, ".hatch", "instance.json"), {
      instance_id: "brainstorm",
      kind_id: "brainstorm",
      target_repo: {
        provider: "github",
        full_name: "example-org/example-notes",
      },
      control_plane_repo: "recallnet/astrochicken",
      workspace_mode: "api_only",
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
  }

  return targetRepoPath;
}

test("provisionFactoryRepo provisions missing labels/templates/manifest for registered instance", () => {
  const root = makeFixtureRoot();
  try {
    const targetRepoPath = createTargetRepoFixture(root, { withManifest: true });
    const registryPath = createRegistry(root);

    const ghCalls = [];
    const out = provisionFactoryRepo({
      instanceId: "brainstorm",
      registryPath,
      repoRoot,
      targetRepoPath,
      ghJsonExec: buildLabelListExec(),
      authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
      ghExec: (args) => {
        ghCalls.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
      gitExec: () => ({ status: 1, stdout: "", stderr: "no remote" }),
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "provisioned");
    assert.equal(out.report.changed_total > 0, true);
    assert.equal(out.report.changed_labels, 1);

    const instanceManifestPath = path.join(targetRepoPath, ".hatch", "instance.json");
    const instance = JSON.parse(readFileSync(instanceManifestPath, "utf8"));
    assert.equal(instance.instance_id, "brainstorm");
    assert.equal(instance.kind_id, "brainstorm");
    assert.equal(instance.target_repo.full_name, "example-org/example-notes");

    const templatePath = path.join(targetRepoPath, ".github", "issue_template", "brainstorm-incoming.md");
    assert.equal(readFileSync(templatePath, "utf8"), readFixtureFile("factories/brainstorm/issue_templates/brainstorm-incoming.md"));

    assert.equal(ghCalls.length, 1);
    assert.ok(ghCalls[0].includes("hatch:intake"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provisionFactoryRepo rerun is idempotent", () => {
  const root = makeFixtureRoot();
  try {
    const targetRepoPath = createTargetRepoFixture(root, { withManifest: true });
    const registryPath = createRegistry(root);

    const labels = [];
    const baseArgs = {
      instanceId: "brainstorm",
      registryPath,
      repoRoot,
      targetRepoPath,
      ghJsonExec: (args) => {
        const repo = resolveRepoFromArgs(args);
        if (repo !== "example-org/example-notes") return [];
        return [...labels];
      },
      authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
      ghExec: (args) => {
        const labelIndex = args.indexOf("create") + 1;
        const labelName = String(args[labelIndex] || "").trim();
        if (labelName) {
          labels.push({ name: labelName, description: "Managed factory intake item", color: "1D76DB" });
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      gitExec: () => ({ status: 1, stdout: "", stderr: "no remote" }),
    };

    const first = provisionFactoryRepo(baseArgs);
    assert.equal(first.ok, true);

    const second = provisionFactoryRepo(baseArgs);
    assert.equal(second.ok, true);
    assert.equal(second.status, "already_compliant");
    assert.equal(second.report.changed_total, 0);
    assert.equal(second.report.changed_files, 0);
    assert.equal(second.report.idempotent, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provisionFactoryRepo dry-run reports same diff without mutation", () => {
  const root = makeFixtureRoot();
  try {
    const targetRepoPath = createTargetRepoFixture(root, { withManifest: true });
    const registryPath = createRegistry(root);

    const instanceManifestPath = path.join(targetRepoPath, ".hatch", "instance.json");
    const beforeManifest = readFileSync(instanceManifestPath, "utf8");

    const dryRun = provisionFactoryRepo({
      instanceId: "brainstorm",
      registryPath,
      repoRoot,
      targetRepoPath,
      dryRun: true,
      ghJsonExec: buildLabelListExec(),
      authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
      ghExec: () => ({ status: 0, stdout: "", stderr: "" }),
      gitExec: () => ({ status: 1, stdout: "", stderr: "no remote" }),
    });

    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.status, "dry_run");
    assert.equal(dryRun.report.applied_changes, 0);

    assert.equal(existsSync(instanceManifestPath), true);
    assert.equal(readFileSync(instanceManifestPath, "utf8"), beforeManifest);
    assert.equal(existsSync(path.join(targetRepoPath, ".github", "issue_template", "brainstorm-incoming.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provisionFactoryRepo fails closed when registry row is missing", () => {
  const root = makeFixtureRoot();
  try {
    const targetRepoPath = createTargetRepoFixture(root, { withManifest: true });
    const registryPath = createRegistry(root);

    assert.throws(() => {
      provisionFactoryRepo({
        instanceId: "missing-instance",
        registryPath,
        repoRoot,
        targetRepoPath,
      });
    }, (error) => {
      assert.equal(error?.code, "host_assignment_registry_row_missing");
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provisionFactoryRepo fails closed when kind definition is missing", () => {
  const root = makeFixtureRoot();
  try {
    const targetRepoPath = createTargetRepoFixture(root, { withManifest: true });
    const registryPath = createRegistry(root, { kindId: "missing-kind" });

    assert.throws(() => {
      provisionFactoryRepo({
        instanceId: "brainstorm",
        registryPath,
        repoRoot,
        targetRepoPath,
      });
    }, (error) => {
      assert.equal(error?.code, "host_assignment_registry_missing");
      assert.match(String(error?.message || ""), /kind_definition_missing/);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory CLI wires provision-repo command", () => {
  const source = readFileSync(hostCmdSourcePath, "utf8");
  assert.match(source, /FactoryProvisionRepoCommand/);
  assert.match(source, /static paths = \[\["factory", "provision-repo"\]\]/);
  assert.match(source, /await import\("\.\.\/\.\.\/commands\/factory-provision-repo\.mjs"\)/);

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
  assert.match(output, /factory provision-repo/);
});
