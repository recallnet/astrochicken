import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatFactoryTargetRepoValidationSummary,
  validateFactoryTargetRepo,
} from "../../src/commands/factory-target-repo-validate.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeFixtureRoot() {
  return mkdtempSync(path.join(tmpdir(), "factory-target-repo-validate-"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}

function createCompliantFixture() {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  const sourceTemplatesDir = path.join(root, "factory", "issue_templates");

  mkdirSync(targetRepoPath, { recursive: true });

  const templateBody = "---\nname: Brainstorm intake\n---\n";
  writeText(path.join(sourceTemplatesDir, "brainstorm-incoming.md"), templateBody);
  writeText(path.join(targetRepoPath, ".github", "ISSUE_TEMPLATE", "brainstorm-incoming.md"), templateBody);

  writeJson(path.join(targetRepoPath, ".hatch", "instance.json"), {
    instance_id: "fac_EXAMPLE_ORG_EXAMPLE_NOTES_BRAINSTORM",
    kind_id: "brainstorm",
    workspace_mode: "api_only",
    target_repo: {
      provider: "github",
      full_name: "example-org/example-notes",
    },
    control_plane_repo: "recallnet/astrochicken",
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

  return {
    root,
    targetRepoPath,
    sourceTemplatesDir,
  };
}

function resolveRepoFromArgs(args = []) {
  const index = args.indexOf("--repo");
  if (index < 0) return "";
  return String(args[index + 1] || "").trim();
}

function buildCompliantLabelExec() {
  return (args) => {
    const repo = resolveRepoFromArgs(args);
    if (repo === "example-org/example-notes") {
      return [
        { name: "hatch:intake", description: "Managed factory intake item", color: "1D76DB" },
        { name: "hatch:queued", description: "Managed factory work queued for planning", color: "5319E7" },
        { name: "hatch:in-progress", description: "Managed factory work in progress", color: "FBCA04" },
        { name: "hatch:blocked", description: "Managed factory work blocked on dependency or policy", color: "D93F0B" },
        { name: "hatch:done", description: "Managed factory work completed", color: "0E8A16" },
      ];
    }

    if (repo === "recallnet/astrochicken") {
      return [
        { name: "managed-factory-bug", description: "Factory label: managed-factory-bug", color: "5319e7" },
        { name: "kind:example-notes", description: "Managed factory kind label: example-notes", color: "5319E7" },
      ];
    }

    return [];
  };
}

test("validateFactoryTargetRepo passes on compliant target repo and is rerunnable", () => {
  const fixture = createCompliantFixture();
  try {
    const instancePath = path.join(fixture.targetRepoPath, ".hatch", "instance.json");
    const before = readFileSync(instancePath, "utf8");

    const first = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: buildCompliantLabelExec(),
    });

    assert.equal(first.ok, true);
    assert.equal(first.summary.failed, 0);

    const second = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: buildCompliantLabelExec(),
    });

    const after = readFileSync(instancePath, "utf8");
    assert.equal(second.ok, true);
    assert.equal(after, before, "validator must not mutate repo state");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("validateFactoryTargetRepo fails when workspace_mode contract drifts", () => {
  const fixture = createCompliantFixture();
  try {
    writeJson(path.join(fixture.targetRepoPath, ".hatch", "instance.json"), {
      instance_id: "fac_EXAMPLE_ORG_EXAMPLE_NOTES_BRAINSTORM",
      kind_id: "brainstorm",
      workspace_mode: "worktree",
      target_repo: { provider: "github", full_name: "example-org/example-notes" },
      destinations: {
        goal_issues: { repo: "recallnet/astrochicken", labels: ["goal", "source:brainstorm"] },
        platform_incidents: { repo: "recallnet/astrochicken", labels: ["managed-factory-bug", "kind:brainstorm"] },
      },
    });

    const out = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: buildCompliantLabelExec(),
    });

    assert.equal(out.ok, false);
    const instanceCheck = out.checks.find((entry) => entry.id === "instance_contract");
    assert.ok(instanceCheck);
    assert.match(instanceCheck.details.violations.join(","), /workspace_mode_mismatch/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("validateFactoryTargetRepo fails when destination route is missing", () => {
  const fixture = createCompliantFixture();
  try {
    writeJson(path.join(fixture.targetRepoPath, ".hatch", "instance.json"), {
      instance_id: "fac_EXAMPLE_ORG_EXAMPLE_NOTES_BRAINSTORM",
      kind_id: "brainstorm",
      workspace_mode: "api_only",
      target_repo: { provider: "github", full_name: "example-org/example-notes" },
      destinations: {
        goal_issues: { repo: "recallnet/astrochicken", labels: ["goal", "source:brainstorm"] },
      },
    });

    const out = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: buildCompliantLabelExec(),
    });

    assert.equal(out.ok, false);
    const destinationCheck = out.checks.find((entry) => entry.id === "destination_contract");
    assert.ok(destinationCheck);
    assert.match(destinationCheck.details.violations.join(","), /missing_destination_route:platform_incidents/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("validateFactoryTargetRepo fails when issue template is missing", () => {
  const fixture = createCompliantFixture();
  try {
    rmSync(path.join(fixture.targetRepoPath, ".github", "ISSUE_TEMPLATE", "brainstorm-incoming.md"), { force: true });

    const out = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: buildCompliantLabelExec(),
    });

    assert.equal(out.ok, false);
    const templateCheck = out.checks.find((entry) => entry.id === "issue_templates_contract");
    assert.ok(templateCheck);
    assert.deepEqual(templateCheck.details.missing_templates, ["brainstorm-incoming.md"]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("validateFactoryTargetRepo fails when managed label contract is missing labels", () => {
  const fixture = createCompliantFixture();
  try {
    const out = validateFactoryTargetRepo({
      targetRepo: fixture.targetRepoPath,
      repoRoot: fixture.root,
      issueTemplatesDir: path.relative(fixture.root, fixture.sourceTemplatesDir),
      ghJsonExec: (args) => {
        const repo = resolveRepoFromArgs(args);
        if (repo === "example-org/example-notes") {
          return [
            { name: "hatch:intake", description: "Managed factory intake item", color: "1D76DB" },
          ];
        }
        return [
          { name: "managed-factory-bug", description: "Factory label: managed-factory-bug", color: "5319e7" },
          { name: "kind:example-notes", description: "Managed factory kind label: example-notes", color: "5319E7" },
        ];
      },
    });

    assert.equal(out.ok, false);
    const labelsCheck = out.checks.find((entry) => entry.id === "labels_contract");
    assert.ok(labelsCheck);
    assert.match((labelsCheck.details.home.missing || []).join(","), /hatch:queued/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("factory target-repo validate summary formatter emits drift details", () => {
  const summary = formatFactoryTargetRepoValidationSummary({
    ok: false,
    target_repo_path: "/tmp/example-notes",
    instance_path: "/tmp/example-notes/.hatch/instance.json",
    summary: { passed: 1, failed: 1, total: 2 },
    checks: [
      { id: "instance_contract", ok: false, message: "instance contract drift detected", details: { violations: ["workspace_mode_mismatch"] } },
    ],
  });

  assert.match(summary, /factory target-repo validation: fail/);
  assert.match(summary, /workspace_mode_mismatch/);
});

test("factory CLI wires target-repo validate command", () => {
  const source = readFileSync(path.join(repoRoot, "packages/factory-ops/src/cli/commands/factory-host-cmds.ts"), "utf8");
  assert.match(source, /FactoryTargetRepoValidateCommand/);
  assert.match(source, /static paths = \[\["factory", "target-repo", "validate"\]\]/);
  assert.match(source, /await import\("\.\.\/\.\.\/commands\/factory-target-repo-validate\.mjs"\)/);

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
  assert.match(output, /factory target-repo validate/);
});
