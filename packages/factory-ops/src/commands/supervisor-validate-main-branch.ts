import { spawnSync } from "node:child_process";

import { emitBugIssue } from "./supervisor-artifact.ts";

/**
 * Pure evaluation: given exit codes from build + test suites, determine health.
 * No side effects — testable without running actual commands.
 */
export function evaluateMainBranchHealth({ buildExit = 0, guardExit = 0, waveClaimExit = 0, failOutput = "" } = {}) {
  const failures = [];
  if (buildExit !== 0 && buildExit !== null) failures.push({ suite: "build", exit_code: buildExit });
  if (guardExit !== 0 && guardExit !== null) failures.push({ suite: "test:guard-gates", exit_code: guardExit });
  if (waveClaimExit !== 0 && waveClaimExit !== null) failures.push({ suite: "test:wave-claim-gates", exit_code: waveClaimExit });
  return {
    ok: failures.length === 0,
    failures,
    fail_output_excerpt: String(failOutput || "").slice(-3000),
  };
}

/**
 * Run build + test suites on main branch and file a bug if any fail.
 * Uses emitBugIssue for automatic deduplication (same failure = same signature = no duplicate).
 */
export function validateMainBranchHealth({ repo, runId = "", pipeline = "factory_supervisor_tick" } = {}) {
  if (!repo) return { ok: false, healthy: false, error: "missing_repo" };

  const restore = spawnSync("git", ["restore", "--staged", "--worktree", "."], { encoding: "utf8" });
  const restoreFailed = restore.status !== 0;

  // Build first (compile TS before running tests)
  const build = spawnSync("pnpm", ["--silent", "build"], { encoding: "utf8", timeout: 120000 });

  let guardExit = null;
  let waveClaimExit = null;
  let failParts = [];

  if (build.status !== 0) {
    failParts.push(String(build.stdout || "") + String(build.stderr || ""));
  } else {
    // Only run tests if build succeeded
    const guard = spawnSync("pnpm", ["--silent", "test:guard-gates"], { encoding: "utf8", timeout: 300000 });
    guardExit = guard.status;
    if (guard.status !== 0) failParts.push(String(guard.stdout || "") + String(guard.stderr || ""));

    const waveClaim = spawnSync("pnpm", ["--silent", "test:wave-claim-gates"], { encoding: "utf8", timeout: 300000 });
    waveClaimExit = waveClaim.status;
    if (waveClaim.status !== 0) failParts.push(String(waveClaim.stdout || "") + String(waveClaim.stderr || ""));
  }

  if (restoreFailed) {
    failParts.push(`[validate-main-branch] git restore failed: ${String(restore.stderr || restore.stdout || "").trim()}`);
  }

  const evaluation = evaluateMainBranchHealth({
    buildExit: restoreFailed ? (build.status || 1) : build.status,
    guardExit: restoreFailed ? 1 : guardExit,
    waveClaimExit: restoreFailed ? 1 : waveClaimExit,
    failOutput: failParts.join("\n---\n"),
  });

  let artifact = { ok: true, issue_url: "", error: "" };
  if (!evaluation.ok) {
    const failedSuites = evaluation.failures.map((f) => f.suite).join(", ");
    artifact = emitBugIssue({
      repo,
      runId,
      pipeline,
      bugType: "main-branch-test-failure",
      summary: `Main branch tests failing: ${failedSuites}`,
      evidence: JSON.stringify({
        failures: evaluation.failures,
        fail_output_excerpt: evaluation.fail_output_excerpt,
        observed_behavior: `Main branch validation failed for suites: ${failedSuites}`,
        expected_behavior: "Main branch build + guard + wave-claim suites should pass before supervisor dispatches new work.",
        remediation_attempts: "Supervisor reran build/test gates and captured failing suite excerpts for deterministic triage.",
        ownership_hint: "control_plane",
        next_step_hint: "Fix failing suites on main, merge, then rerun supervisor tick.",
      }),
    });
  }

  return {
    ok: true,
    healthy: evaluation.ok,
    build_pass: build.status === 0,
    guard_pass: guardExit === 0,
    wave_claim_pass: waveClaimExit === 0,
    failure_count: evaluation.failures.length,
    failures: evaluation.failures,
    artifact_url: artifact.issue_url || "",
    artifact_error: artifact.error || "",
    summary: evaluation.ok
      ? "Main branch tests passing."
      : `Main branch unhealthy: ${evaluation.failures.map((f) => f.suite).join(", ")} failing.`,
  };
}
