import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function resolvedEnv(env) {
  return env ? { ...process.env, ...env } : process.env;
}

export function runFixtureGit(
  cwd,
  args,
  { env } = {},
) {
  const run = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: resolvedEnv(env),
  });
  const stderr = run.stderr || run.stdout;
  assert.equal(run.status, 0, `git ${args.join(" ")} failed: ${stderr}`);
  return run.stdout.trim();
}

export function initFixtureRepo(
  cwd,
  {
    env,
    userEmail = "hatch@example.com",
    userName = "Hatch Fixture",
  } = {},
) {
  runFixtureGit(cwd, ["init"], { env });
  runFixtureGit(cwd, ["config", "user.email", userEmail], { env });
  runFixtureGit(cwd, ["config", "user.name", userName], { env });
  runFixtureGit(cwd, ["config", "commit.gpgSign", "false"], { env });
}

export function baselineFixtureCommit(
  cwd,
  message = "fixture baseline",
  { env } = {},
) {
  runFixtureGit(cwd, ["add", "."], { env });
  runFixtureGit(cwd, ["commit", "-m", message], { env });
  return runFixtureGit(cwd, ["rev-parse", "HEAD"], { env });
}
