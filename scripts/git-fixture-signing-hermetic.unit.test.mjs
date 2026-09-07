import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";

const tempDirs = new Set();

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function allocTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function forcedSigningEnv(rootDir) {
  const homeDir = join(rootDir, "home");
  const gnupgHome = join(rootDir, "gnupg");
  const globalConfigPath = join(rootDir, "global.gitconfig");
  const systemConfigPath = join(rootDir, "system.gitconfig");

  mkdirSync(homeDir, { recursive: true });
  mkdirSync(gnupgHome, { recursive: true });

  writeFileSync(
    globalConfigPath,
    "[commit]\n\tgpgSign = true\n[gpg]\n\tprogram = /path/that/does/not/exist\n",
  );
  writeFileSync(systemConfigPath, "\n");

  return {
    HOME: homeDir,
    GNUPGHOME: gnupgHome,
    GIT_CONFIG_GLOBAL: globalConfigPath,
    GIT_CONFIG_SYSTEM: systemConfigPath,
  };
}

function stageReadme(repoDir, env) {
  writeFileSync(join(repoDir, "README.md"), "fixture\n");
  runFixtureGit(repoDir, ["add", "README.md"], { env });
}

function writeCommitMessageFile(rootDir, name, message) {
  const commitMessagePath = join(rootDir, `${name}.commitmsg`);
  writeFileSync(commitMessagePath, `${message}\n`);
  return commitMessagePath;
}

function runGit(cwd, args, env) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("baseline commit fails when global signing mandate cannot sign", () => {
  const sandboxDir = allocTempDir("git-fixture-signing-baseline-");
  const repoDir = join(sandboxDir, "repo");
  mkdirSync(repoDir, { recursive: true });

  const env = forcedSigningEnv(sandboxDir);

  runFixtureGit(repoDir, ["init"], { env });
  runFixtureGit(repoDir, ["config", "user.email", "hatch@example.com"], { env });
  runFixtureGit(repoDir, ["config", "user.name", "Hatch Fixture"], { env });

  stageReadme(repoDir, env);
  const statusBeforeCommit = runFixtureGit(repoDir, ["status", "--short"], { env });
  assert.match(statusBeforeCommit, /A\s+README\.md/);

  const commitMessagePath = writeCommitMessageFile(sandboxDir, "baseline", "baseline");
  const baselineCommit = runGit(repoDir, ["commit", "-F", commitMessagePath], env);

  assert.notEqual(
    baselineCommit.status,
    0,
    `expected git commit to fail under forced signing mandate\n${baselineCommit.stdout}${baselineCommit.stderr}`,
  );

  const statusAfterCommit = runFixtureGit(repoDir, ["status", "--short"], { env });
  assert.match(statusAfterCommit, /A\s+README\.md/);
});

test("fixture helper disables local signing so commit succeeds under same mandate", () => {
  const sandboxDir = allocTempDir("git-fixture-signing-helper-");
  const repoDir = join(sandboxDir, "repo");
  mkdirSync(repoDir, { recursive: true });

  const env = forcedSigningEnv(sandboxDir);

  initFixtureRepo(repoDir, { env });
  assert.equal(
    runFixtureGit(repoDir, ["config", "--local", "--get", "commit.gpgSign"], { env }),
    "false",
  );

  stageReadme(repoDir, env);
  const statusBeforeCommit = runFixtureGit(repoDir, ["status", "--short"], { env });
  assert.match(statusBeforeCommit, /A\s+README\.md/);

  const commitMessagePath = writeCommitMessageFile(sandboxDir, "helper", "helper");
  const helperCommit = runGit(repoDir, ["commit", "-F", commitMessagePath], env);

  assert.equal(
    helperCommit.status,
    0,
    `expected git commit to succeed with fixture helper override\n${helperCommit.stdout}${helperCommit.stderr}`,
  );

  const sha = runFixtureGit(repoDir, ["rev-parse", "HEAD"], { env });
  assert.match(sha, /^[0-9a-f]{40}$/);

  const statusAfterCommit = runFixtureGit(repoDir, ["status", "--short"], { env });
  assert.equal(statusAfterCommit, "");
});
