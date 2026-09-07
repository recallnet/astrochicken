import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const BUILD_LOCK_TIMEOUT_MS = 180_000;
const BUILD_LOCK_STALE_MS = 300_000;

let buildEnsuredForProcess = false;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Number(ms) || 1));
}

function readLockAgeMs(lockDir) {
  try {
    return Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}

function acquireLock(lockDir) {
  const deadline = Date.now() + BUILD_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(lockDir, { recursive: false });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (readLockAgeMs(lockDir) > BUILD_LOCK_STALE_MS) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for Hatch build lock: ${lockDir}`);
      }
      sleep(100);
    }
  }
}

export function ensureHatchBuild({ repoRoot, silent = true } = {}) {
  if (buildEnsuredForProcess) {
    return;
  }

  const lockRoot = join(repoRoot, ".hatch", "locks");
  const lockDir = join(lockRoot, "ensure-hatch-build.lock");
  mkdirSync(lockRoot, { recursive: true });
  acquireLock(lockDir);

  try {
    const buildInvocation = resolveHatchBuildInvocation({ repoRoot, silent });
    const buildRun = spawnSync(buildInvocation.command, buildInvocation.args, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (buildRun.status !== 0) {
      throw new Error(buildRun.stderr || buildRun.stdout || `hatch build failed with exit ${buildRun.status}`);
    }
    buildEnsuredForProcess = true;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export function resolveHatchBuildInvocation({ repoRoot, silent = true } = {}) {
  if (usesPnpmWorkspace(repoRoot)) {
    return {
      command: "pnpm",
      args: ["--filter", "hatch", ...(silent ? ["--silent"] : []), "build"],
    };
  }

  return {
    command: "npm",
    args: ["run", "build", "--workspace=hatch", ...(silent ? ["--silent"] : [])],
  };
}

function usesPnpmWorkspace(repoRoot) {
  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) {
    return true;
  }

  const packageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return String(packageJson?.packageManager || "").startsWith("pnpm@");
  } catch {
    return false;
  }
}
