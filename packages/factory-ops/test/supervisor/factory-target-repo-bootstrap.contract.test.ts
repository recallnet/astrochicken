import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bootstrapFactoryTargetRepo } from "../../src/commands/factory-target-repo-bootstrap.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const bootstrapCommandPath = path.join(repoRoot, "packages/factory-ops/src/commands/factory-target-repo-bootstrap.ts");
const opsCliPath = path.join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeFixtureRoot() {
  return mkdtempSync(path.join(tmpdir(), "factory-target-repo-bootstrap-"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}

test("factory target-repo bootstrap writes deterministic instance manifest and issue templates", () => {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  const templatePath = path.join(root, "factory", "instance.template.json");
  const issueTemplatesDir = path.join(root, "factory", "issue_templates");

  mkdirSync(targetRepoPath, { recursive: true });
  writeJson(templatePath, {
    kind_id: "brainstorm",
    intake: {
      issue_selector: {
        labels: ["brainstorm"],
      },
    },
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
    },
  });
  writeText(path.join(issueTemplatesDir, "brainstorm-incoming.md"), "---\nlabels:\n  - hatch:intake\n---\n");

  const labelCalls = [];
  const out = bootstrapFactoryTargetRepo({
    targetRepo: targetRepoPath,
    templatePath,
    issueTemplatesDir,
    resolveTargetRepoNameFn: () => "example-org/example-notes",
    authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
    ghExec: (args) => {
      labelCalls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.target_repo_full_name, "example-org/example-notes");
  assert.equal(out.workspace_mode, "api_only");
  assert.equal(out.kind_id, "brainstorm");
  assert.equal(out.instance_id, "fac_EXAMPLE_ORG_EXAMPLE_NOTES_BRAINSTORM");
  assert.equal(out.idempotent, false);

  const writtenInstance = JSON.parse(readFileSync(path.join(targetRepoPath, ".hatch", "instance.json"), "utf8"));
  assert.equal(writtenInstance.kind_id, "brainstorm");
  assert.equal(writtenInstance.instance_id, "fac_EXAMPLE_ORG_EXAMPLE_NOTES_BRAINSTORM");
  assert.equal(writtenInstance.workspace_mode, "api_only");
  assert.equal(writtenInstance.target_repo.full_name, "example-org/example-notes");
  assert.equal(writtenInstance.control_plane_repo, "recallnet/astrochicken");
  assert.deepEqual(writtenInstance.intake.issue_selector.labels, ["hatch:intake"]);
  assert.deepEqual(writtenInstance.destinations.goal_issues.labels, ["goal", "source:brainstorm"]);

  const templateCopy = readFileSync(path.join(targetRepoPath, ".github", "ISSUE_TEMPLATE", "brainstorm-incoming.md"), "utf8");
  assert.match(templateCopy, /hatch:intake/);

  assert.equal(labelCalls.length, 3);
  assert.ok(labelCalls.some((args) => args.includes("goal")));
  assert.ok(labelCalls.some((args) => args.includes("source:brainstorm")));
  assert.ok(labelCalls.some((args) => args.includes("hatch:intake")));
});

test("factory target-repo bootstrap dry-run does not write files", () => {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  const templatePath = path.join(root, "factory", "instance.template.json");
  const issueTemplatesDir = path.join(root, "factory", "issue_templates");

  mkdirSync(targetRepoPath, { recursive: true });
  writeJson(templatePath, {
    kind_id: "brainstorm",
    intake: { issue_selector: { labels: ["brainstorm"] } },
    destinations: { goal_issues: { labels: ["goal", "source:brainstorm"] } },
  });
  writeText(path.join(issueTemplatesDir, "brainstorm-incoming.md"), "seed template\n");

  const out = bootstrapFactoryTargetRepo({
    targetRepo: targetRepoPath,
    templatePath,
    issueTemplatesDir,
    dryRun: true,
    resolveTargetRepoNameFn: () => "example-org/example-notes",
    authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.dry_run, true);
  assert.equal(out.applied_changes, 0);
  assert.equal(out.idempotent, false);
  assert.equal(existsSync(path.join(targetRepoPath, ".hatch", "instance.json")), false);
  assert.equal(existsSync(path.join(targetRepoPath, ".github", "ISSUE_TEMPLATE", "brainstorm-incoming.md")), false);
  assert.equal(out.label_operations.length, 3);
  assert.ok(out.label_operations.every((entry) => entry.planned === true));
});

test("factory target-repo bootstrap rerun is idempotent", () => {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  const templatePath = path.join(root, "factory", "instance.template.json");
  const issueTemplatesDir = path.join(root, "factory", "issue_templates");

  mkdirSync(targetRepoPath, { recursive: true });
  writeJson(templatePath, {
    kind_id: "brainstorm",
    intake: {
      issue_selector: {
        labels: ["brainstorm"],
      },
    },
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
    },
  });
  writeText(path.join(issueTemplatesDir, "brainstorm-incoming.md"), "template-v1\n");

  const authCheck = () => ({ status: 0, stdout: "", stderr: "" });

  const first = bootstrapFactoryTargetRepo({
    targetRepo: targetRepoPath,
    templatePath,
    issueTemplatesDir,
    resolveTargetRepoNameFn: () => "example-org/example-notes",
    authCheck,
    ghExec: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert.equal(first.ok, true);
  assert.equal(first.changed_files > 0, true);

  const second = bootstrapFactoryTargetRepo({
    targetRepo: targetRepoPath,
    templatePath,
    issueTemplatesDir,
    resolveTargetRepoNameFn: () => "example-org/example-notes",
    authCheck,
    ghExec: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(second.ok, true);
  assert.equal(second.changed_files, 0);
  assert.equal(second.applied_changes, 0);
  assert.equal(second.idempotent, true);
});

test("factory target-repo bootstrap fails closed when template path is missing", () => {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  mkdirSync(targetRepoPath, { recursive: true });

  const out = bootstrapFactoryTargetRepo({
    targetRepo: targetRepoPath,
    templatePath: path.join(root, "missing-instance.template.json"),
    issueTemplatesDir: path.join(root, "factory", "issue_templates"),
    resolveTargetRepoNameFn: () => "example-org/example-notes",
  });

  assert.equal(out.ok, false);
  assert.match(String(out.error || ""), /missing_instance_template/);
});

test("factory target-repo bootstrap command module supports direct --dry-run invocation", () => {
  const root = makeFixtureRoot();
  const targetRepoPath = path.join(root, "example-notes");
  const templatePath = path.join(root, "factory", "instance.template.json");
  const issueTemplatesDir = path.join(root, "factory", "issue_templates");

  mkdirSync(targetRepoPath, { recursive: true });
  writeJson(templatePath, {
    kind_id: "brainstorm",
    intake: { issue_selector: { labels: ["brainstorm"] } },
    destinations: { goal_issues: { labels: ["goal", "source:brainstorm"] } },
  });
  writeText(path.join(issueTemplatesDir, "brainstorm-incoming.md"), "seed template\n");

  const run = spawnSync("node", [
    bootstrapCommandPath,
    `--target-repo=${targetRepoPath}`,
    `--template-path=${templatePath}`,
    `--issue-templates-dir=${issueTemplatesDir}`,
    "--dry-run",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(String(run.stdout || "{}").trim() || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.applied_changes, 0);
});

test("factory CLI wires target-repo bootstrap command", () => {
  const source = readFileSync(path.join(repoRoot, "packages/factory-ops/src/cli/commands/factory-host-cmds.ts"), "utf8");
  assert.match(source, /FactoryTargetRepoBootstrapCommand/);
  assert.match(source, /static paths = \[\["factory", "target-repo", "bootstrap"\]\]/);
  assert.match(source, /await import\("\.\.\/\.\.\/commands\/factory-target-repo-bootstrap\.mjs"\)/);

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
  assert.match(output, /factory target-repo bootstrap/);
});
