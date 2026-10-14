import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach, mock } from "node:test";

import {
  ACTIVE_SLEEP_MS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  IDLE_SLEEP_BASE_MS,
  detectOrphanPids,
  evaluateDaemonControlStateAction,
  evaluateDaemonStartupInvariants,
  evaluateGitPullGuard,
  resolveLeaseSafeSleepMs,
  resolveCircuitBreakerThreshold,
  resolveFactoryContext,
  resolveTickRuntime,
  resolveTickSleep,
  resumeDaemonControlState,
  runDaemon,
  shouldRunInstall,
} from "../../src/lib/daemon.ts";
import {
  evaluateCircuitBreakerCooldown,
  evaluateCircuitBreakerTransition,
  tripCircuitBreaker,
} from "../../src/lib/daemon-circuit-breaker.ts";
import { classifyTickFailureTombstone } from "../../src/lib/daemon-tick-runner.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-unit-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeBrainstormRuntime(repoRoot) {
  return {
    factoryId: "brainstorm",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/brainstorm",
    targetRepo: "example-org/brainstorm",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/brainstorm",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };
}

function makeScannerRuntime(repoRoot) {
  return {
    factoryId: "example-scanner",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/example-scanner",
    targetRepo: "example-org/example-scanner",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/example-scanner",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };
}

afterEach(() => {
  mock.restoreAll();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveTickSleep(true) returns idle interval", () => {
  assert.equal(resolveTickSleep(true), IDLE_SLEEP_BASE_MS);
});

test("resolveTickSleep(false) returns active interval", () => {
  assert.equal(resolveTickSleep(false), ACTIVE_SLEEP_MS);
});

test("resolveTickSleep('true') returns idle interval", () => {
  assert.equal(resolveTickSleep("true"), IDLE_SLEEP_BASE_MS);
});

test("resolveTickSleep(null) returns active interval", () => {
  assert.equal(resolveTickSleep(null), ACTIVE_SLEEP_MS);
});

test("resolveLeaseSafeSleepMs caps idle sleep below lease survival window", () => {
  assert.equal(
    resolveLeaseSafeSleepMs({
      tickIdle: true,
      leaseTtlSec: 60,
      leaseRenewLeadMs: 30_000,
    }),
    29_000,
  );
});

test("resolveLeaseSafeSleepMs also caps active sleep when the configured interval exceeds the lease survival window", () => {
  assert.equal(
    resolveLeaseSafeSleepMs({
      tickIdle: false,
      leaseTtlSec: 60,
      leaseRenewLeadMs: 30_000,
    }),
    29_000,
  );
});

test("shouldRunInstall returns true when cache file is missing", () => {
  const dir = makeTmpDir();
  const lockfile = path.join(dir, "package-lock.json");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(lockfile, "{}\n");

  assert.equal(shouldRunInstall(lockfile, cacheFile), true);
});

test("shouldRunInstall returns false when lockfile mtime matches cache", () => {
  const dir = makeTmpDir();
  const lockfile = path.join(dir, "package-lock.json");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(lockfile, "{}\n");
  const mtimeMs = statSync(lockfile).mtimeMs;
  writeFileSync(cacheFile, String(mtimeMs));

  assert.equal(shouldRunInstall(lockfile, cacheFile), false);
});

test("shouldRunInstall returns true when lockfile mtime changed", () => {
  const dir = makeTmpDir();
  const lockfile = path.join(dir, "package-lock.json");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(lockfile, "{}\n");
  const mtimeMs = statSync(lockfile).mtimeMs;
  writeFileSync(cacheFile, String(mtimeMs + 1));

  assert.equal(shouldRunInstall(lockfile, cacheFile), true);
});

test("shouldRunInstall returns true when lockfile is missing", () => {
  const dir = makeTmpDir();
  const missingLockfile = path.join(dir, "package-lock.json");
  const cacheFile = path.join(dir, "last-install-lockfile-mtime");
  writeFileSync(cacheFile, "123\n");

  assert.equal(shouldRunInstall(missingLockfile, cacheFile), true);
});

test("detectOrphanPids excludes dead pid entries (ESRCH)", () => {
  const dir = makeTmpDir();
  writeFileSync(path.join(dir, "worker.pid"), "4242\n");

  const result = detectOrphanPids(dir, {
    currentPid: 9999,
    killFn: () => {
      const error = new Error("not found");
      error.code = "ESRCH";
      throw error;
    },
  });

  assert.deepEqual(result, []);
});

test("detectOrphanPids includes running pid entries when access is EPERM", () => {
  const dir = makeTmpDir();
  writeFileSync(path.join(dir, "worker.pid"), "4242\n");

  const result = detectOrphanPids(dir, {
    currentPid: 9999,
    killFn: () => {
      const error = new Error("permission denied");
      error.code = "EPERM";
      throw error;
    },
  });

  assert.deepEqual(result, [{ pid: 4242, file: path.join(dir, "worker.pid"), access: "eperm" }]);
});

test("detectOrphanPids includes running pid entries when kill(0) succeeds", () => {
  const dir = makeTmpDir();
  writeFileSync(path.join(dir, "worker.pid"), "4242\n");

  const result = detectOrphanPids(dir, {
    currentPid: 9999,
    killFn: () => {},
  });

  assert.deepEqual(result, [{ pid: 4242, file: path.join(dir, "worker.pid"), access: "ok" }]);
});

test("resolveFactoryContext delegates to shared resolver with factoryRoot", () => {
  const spy = mock.fn((options) => ({ options }));
  const resolved = resolveFactoryContext(" mothership ", { resolveContext: spy });

  assert.equal(spy.mock.calls.length, 1);
  assert.deepEqual(spy.mock.calls[0].arguments[0], { factoryId: "mothership", factoryRoot: "factories/mothership", requireTargetRepo: true });
  assert.deepEqual(resolved, { options: { factoryId: "mothership", factoryRoot: "factories/mothership", requireTargetRepo: true } });
});

test("resolveFactoryContext passes correct factoryRoot for non-mothership factories", () => {
  const spy = mock.fn((options) => ({ options }));
  resolveFactoryContext("brainstorm", { resolveContext: spy });

  assert.equal(spy.mock.calls.length, 1);
  assert.deepEqual(spy.mock.calls[0].arguments[0], { factoryId: "brainstorm", factoryRoot: "factories/brainstorm", requireTargetRepo: true });
});

test("evaluateDaemonStartupInvariants blocks mothership canonical checkout on non-main", () => {
  const result = evaluateDaemonStartupInvariants({
    factoryId: "mothership",
    repoRoot: "/tmp/astrochicken",
    config: { factory_id: "mothership", canonical_checkout_path: "/tmp/astrochicken" },
    currentBranch: "wave/goal-1-wave-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "canonical_checkout_requires_main");
});

test("evaluateDaemonStartupInvariants blocks managed factory on canonical checkout", () => {
  const result = evaluateDaemonStartupInvariants({
    factoryId: "example-trading",
    repoRoot: "/tmp/astrochicken",
    config: { factory_id: "example-trading", managed: true, canonical_checkout_path: "/tmp/astrochicken" },
    currentBranch: "main",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "managed_factory_cannot_run_from_canonical_checkout");
});

test("evaluateDaemonStartupInvariants allows managed factory on canonical when work_dir is set", () => {
  const result = evaluateDaemonStartupInvariants({
    factoryId: "example-trading",
    repoRoot: "/tmp/astrochicken",
    config: { factory_id: "example-trading", managed: true, canonical_checkout_path: "/tmp/astrochicken", work_dir: "/tmp/example-trading" },
    currentBranch: "main",
  });
  assert.equal(result.ok, true, "managed factory with work_dir should be allowed to start from canonical");
});

test("evaluateDaemonStartupInvariants allows mothership canonical checkout on main", () => {
  const result = evaluateDaemonStartupInvariants({
    factoryId: "mothership",
    repoRoot: "/tmp/astrochicken",
    config: { factory_id: "mothership", canonical_checkout_path: "/tmp/astrochicken" },
    currentBranch: "main",
  });
  assert.equal(result.ok, true);
  assert.equal(result.running_from_canonical, true);
});

test("evaluateDaemonStartupInvariants remains read-only and does not block canonical startup", () => {
  const result = evaluateDaemonStartupInvariants({
    factoryId: "brainstorm",
    repoRoot: "/tmp/astrochicken",
    config: { factory_id: "brainstorm", canonical_checkout_path: "/tmp/astrochicken" },
    currentBranch: "main",
    repoRoleContext: {
      targetRepo: "example-org/home",
      controlPlaneRepo: "example-org/control-plane",
      destinationRepos: ["example-org/destination"],
      repoSlug: "example-org/unmapped",
      enforceRepoRoles: true,
      allowControlPlaneMainSafeFlow: true,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.running_from_canonical, true);
});

test("evaluateGitPullGuard blocks ambiguous repo role context with deterministic reason", () => {
  const evaluated = evaluateGitPullGuard({
    repoRoot: "/tmp/astrochicken",
    branch: "main",
    canonicalCheckoutPath: "/tmp/astrochicken",
    repoRoleContext: {
      targetRepo: "example-org/home",
      controlPlaneRepo: "example-org/control-plane",
      destinationRepos: ["example-org/destination"],
      repoSlug: "",
      enforceRepoRoles: true,
      allowControlPlaneMainSafeFlow: true,
    },
  });
  assert.equal(evaluated.guard.ok, false);
  assert.equal(evaluated.guard.reason, "repo_role_unresolved_slug");
});

test("evaluateGitPullGuard allows canonical control-plane main-safe pull when explicitly allowed", () => {
  const evaluated = evaluateGitPullGuard({
    repoRoot: "/tmp/astrochicken",
    branch: "main",
    canonicalCheckoutPath: "/tmp/astrochicken",
    repoRoleContext: {
      targetRepo: "example-org/home",
      controlPlaneRepo: "example-org/control-plane",
      destinationRepos: ["example-org/destination"],
      repoSlug: "example-org/control-plane",
      enforceRepoRoles: true,
      allowControlPlaneMainSafeFlow: true,
    },
  });
  assert.equal(evaluated.guard.ok, true);
  assert.equal(evaluated.guard.reason, "");
});

test("evaluateDaemonControlStateAction enforces skip/clear/drain contract", () => {
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "pause" }).shouldRunTick, false);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "quarantine" }).shouldSleepIdle, true);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "draining" }).shouldStop, true);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "resume" }).shouldClearState, false);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "resume" }).shouldRunTick, true);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "retry" }).shouldClearState, true);
  assert.equal(evaluateDaemonControlStateAction({ stateAction: "none" }).shouldRunTick, true);
});

test("resolveCircuitBreakerThreshold defaults to 6 and accepts env override", () => {
  assert.equal(resolveCircuitBreakerThreshold({ configuredThreshold: undefined, env: {} }), 6);
  assert.equal(resolveCircuitBreakerThreshold({ configuredThreshold: undefined, env: { HATCH_DAEMON_CIRCUIT_BREAKER_THRESHOLD: "5" } }), 5);
  assert.equal(resolveCircuitBreakerThreshold({ configuredThreshold: "0", env: {} }), 6);
});

test("evaluateCircuitBreakerTransition resets on success and trips on threshold", () => {
  const reset = evaluateCircuitBreakerTransition({ consecutiveFailures: 2, tickExitCode: 0, threshold: 3 });
  assert.equal(reset.nextConsecutiveFailures, 0);
  assert.equal(reset.reset, true);
  assert.equal(reset.shouldTrip, false);

  const firstFailure = evaluateCircuitBreakerTransition({ consecutiveFailures: 0, tickExitCode: 1, threshold: 3 });
  assert.equal(firstFailure.nextConsecutiveFailures, 1);
  assert.equal(firstFailure.shouldTrip, false);

  const tripped = evaluateCircuitBreakerTransition({ consecutiveFailures: 2, tickExitCode: 1, threshold: 3 });
  assert.equal(tripped.nextConsecutiveFailures, 3);
  assert.equal(tripped.shouldTrip, true);
});

test("evaluateCircuitBreakerTransition ignores informational failures and immediately trips blocking failures", () => {
  const informational = evaluateCircuitBreakerTransition({
    consecutiveFailures: 2,
    tickExitCode: 1,
    threshold: 3,
    tombstone: {
      tombstone_id: "tick-failure:info",
      classification: {
        severity: "informational",
        crash_type: "judge_failure",
        resolution_type: "log",
      },
    },
  });
  assert.equal(informational.nextConsecutiveFailures, 2);
  assert.equal(informational.countFailure, false);
  assert.equal(informational.shouldTrip, false);
  assert.equal(informational.action, "log");

  const blocking = evaluateCircuitBreakerTransition({
    consecutiveFailures: 0,
    tickExitCode: 1,
    threshold: 6,
    tombstone: {
      tombstone_id: "tick-failure:blocking",
      classification: {
        severity: "blocking",
        crash_type: "module_not_found",
        resolution_type: "trip_and_route_foreman",
      },
    },
  });
  assert.equal(blocking.nextConsecutiveFailures, 1);
  assert.equal(blocking.countFailure, true);
  assert.equal(blocking.shouldTrip, true);
  assert.equal(blocking.threshold, 1);
  assert.equal(blocking.action, "trip_and_route_foreman");
});

test("tripCircuitBreaker writes paused control-state and emits bug incident", () => {
  const writes = [];
  const emits = [];

  const out = tripCircuitBreaker({
    runtime: {
      factoryId: "brainstorm",
      targetRepo: "example-org/brainstorm",
      targetRepo: "example-org/brainstorm",
      controlPlaneRepo: "recallnet/astrochicken",
    },
    repoRoot: "/tmp/repo",
    controlState: {
      notes: [],
      action_state: {
        pause: { active: false },
        quarantine: { active: false },
        retry: { active: true, count: 2 },
        unblock: { active: false },
        resume: { active: false },
      },
    },
    tickResult: {
      exitCode: 1,
      runId: "run-77",
      tickLogPath: "/tmp/repo/tick.log",
      failureTombstone: {
        tombstone_id: "tick-failure:run-77",
        classification: {
          classification: "local",
          severity: "blocking",
          crash_type: "module_not_found",
          resolution_type: "trip_and_route_foreman",
        },
      },
    },
    failureCount: 3,
    threshold: 3,
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    emitBugIssueFn: (input) => {
      emits.push(input);
      return { ok: true, issue_url: "https://example.test/1" };
    },
    readTickFailureEvidenceFn: () => "stderr-line",
    nowIso: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState.action_state.pause.active, true);
  assert.equal(writes[0].nextState.reason, "circuit_breaker_blocking_after_3_failures");
  assert.equal(emits.length, 1);
  assert.equal(emits[0].repo, "recallnet/astrochicken");
  assert.equal(emits[0].bugType, "managed-daemon-circuit-breaker");
  assert.equal(emits[0].sourceRepo, "example-org/brainstorm");
  assert.deepEqual(emits[0].labels, ["kind:brainstorm", "managed-factory-bug", "incident-fingerprint"]);
  assert.equal(emits[0].severity, "blocking");
  assert.equal(emits[0].crashType, "module_not_found");
  assert.equal(emits[0].classification, "local");
  assert.equal(emits[0].evidence.observed_behavior, "Daemon paused brainstorm after 3 consecutive blocking tick failures.");
  assert.equal(emits[0].evidence.expected_behavior, "Managed factory ticks should keep running until the control-plane incident is triaged or the operator resumes the daemon.");
  assert.equal(emits[0].evidence.remediation_attempts, "Circuit breaker paused the daemon, preserved retry_target, and routed the incident to the control-plane bug owner.");
  assert.equal(out.breakerReason, "circuit_breaker_blocking_after_3_failures");
  assert.equal(out.resolutionType, "trip_and_route_foreman");
});

test("resumeDaemonControlState clears paused control state without manual edits", () => {
  const writes = [];
  const resumed = resumeDaemonControlState({
    factoryId: "brainstorm",
    repoRoot: "/tmp/repo",
    reason: "operator_resume",
    actor: "daemon",
    nowIso: "2026-03-15T00:00:00.000Z",
    readControlStateFn: () => ({
      action_state: {
        pause: { active: true },
        quarantine: { active: true, count: 3 },
        retry: { active: true, count: 2, last_target: "run-1" },
        unblock: { active: true, note: "ack" },
        resume: { active: false },
      },
      reason: "circuit_breaker_after_3_failures",
      retry_target: "run-1",
    }),
    writeControlStateFn: (input) => {
      writes.push(input);
      return {
        ...input.nextState,
      };
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState.action_state.pause.active, false);
  assert.equal(writes[0].nextState.action_state.retry.active, false);
  assert.equal(writes[0].nextState.action_state.resume.active, true);
  assert.equal(writes[0].nextState.reason, "active");
  assert.equal(writes[0].nextState.retry_target, "");
  assert.equal(resumed.action_state.resume.at, "2026-03-15T00:00:00.000Z");
});

test("runDaemon skips paused control-state ticks and sleeps idle", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const sleepCalls = [];
  const tickCalls = [];

  const runtime = makeBrainstormRuntime(repoRoot);

  const actions = ["pause", "draining"];

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 2,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({
      reason: "operator pause",
      action_state: {
        pause: { active: true },
        draining: { active: false },
      },
    }),
    getControlStateActionFn: () => actions.shift() || "draining",
    runGitPullFn: () => {
      throw new Error("git pull must not run when paused");
    },
    runRecoverySweepFn: () => {
      throw new Error("recovery sweep must not run when paused");
    },
    runInstallAndBuildFn: () => {
      throw new Error("install must not run when paused");
    },
    runTickFn: async () => {
      tickCalls.push(true);
      return { exitCode: 0, tickIdle: true, runId: "", tickLogPath: "" };
    },
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  assert.equal(out.ticks, 0);
  assert.equal(out.loops, 2);
  assert.equal(tickCalls.length, 0);
  assert.deepEqual(sleepCalls, [IDLE_SLEEP_BASE_MS]);
});

test("runDaemon clears retry action before running tick", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const writes = [];

  const runtime = makeBrainstormRuntime(repoRoot);

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({
      reason: "retry last run",
      action_state: {
        retry: { active: true },
      },
    }),
    getControlStateActionFn: () => "retry",
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => ({
      exitCode: 0,
      tickIdle: false,
      runId: "run-ok",
      tickLogPath: path.join(repoRoot, "tick.log"),
    }),
    sleepFn: async () => {},
  });

  assert.equal(out.ticks, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState.reason, "active");
  assert.equal(writes[0].nextState.action_state.retry.active, false);
  assert.equal(writes[0].nextState.action_state.resume.active, true);
});

test("runDaemon trips circuit breaker after threshold failures and resets after success", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const writes = [];
  const emits = [];
  const transitionSeen = [];

  const runtime = makeBrainstormRuntime(repoRoot);

  const tickResults = [
    { exitCode: 1, tickIdle: false, runId: "run-1", tickLogPath: path.join(repoRoot, "tick-1.log") },
    { exitCode: 0, tickIdle: false, runId: "run-2", tickLogPath: path.join(repoRoot, "tick-2.log") },
    { exitCode: 1, tickIdle: false, runId: "run-3", tickLogPath: path.join(repoRoot, "tick-3.log") },
    { exitCode: 1, tickIdle: false, runId: "run-4", tickLogPath: path.join(repoRoot, "tick-4.log") },
  ];

  for (const result of tickResults) {
    writeFileSync(result.tickLogPath, `tick ${result.runId} failed\n`);
  }

  await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: tickResults.length,
    circuitBreakerThreshold: 2,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    emitBugIssueFn: (input) => {
      emits.push(input);
      return { ok: true, issue_url: "https://example.test/bug" };
    },
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => tickResults.shift(),
    sleepFn: async () => {},
    tripCircuitBreakerFn: (input) => {
      transitionSeen.push(input.failureCount);
      return tripCircuitBreaker({ ...input, nowIso: "2026-03-15T00:00:00.000Z" });
    },
  });

  assert.deepEqual(transitionSeen, [2]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState.reason, "circuit_breaker_after_2_failures");
  assert.equal(emits.length, 1);
  assert.equal(emits[0].bugType, "managed-daemon-circuit-breaker");
});

test("runDaemon ignores informational failures and trips immediately on blocking failures", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const writes = [];
  const emits = [];
  const transitionSeen = [];

  const runtime = {
    factoryId: "mothership",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: false },
    canonicalCheckoutPath: repoRoot,
    targetRepo: "recallnet/astrochicken",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  const tickResults = [
    {
      exitCode: 1,
      tickIdle: false,
      runId: "run-info",
      tickLogPath: path.join(repoRoot, "tick-info.log"),
      failureTombstone: {
        tombstone_id: "tick-failure:run-info",
        classification: {
          classification: "platform",
          severity: "informational",
          crash_type: "judge_failure",
          resolution_type: "log",
        },
      },
    },
    {
      exitCode: 1,
      tickIdle: false,
      runId: "run-blocking",
      tickLogPath: path.join(repoRoot, "tick-blocking.log"),
      failureTombstone: {
        tombstone_id: "tick-failure:run-blocking",
        classification: {
          classification: "platform",
          severity: "blocking",
          crash_type: "module_not_found",
          resolution_type: "trip_and_route_foreman",
        },
      },
    },
  ];

  await runDaemon("mothership", {
    repoRoot,
    hostBaseDir,
    maxTicks: tickResults.length,
    circuitBreakerThreshold: 6,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    emitBugIssueFn: (input) => {
      emits.push(input);
      return { ok: true, issue_url: "https://example.test/bug" };
    },
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => tickResults.shift(),
    sleepFn: async () => {},
    tripCircuitBreakerFn: (input) => {
      transitionSeen.push({ failureCount: input.failureCount, crashType: input.tickResult?.failureTombstone?.classification?.crash_type });
      return tripCircuitBreaker({ ...input, nowIso: "2026-03-15T00:00:00.000Z" });
    },
  });

  assert.deepEqual(transitionSeen, [{ failureCount: 1, crashType: "module_not_found" }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState.reason, "circuit_breaker_blocking_after_1_failures");
  assert.equal(emits.length, 1);
  assert.equal(emits[0].severity, "blocking");
  assert.equal(emits[0].crashType, "module_not_found");
});

test("runDaemon evaluates scheduled jobs after each tick", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const scheduledCalls = [];

  const runtime = {
    factoryId: "mothership",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: {
      schedules: {
        jobs: [
          {
            id: "daily-lens",
            type: "graph",
            graph: "factories/mothership/graphs/daily_lens_publish.dot",
            cron: "30 8 * * *",
            time_zone: "America/Denver",
          },
        ],
      },
    },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "recallnet/astrochicken",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  const out = await runDaemon("mothership", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => ({
      exitCode: 0,
      tickIdle: false,
      runId: "run-1",
      tickLogPath: path.join(repoRoot, "tick.log"),
    }),
    runScheduledJobsFn: async (input) => {
      scheduledCalls.push(input);
      return { executed: [], due_count: 0 };
    },
    sleepFn: async () => {},
  });

  assert.equal(out.ticks, 1);
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0].runtime.factoryId, "mothership");
});

test("runDaemon passes skipWorktreeScan to recovery sweep for api_only workspace mode", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const sweepCalls = [];

  const runtime = {
    factoryId: "brainstorm",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true, workspace_mode: "api_only" },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/example-notes",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    runGitPullFn: () => {},
    runRecoverySweepFn: (args) => { sweepCalls.push(args); },
    runInstallAndBuildFn: () => {},
    runTickFn: async () => ({
      exitCode: 0,
      tickIdle: false,
      runId: "run-1",
      tickLogPath: path.join(repoRoot, "tick.log"),
    }),
    sleepFn: async () => {},
  });

  assert.equal(sweepCalls.length, 1);
  assert.equal(sweepCalls[0].skipWorktreeScan, true);
});

test("runDaemon passes skipWorktreeScan for managed factory in checkout workspace mode", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const sweepCalls = [];
  const managedRepoRoot = path.join(repoRoot, "managed-target");

  const runtime = {
    factoryId: "example-trading",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true, workspace_mode: "checkout" },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/example-trading",
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: managedRepoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  await runDaemon("example-trading", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    runGitPullFn: () => {},
    runRecoverySweepFn: (args) => { sweepCalls.push(args); },
    runInstallAndBuildFn: () => {},
    runTickFn: async () => ({
      exitCode: 0,
      tickIdle: false,
      runId: "run-1",
      tickLogPath: path.join(repoRoot, "tick.log"),
    }),
    sleepFn: async () => {},
  });

  assert.equal(sweepCalls.length, 1);
  assert.equal(sweepCalls[0].skipWorktreeScan, true);
  assert.equal(sweepCalls[0].repoRoot, managedRepoRoot);
});

test("resolveTickRuntime roots managed checkout runs under the managed work_dir", () => {
  const repoRoot = process.cwd();
  const runtime = resolveTickRuntime({ factoryId: "example-trading", repoRoot });

  assert.equal(runtime.contextRepoPath, "/path/to/example-trading");
  assert.equal(runtime.runsDir, "/path/to/example-trading/.hatch/example-trading/runs");
});

test("resolveTickRuntime keeps dispatch and supervisor graphs separate when config declares both", () => {
  const repoRoot = process.cwd();
  const runtime = resolveTickRuntime({ factoryId: "mothership", repoRoot });

  assert.ok(runtime.dispatchGraph.endsWith(path.join("factories", "mothership", "workflows", "dispatch-control", "factory_dispatch_reactor.workflow-source.mjs")));
  assert.ok(runtime.supervisorGraph.endsWith(path.join("factories", "mothership", "workflows", "dispatch-control", "factory_supervisor_tick.workflow-source.mjs")));
  assert.notEqual(runtime.dispatchGraph, runtime.supervisorGraph);
  assert.equal(runtime.dispatchLatencySloSeconds, 15);
  assert.equal(runtime.maintenanceIntervalSeconds, 300);
});

test("evaluateCircuitBreakerCooldown returns shouldRetry=true after cooldown period elapses", () => {
  const pausedAt = new Date("2026-03-19T03:00:00.000Z");
  const afterCooldown = new Date(pausedAt.getTime() + CIRCUIT_BREAKER_COOLDOWN_MS + 1000);
  const result = evaluateCircuitBreakerCooldown({
    reason: "circuit_breaker_after_3_failures",
    notes: [{ at: pausedAt.toISOString(), actor: "daemon", action: "pause", reason: "circuit_breaker_after_3_failures" }],
    now: afterCooldown,
  });
  assert.equal(result.shouldRetry, true);
  assert.ok(result.elapsedMs >= CIRCUIT_BREAKER_COOLDOWN_MS);
});

test("evaluateCircuitBreakerCooldown returns shouldRetry=true for blocking circuit-breaker pauses after cooldown elapses", () => {
  const pausedAt = new Date("2026-03-19T03:00:00.000Z");
  const afterCooldown = new Date(pausedAt.getTime() + CIRCUIT_BREAKER_COOLDOWN_MS + 1000);
  const result = evaluateCircuitBreakerCooldown({
    reason: "circuit_breaker_blocking_after_1_failures",
    notes: [{ at: pausedAt.toISOString(), actor: "daemon", action: "pause", reason: "circuit_breaker_blocking_after_1_failures" }],
    now: afterCooldown,
  });
  assert.equal(result.shouldRetry, true);
  assert.ok(result.elapsedMs >= CIRCUIT_BREAKER_COOLDOWN_MS);
});

test("evaluateCircuitBreakerCooldown returns shouldRetry=false before cooldown period", () => {
  const pausedAt = new Date("2026-03-19T03:00:00.000Z");
  const beforeCooldown = new Date(pausedAt.getTime() + 60_000);
  const result = evaluateCircuitBreakerCooldown({
    reason: "circuit_breaker_after_3_failures",
    notes: [{ at: pausedAt.toISOString(), actor: "daemon", action: "pause", reason: "circuit_breaker_after_3_failures" }],
    now: beforeCooldown,
  });
  assert.equal(result.shouldRetry, false);
});

test("runDaemon auto-resumes expired blocking circuit-breaker pause and executes a tick", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const writes = [];
  const tickCalls = [];
  const pausedAt = new Date("2026-03-19T03:00:00.000Z");
  const nowIso = new Date(pausedAt.getTime() + CIRCUIT_BREAKER_COOLDOWN_MS + 1000).toISOString();

  const runtime = {
    factoryId: "mothership",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  const controlState = {
    reason: "circuit_breaker_blocking_after_1_failures",
    retry_target: "run-blocked",
    action_state: {
      pause: { active: true },
      quarantine: { active: false },
      retry: { active: false },
      unblock: { active: false },
      resume: { active: false },
    },
    notes: [{ at: pausedAt.toISOString(), actor: "daemon", action: "pause", reason: "circuit_breaker_blocking_after_1_failures" }],
  };

  const out = await runDaemon("mothership", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => controlState,
    getControlStateActionFn: () => "pause",
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      tickCalls.push(true);
      return { exitCode: 0, tickIdle: false, runId: "run-1", tickLogPath: path.join(repoRoot, "tick.log") };
    },
    sleepFn: async () => {},
    nowFn: () => new Date(nowIso),
  });

  assert.equal(out.ticks, 1);
  assert.equal(tickCalls.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].reason, "circuit_breaker_cooldown_auto_retry");
  assert.equal(writes[0].nextState.action_state.pause.active, false);
  assert.equal(writes[0].nextState.action_state.resume.active, true);
});

test("evaluateCircuitBreakerCooldown returns shouldRetry=false for non-circuit-breaker pauses", () => {
  const result = evaluateCircuitBreakerCooldown({
    reason: "operator_requested_pause",
    notes: [{ at: "2026-03-19T03:00:00.000Z", actor: "operator", action: "pause", reason: "operator_requested_pause" }],
    now: new Date("2026-03-20T00:00:00.000Z"),
  });
  assert.equal(result.shouldRetry, false);
});

test("classifyTickFailureTombstone derives graduated severity from tick evidence", () => {
  const blocking = classifyTickFailureTombstone({
    runtime: {
      factoryId: "mothership",
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      supervisorGraph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    },
    tickId: "tick-1",
    runId: "run-1",
    exitCode: 1,
    evidenceText: "Error: Cannot find module '@hatch/factory-ops'",
  });
  assert.equal(blocking.classification.severity, "blocking");
  assert.equal(blocking.classification.crash_type, "module_not_found");
  assert.equal(blocking.classification.resolution_type, "trip_and_route_foreman");

  const degrading = classifyTickFailureTombstone({
    runtime: {
      factoryId: "example-trading",
      targetRepo: "example-org/example-trading",
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      supervisorGraph: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
    },
    tickId: "tick-2",
    runId: "run-2",
    exitCode: 1,
    evidenceText: "pnpm test:pre-commit-gates failed in canonical checkout",
  });
  assert.equal(degrading.classification.severity, "degrading");
  assert.equal(degrading.classification.crash_type, "build_or_test_failure");
  assert.equal(degrading.classification.classification, "local");

  const informational = classifyTickFailureTombstone({
    runtime: {
      factoryId: "mothership",
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
      supervisorGraph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    },
    tickId: "tick-3",
    runId: "run-3",
    exitCode: 1,
    evidenceText: "wave-judge-failure reviewer could not reach consensus",
  });
  assert.equal(informational.classification.severity, "informational");
  assert.equal(informational.classification.crash_type, "judge_failure");
  assert.equal(informational.classification.resolution_type, "log");
});

test("runDaemon skips tick when host intent is disabled and never reads control state", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const sleepCalls = [];
  let controlStateReadCount = 0;

  const runtime = makeScannerRuntime(repoRoot);

  const out = await runDaemon("example-scanner", {
    repoRoot,
    hostBaseDir,
    maxTicks: 2,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readHostFactoryIntentFn: () => ({
      enabled: false,
      disabled_reason: "maintenance",
      disabled_at: "2026-03-23T10:00:00.000Z",
    }),
    readControlStateFn: () => {
      controlStateReadCount++;
      return { action_state: {} };
    },
    getControlStateActionFn: () => "none",
    runGitPullFn: () => { throw new Error("git pull must not run when intent disabled"); },
    runRecoverySweepFn: () => { throw new Error("recovery sweep must not run when intent disabled"); },
    runInstallAndBuildFn: () => { throw new Error("install must not run when intent disabled"); },
    runTickFn: async () => { throw new Error("tick must not run when intent disabled"); },
    sleepFn: async (ms) => { sleepCalls.push(ms); },
  });

  assert.equal(out.ticks, 0, "no ticks should run when intent disabled");
  assert.equal(out.loops, 2, "loop count should reflect iterations");
  assert.equal(controlStateReadCount, 0, "control state should never be read when intent disabled");
  assert.deepEqual(sleepCalls, [IDLE_SLEEP_BASE_MS], "should sleep idle between disabled checks");
});

test("runDaemon runs tick normally when host intent is enabled", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const tickCalls = [];

  const runtime = makeScannerRuntime(repoRoot);

  const out = await runDaemon("example-scanner", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readHostFactoryIntentFn: () => ({ enabled: true }),
    readControlStateFn: () => ({ action_state: {} }),
    getControlStateActionFn: () => "none",
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      tickCalls.push(true);
      return { exitCode: 0, tickIdle: false, runId: "run-1", tickLogPath: path.join(repoRoot, "tick.log") };
    },
    sleepFn: async () => {},
  });

  assert.equal(out.ticks, 1, "tick should run when intent enabled");
  assert.equal(tickCalls.length, 1, "exactly one tick call");
});
