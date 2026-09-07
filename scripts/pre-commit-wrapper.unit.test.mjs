import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { baselineFixtureCommit, initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const sourceHookPath = join(repoRoot, ".githooks", "pre-commit");

function setupWrapperFixture() {
  const repoDir = mkdtempSync(join(tmpdir(), "pre-commit-wrapper-"));
  mkdirSync(join(repoDir, ".githooks"), { recursive: true });
  mkdirSync(join(repoDir, "scripts"), { recursive: true });

  copyFileSync(sourceHookPath, join(repoDir, ".githooks", "pre-commit"));
  chmodSync(join(repoDir, ".githooks", "pre-commit"), 0o755);

  writeFileSync(
    join(repoDir, "scripts", "run-gates.mjs"),
    "#!/usr/bin/env node\n" +
      "process.stdout.write('[pre-commit] gate_start gate=stub command=\"node scripts/run-gates.mjs\"\\n');\n" +
      "process.stdout.write('[pre-commit] gate_pass gate=stub command=\"node scripts/run-gates.mjs\" exit=0\\n');\n" +
      "process.exit(Number.parseInt(process.env.PRE_COMMIT_WRAPPER_EXIT || '0', 10));\n",
  );
  chmodSync(join(repoDir, "scripts", "run-gates.mjs"), 0o755);
  writeFileSync(join(repoDir, "scripts", "postinstall-bootstrap.mjs"), "#!/usr/bin/env node\n");
  chmodSync(join(repoDir, "scripts", "postinstall-bootstrap.mjs"), 0o755);
  writeFileSync(join(repoDir, "README.md"), "wrapper fixture\n");

  initFixtureRepo(repoDir);
  baselineFixtureCommit(repoDir, "fixture baseline");
  writeFileSync(join(repoDir, "README.md"), "wrapper fixture changed\n");
  runFixtureGit(repoDir, ["add", "README.md"]);
  return repoDir;
}

test("pre-commit wrapper streams gate output while writing the log file", () => {
  const repoDir = setupWrapperFixture();
  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env: process.env,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\[pre-commit\] gate_start gate=stub/);
  assert.match(run.stdout, /\[pre-commit\] gate_pass gate=stub/);
  assert.match(run.stdout, /\[pre-commit\] ok \(log: \.hook-logs\/pre-commit\.log\)/);

  const hookLog = readFileSync(join(repoDir, ".hook-logs", "pre-commit.log"), "utf8");
  assert.match(hookLog, /\[pre-commit\] gate_start gate=stub/);
  assert.match(hookLog, /\[pre-commit\] gate_pass gate=stub/);
});

test("pre-commit wrapper preserves failure exit status while still streaming gate output", () => {
  const repoDir = setupWrapperFixture();
  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env: {
      ...process.env,
      PRE_COMMIT_WRAPPER_EXIT: "23",
    },
    encoding: "utf8",
  });

  assert.equal(run.status, 23, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\[pre-commit\] gate_start gate=stub/);
  assert.match(run.stdout, /\[pre-commit\] failed \(full log: \.hook-logs\/pre-commit\.log\)/);

  const hookLog = readFileSync(join(repoDir, ".hook-logs", "pre-commit.log"), "utf8");
  assert.match(hookLog, /\[pre-commit\] gate_start gate=stub/);
});

test("pre-commit wrapper fails closed with a bootstrap error when local workspace deps are missing", () => {
  const repoDir = setupWrapperFixture();
  writeFileSync(join(repoDir, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");

  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env: process.env,
    encoding: "utf8",
  });

  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /\[pre-commit\] bootstrap_missing reason=workspace_dependencies_unavailable remedy="pnpm install --frozen-lockfile"/);

  const hookLog = readFileSync(join(repoDir, ".hook-logs", "pre-commit.log"), "utf8");
  assert.match(hookLog, /bootstrap_missing/);
});

test("pre-commit wrapper fails closed when factory-ops package links are incomplete", () => {
  const repoDir = setupWrapperFixture();
  writeFileSync(join(repoDir, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
  mkdirSync(join(repoDir, "node_modules", "acorn"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "acorn", "package.json"), "{\"name\":\"acorn\"}\n");
  mkdirSync(join(repoDir, "node_modules", "ajv"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "ajv", "package.json"), "{\"name\":\"ajv\"}\n");
  mkdirSync(join(repoDir, "node_modules", "zod"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "zod", "package.json"), "{\"name\":\"zod\"}\n");
  mkdirSync(join(repoDir, "node_modules", "@hatch", "factory-ops"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "@hatch", "factory-ops", "package.json"), "{\"name\":\"@hatch/factory-ops\"}\n");
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core", "package.json"),
    "{\"name\":\"@hatch/factory-core\"}\n",
  );
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "github-adapter"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "github-adapter", "package.json"),
    "{\"name\":\"@hatch/github-adapter\"}\n",
  );
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@recallnet", "factory-telemetry"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "factory-ops", "node_modules", "@recallnet", "factory-telemetry", "package.json"),
    "{\"name\":\"@recallnet/factory-telemetry\"}\n",
  );
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "pg"), { recursive: true });
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "pg", "package.json"), "{\"name\":\"pg\"}\n");
  mkdirSync(join(repoDir, "packages", "github-adapter", "node_modules", "@hatch", "factory-core"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "github-adapter", "node_modules", "@hatch", "factory-core", "package.json"),
    "{\"name\":\"@hatch/factory-core\"}\n",
  );

  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env: process.env,
    encoding: "utf8",
  });

  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /\[pre-commit\] bootstrap_missing reason=workspace_dependencies_unavailable remedy="pnpm install --frozen-lockfile"/);
});

test("pre-commit wrapper repairs missing workspace links with postinstall bootstrap before failing", () => {
  const repoDir = setupWrapperFixture();
  writeFileSync(join(repoDir, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
  mkdirSync(join(repoDir, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(
    join(repoDir, "scripts", "postinstall-bootstrap.mjs"),
    "#!/usr/bin/env node\n" +
      "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
      "const ensure = (path, body) => { mkdirSync(path.replace(/\\/package\\.json$/, ''), { recursive: true }); writeFileSync(path, body); };\n" +
      "ensure('node_modules/acorn/package.json', '{\"name\":\"acorn\"}\\n');\n" +
      "ensure('node_modules/ajv/package.json', '{\"name\":\"ajv\"}\\n');\n" +
      "ensure('node_modules/zod/package.json', '{\"name\":\"zod\"}\\n');\n" +
      "ensure('node_modules/@hatch/factory-ops/package.json', '{\"name\":\"@hatch/factory-ops\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@hatch/factory-core/package.json', '{\"name\":\"@hatch/factory-core\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@hatch/github-adapter/package.json', '{\"name\":\"@hatch/github-adapter\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@recallnet/factory-telemetry/package.json', '{\"name\":\"@recallnet/factory-telemetry\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/clipanion/package.json', '{\"name\":\"clipanion\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/hatch/package.json', '{\"name\":\"hatch\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/pg/package.json', '{\"name\":\"pg\"}\\n');\n" +
      "ensure('packages/github-adapter/node_modules/@hatch/factory-core/package.json', '{\"name\":\"@hatch/factory-core\"}\\n');\n" +
      "ensure('packages/github-adapter/node_modules/zod/package.json', '{\"name\":\"zod\"}\\n');\n",
  );
  chmodSync(join(repoDir, "scripts", "postinstall-bootstrap.mjs"), 0o755);

  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env: process.env,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\[pre-commit\] gate_pass gate=stub/);
});
