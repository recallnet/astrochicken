import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { trim } from "./cli-helpers.ts";
import { runRuntimeStartupProbe } from "./daemon-runtime-startup-probe.ts";
import {
  bootstrapWorkspace,
  repairWorkspaceBootstrap,
} from "./workspace-package-manager.ts";

function readCachedMtimeMs(mtimeCachePath = "") {
  try {
    const value = Number.parseFloat(readFileSync(mtimeCachePath, "utf8").trim());
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value;
  } catch {
    return 0;
  }
}

function persistInstallMtime(lockfilePath = "", mtimeCachePath = "") {
  const mtimeMs = statSync(lockfilePath).mtimeMs;
  mkdirSync(path.dirname(mtimeCachePath), { recursive: true });
  writeFileSync(mtimeCachePath, String(mtimeMs));
}

export function shouldRunInstall(lockfilePath = "", mtimeCachePath = "") {
  try {
    const currentMtimeMs = statSync(lockfilePath).mtimeMs;
    const cachedMtimeMs = readCachedMtimeMs(mtimeCachePath);
    if (!cachedMtimeMs) return true;
    return currentMtimeMs !== cachedMtimeMs;
  } catch {
    return true;
  }
}

export function runInstallAndBuild({
  repoRoot = "",
  lockfilePath = "",
  mtimeCachePath = "",
  daemonLogPath = "",
  bootstrapWorkspaceFn = bootstrapWorkspace,
  repairWorkspaceBootstrapFn = repairWorkspaceBootstrap,
  runRuntimeStartupProbeFn = runRuntimeStartupProbe,
  persistInstallMtimeFn = persistInstallMtime,
  appendLogLineFn = () => {},
  appendCommandOutputToLogFn = () => {},
} = {}) {
  function verifyRuntimeStartup(source = "") {
    const probe = runRuntimeStartupProbeFn({
      repoRoot,
      daemonLogPath,
      appendCommandOutputToLogFn,
    });
    if (!probe?.ok) {
      appendLogLineFn(
        daemonLogPath,
        `runtime_startup_probe_failed source=${source || "unknown"} detail=${JSON.stringify(trim(probe?.detail || "runtime_startup_probe_failed"))}`,
      );
    }
    return probe;
  }

  const installRequired = shouldRunInstall(lockfilePath, mtimeCachePath);
  const bootstrap = installRequired
    ? bootstrapWorkspaceFn({
      repoRoot,
      workspaceDir: repoRoot,
    })
    : repairWorkspaceBootstrapFn({
      repoRoot,
      workspaceDir: repoRoot,
    });
  if (!installRequired) {
    appendLogLineFn(
      daemonLogPath,
      `install_skip reason=lockfile_unchanged bootstrap_exit=${bootstrap.install_code || "0"} build_exit=${bootstrap.build_code || ""} bootstrap_reason=${bootstrap.reason || "unknown"}`,
    );
    const probe = verifyRuntimeStartup("repair");
    if (!probe?.ok) {
      // @context:regression !critical A repaired workspace can still be
      // runtime-broken when transitive package links disappear under launchd.
      // Escalate to a full bootstrap here so the daemon fails before tick
      // start instead of tripping the circuit breaker on a crashable import.
      const fallbackBootstrap = bootstrapWorkspaceFn({
        repoRoot,
        workspaceDir: repoRoot,
      });
      appendLogLineFn(
        daemonLogPath,
        `install_repair_probe_fallback exit=${fallbackBootstrap.install_code || "1"} build_exit=${fallbackBootstrap.build_code || ""} reason=${fallbackBootstrap.reason || "unknown"}`,
      );
      const fallbackProbe = verifyRuntimeStartup("bootstrap_after_repair");
      if (!fallbackProbe?.ok) {
        throw new Error("runtime_startup_probe_failed_after_bootstrap");
      }
    }
    return;
  }
  appendLogLineFn(
    daemonLogPath,
    `install_run exit=${bootstrap.install_code || "1"} build_exit=${bootstrap.build_code || ""} reason=${bootstrap.reason || "unknown"}`,
  );
  try {
    persistInstallMtimeFn(lockfilePath, mtimeCachePath);
  } catch {}
  const probe = verifyRuntimeStartup("bootstrap");
  if (!probe?.ok) {
    throw new Error("runtime_startup_probe_failed_after_bootstrap");
  }
}
