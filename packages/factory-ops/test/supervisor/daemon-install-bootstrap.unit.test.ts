import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach, mock } from "node:test";

import { runInstallAndBuild } from "../../src/lib/daemon.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-install-bootstrap-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  mock.restoreAll();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runInstallAndBuild still bootstraps workspace when lockfile is unchanged", () => {
  const dir = makeTmpDir();
  const lockfile = path.join(dir, "pnpm-lock.yaml");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(lockfile, "lockfileVersion: '9.0'\n");
  writeFileSync(cacheFile, String(statSync(lockfile).mtimeMs));

  const bootstrapWorkspaceFn = mock.fn(() => ({
    ok: true,
    reason: "workspace_bootstrapped",
    install_code: "0",
    build_code: "",
  }));
  const repairWorkspaceBootstrapFn = mock.fn(() => ({
    ok: true,
    reason: "workspace_bootstrapped",
    install_code: "0",
    build_code: "",
  }));
  const runRuntimeStartupProbeFn = mock.fn(() => ({
    ok: true,
    result: "ok",
    probes: [],
  }));
  const persistInstallMtimeFn = mock.fn(() => {});

  runInstallAndBuild({
    repoRoot: dir,
    lockfilePath: lockfile,
    mtimeCachePath: cacheFile,
    daemonLogPath: path.join(dir, "daemon.log"),
    bootstrapWorkspaceFn,
    repairWorkspaceBootstrapFn,
    runRuntimeStartupProbeFn,
    persistInstallMtimeFn,
  });

  assert.equal(bootstrapWorkspaceFn.mock.calls.length, 0);
  assert.equal(repairWorkspaceBootstrapFn.mock.calls.length, 1);
  assert.deepEqual(repairWorkspaceBootstrapFn.mock.calls[0].arguments[0], {
    repoRoot: dir,
    workspaceDir: dir,
  });
  assert.equal(runRuntimeStartupProbeFn.mock.calls.length, 1);
  assert.equal(persistInstallMtimeFn.mock.calls.length, 0);
});

test("runInstallAndBuild falls back to full bootstrap when repaired workspace still fails runtime startup probe", () => {
  const dir = makeTmpDir();
  const lockfile = path.join(dir, "pnpm-lock.yaml");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(lockfile, "lockfileVersion: '9.0'\n");
  writeFileSync(cacheFile, String(statSync(lockfile).mtimeMs));

  const bootstrapWorkspaceFn = mock.fn(() => ({
    ok: true,
    reason: "workspace_bootstrapped",
    install_code: "0",
    build_code: "",
  }));
  const repairWorkspaceBootstrapFn = mock.fn(() => ({
    ok: true,
    reason: "workspace_repaired",
    install_code: "0",
    build_code: "",
  }));
  let probeAttempt = 0;
  const runRuntimeStartupProbeFn = mock.fn(() => {
    probeAttempt += 1;
    if (probeAttempt === 1) {
      return { ok: false, result: "fail", probes: [{ id: "provider", ok: false }] };
    }
    return { ok: true, result: "ok", probes: [] };
  });
  const persistInstallMtimeFn = mock.fn(() => {});

  runInstallAndBuild({
    repoRoot: dir,
    lockfilePath: lockfile,
    mtimeCachePath: cacheFile,
    daemonLogPath: path.join(dir, "daemon.log"),
    bootstrapWorkspaceFn,
    repairWorkspaceBootstrapFn,
    runRuntimeStartupProbeFn,
    persistInstallMtimeFn,
  });

  assert.equal(repairWorkspaceBootstrapFn.mock.calls.length, 1);
  assert.equal(runRuntimeStartupProbeFn.mock.calls.length, 2);
  assert.equal(runRuntimeStartupProbeFn.mock.calls[0].arguments[0].daemonLogPath, path.join(dir, "daemon.log"));
  assert.equal(runRuntimeStartupProbeFn.mock.calls[0].arguments[0].repoRoot, dir);
  assert.equal(typeof runRuntimeStartupProbeFn.mock.calls[0].arguments[0].appendCommandOutputToLogFn, "function");
  assert.equal(bootstrapWorkspaceFn.mock.calls.length, 1);
  assert.deepEqual(bootstrapWorkspaceFn.mock.calls[0].arguments[0], {
    repoRoot: dir,
    workspaceDir: dir,
  });
  assert.equal(persistInstallMtimeFn.mock.calls.length, 0);
});
