import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { buildCommandEnv, createAsyncChildRegistry, runCommand, terminateProcessTree } from "./run-gates.mjs";

test("buildCommandEnv prepends local node_modules bin to PATH", () => {
  const cwd = mkdtempSync(join(tmpdir(), "run-gates-env-"));
  const localBin = join(cwd, "node_modules", ".bin");
  mkdirSync(localBin, { recursive: true });

  const env = buildCommandEnv({
    cwd,
    env: { PATH: ["/usr/bin", "/bin"].join(delimiter) },
  });

  assert.equal(env.PATH, [localBin, "/usr/bin", "/bin"].join(delimiter));
});

test("buildCommandEnv leaves PATH unchanged when local node_modules bin is absent", () => {
  const cwd = mkdtempSync(join(tmpdir(), "run-gates-env-empty-"));
  const env = buildCommandEnv({
    cwd,
    env: { PATH: ["/usr/bin", "/bin"].join(delimiter) },
  });

  assert.equal(env.PATH, ["/usr/bin", "/bin"].join(delimiter));
});

test("buildCommandEnv strips hook-scoped git repository plumbing vars", () => {
  const cwd = mkdtempSync(join(tmpdir(), "run-gates-hook-env-"));
  const localBin = join(cwd, "node_modules", ".bin");
  mkdirSync(localBin, { recursive: true });

  const env = buildCommandEnv({
    cwd,
    env: {
      PATH: ["/usr/bin", "/bin"].join(delimiter),
      GIT_COMMON_DIR: "/tmp/common",
      GIT_DIR: "/tmp/git-dir",
      GIT_IMPLICIT_WORK_TREE: "0",
      GIT_INDEX_FILE: "/tmp/index",
      GIT_PREFIX: "subdir/",
      GIT_WORK_TREE: "/tmp/worktree",
      NODE_OPTIONS: "--max-old-space-size=16384",
      NODE_PATH: "/tmp/global-node-path",
      GIT_EDITOR: "true",
    },
  });

  assert.equal(env.GIT_COMMON_DIR, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_IMPLICIT_WORK_TREE, undefined);
  assert.equal(env.GIT_INDEX_FILE, undefined);
  assert.equal(env.GIT_PREFIX, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.GIT_EDITOR, "true");
});

test("buildCommandEnv strips npm and pnpm bookkeeping vars for plain node children", () => {
  const env = buildCommandEnv({
    cwd: process.cwd(),
    command: "node",
    env: {
      PATH: ["/usr/bin", "/bin"].join(delimiter),
      npm_config_user_agent: "pnpm",
      PNPM_HOME: "/tmp/pnpm-home",
      INIT_CWD: "/tmp/hook-temp",
    },
  });

  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.PNPM_HOME, undefined);
  assert.equal(env.INIT_CWD, undefined);
});

test("buildCommandEnv preserves pnpm bookkeeping vars for pnpm children except INIT_CWD", () => {
  const env = buildCommandEnv({
    cwd: process.cwd(),
    command: "pnpm",
    env: {
      PATH: ["/usr/bin", "/bin"].join(delimiter),
      npm_config_user_agent: "pnpm",
      PNPM_HOME: "/tmp/pnpm-home",
      INIT_CWD: "/tmp/hook-temp",
    },
  });

  assert.equal(env.npm_config_user_agent, "pnpm");
  assert.equal(env.PNPM_HOME, "/tmp/pnpm-home");
  assert.equal(env.INIT_CWD, undefined);
});

test("async child registry drops tracked child after release", () => {
  const registry = createAsyncChildRegistry();
  const child = { pid: 12345 };
  const release = registry.track(child);

  assert.equal(registry.size(), 1);
  release();
  assert.equal(registry.size(), 0);
});

test("terminateProcessTree kills a directly tracked child process", async () => {
  if (process.platform === "win32") {
    return;
  }

  const runner = spawn("/bin/sleep", ["30"], {
    stdio: "ignore",
  });
  const childPid = runner.pid;
  assert.ok(Number.isInteger(childPid) && childPid > 0);

  terminateProcessTree(childPid, "SIGTERM");
  await delay(100);
  terminateProcessTree(childPid, "SIGKILL");
  await delay(100);

  const exists = spawnSync("/bin/sh", ["-c", `kill -0 ${childPid}`], {
    encoding: "utf8",
  });
  assert.notEqual(exists.status, 0, `expected child pid ${childPid} to be terminated`);
});

test("runCommand fails closed when a gate exceeds its timeout", () => {
  if (process.platform === "win32") {
    return;
  }

  const run = runCommand("/bin/sleep", ["30"], {
    stdio: "pipe",
    timeoutMs: 50,
  });

  assert.equal(run.ok, false);
  assert.equal(run.timedOut, true);
  assert.equal(run.timeoutMs, 50);
  assert.equal(run.exitStatus, 1);
});
