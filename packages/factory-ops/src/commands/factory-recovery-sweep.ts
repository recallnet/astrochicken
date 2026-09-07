import { applyRuntimeRecoverySweep, scanRuntimeRecoverySweep } from "hatch";

import { trim, parseJson } from "../lib/cli-helpers.ts";


function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  return ["true", "1", "yes", "on"].includes(text);
}

export function reconcileRuntimeRecoverySweep({
  runsDir = ".hatch/runs",
  repoPath = "",
  lockDir = "",
  staleMinutes = 20,
  apply = false,
  runId = "",
  worktree = "",
  branch = "",
  skipWorktreeScan = false,
  protectedPaths = [],
  now = new Date(),
  scanRuntimeRecoverySweepFn = scanRuntimeRecoverySweep,
  applyRuntimeRecoverySweepFn = applyRuntimeRecoverySweep,
} = {}) {
  const staleSeconds = Math.max(1, Number(staleMinutes) || 20) * 60;
  const normalizedApply = normalizeBoolean(apply, false);
  const scanOptions = {
    runsDir: String(runsDir || ".hatch/runs"),
    repoPath: repoPath ? String(repoPath) : "",
    lockDir: lockDir ? String(lockDir) : "",
    now,
    staleSeconds,
    runId: runId ? String(runId) : "",
    worktree: worktree ? String(worktree) : "",
    branch: branch ? String(branch) : "",
    skipWorktreeScan: normalizeBoolean(skipWorktreeScan, false),
    protectedPaths: Array.isArray(protectedPaths)
      ? protectedPaths.map((pp) => String(pp || "")).filter(Boolean)
      : [],
  };

  try {
    const report = scanRuntimeRecoverySweepFn(scanOptions);
    const applied = normalizedApply
      ? applyRuntimeRecoverySweepFn({
        report,
        runsDir: scanOptions.runsDir,
        now,
      })
      : null;
    const normalizedReport = parseJson(JSON.stringify(report || {}), {});

    return {
      ok: normalizedApply ? applied?.ok !== false : true,
      apply: normalizedApply,
      report: normalizedReport,
      applied,
      schema_version: normalizedReport?.schemaVersion || normalizedReport?.schema_version || "runtime_recovery_sweep/v1",
      stale_runs: Array.isArray(normalizedReport?.staleRuns)
        ? normalizedReport.staleRuns
        : (Array.isArray(normalizedReport?.stale_runs) ? normalizedReport.stale_runs : []),
      unresolved_active_child_refs: Array.isArray(normalizedReport?.unresolvedActiveChildRefs)
        ? normalizedReport.unresolvedActiveChildRefs
        : (Array.isArray(normalizedReport?.unresolved_active_child_refs) ? normalizedReport.unresolved_active_child_refs : []),
      orphaned_worktrees: Array.isArray(normalizedReport?.orphanedWorktrees)
        ? normalizedReport.orphanedWorktrees
        : (Array.isArray(normalizedReport?.orphaned_worktrees) ? normalizedReport.orphaned_worktrees : []),
      orphaned_branches: Array.isArray(normalizedReport?.orphanedBranches)
        ? normalizedReport.orphanedBranches
        : (Array.isArray(normalizedReport?.orphaned_branches) ? normalizedReport.orphaned_branches : []),
      safe_actions: Array.isArray(normalizedReport?.safeActions)
        ? normalizedReport.safeActions
        : (Array.isArray(normalizedReport?.safe_actions) ? normalizedReport.safe_actions : []),
      command: {
        engine: "in_process_runtime_recovery_sweep",
        scan_options: scanOptions,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: "runtime_recovery_sweep_failed",
      message: String(error?.message || error || ""),
      command: {
        engine: "in_process_runtime_recovery_sweep",
        scan_options: scanOptions,
      },
      report: {
        schemaVersion: "runtime_recovery_sweep/v1",
        staleRuns: [],
        unresolvedActiveChildRefs: [],
        orphanedWorktrees: [],
        orphanedBranches: [],
        safeActions: [],
      },
    };
  }
}
