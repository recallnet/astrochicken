import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach, mock } from "node:test";

import {
  DEFAULT_DAEMON_LEASE_TTL_SEC,
  acquireLease,
  readCurrentLease,
  releaseLease,
  renewLease,
  renewLeaseOrPause,
  resolveDaemonLeaseTtl,
} from "../../src/lib/daemon-lease.ts";
import { ACTIVE_SLEEP_MS, runDaemon } from "../../src/lib/daemon.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-lease-unit-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRuntime(repoRoot) {
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
    mutationContext: {
      instance_id: "brainstorm",
    },
  };
}

function makeLeaseFixture() {
  const root = makeTmpDir();
  return {
    root,
    paths: { hostRoot: root, tmpDir: path.join(root, "tmp") },
    runtime: makeRuntime(root),
  };
}

function successfulDaemonLeaseOptions(runtime) {
  return {
      resolveTickRuntimeFn: () => runtime,
      evaluateStartupInvariantFn: () => ({ ok: true }),
      readControlStateFn: () => ({ action_state: {}, reason: "" }),
      getControlStateActionFn: () => "none",
      resolveLeaseTtlFn: () => ({ ttlSec: 60, source: "test" }),
      acquireLeaseFn: () => ({
        ok: true,
        reason: "lease_acquired",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          host_id: "host_a",
          lease_expires_at: "2026-03-16T10:01:00.000Z",
        },
      }),
  };
}

afterEach(() => {
  mock.restoreAll();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test("acquireLease enforces single-owner mutual exclusion with lease_active/split_brain", () => {
  const { paths, runtime } = makeLeaseFixture();

  const first = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:00.000Z"),
    env: {
      HATCH_HOST_ID: "host_a",
      HATCH_FACTORY_ID: "brainstorm",
    },
  });

  assert.equal(first.ok, true);
  assert.equal(first.reason, "lease_acquired");
  assert.equal(first.lease.host_id, "host_a");

  const sameOwner = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:20.000Z"),
    env: {
      HATCH_HOST_ID: "host_a",
      HATCH_FACTORY_ID: "brainstorm",
    },
  });

  assert.equal(sameOwner.ok, false);
  assert.equal(sameOwner.reason, "lease_active");

  const competingHost = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:20.000Z"),
    env: {
      HATCH_HOST_ID: "host_b",
      HATCH_FACTORY_ID: "brainstorm",
    },
  });

  assert.equal(competingHost.ok, false);
  assert.equal(competingHost.reason, "split_brain");
});

test("acquireLease reclaims an unexpired same-host lease when the recorded pid is dead", () => {
  const { paths, runtime } = makeLeaseFixture();
  const env = {
    HATCH_HOST_ID: "host_a",
    HATCH_FACTORY_ID: "brainstorm",
  };

  const acquired = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:00.000Z"),
    env,
  });
  assert.equal(acquired.ok, true);

  const leaseRecordPath = path.join(paths.tmpDir, "lease.json");
  const persisted = JSON.parse(readFileSync(leaseRecordPath, "utf8"));
  persisted.pid = 424242;
  persisted.lease_expires_at = "2026-03-16T10:01:00.000Z";
  writeFileSync(leaseRecordPath, `${JSON.stringify(persisted, null, 2)}\n`);

  const reclaimed = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:10.000Z"),
    env,
    isPidAliveFn: () => false,
  });

  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.reason, "lease_acquired");
  assert.equal(reclaimed.current.pid, 424242);
  assert.equal(reclaimed.lease.host_id, "host_a");
});

test("renewLease extends lease_expires_at deterministically", () => {
  const { paths, runtime } = makeLeaseFixture();
  const env = {
    HATCH_HOST_ID: "host_a",
    HATCH_FACTORY_ID: "brainstorm",
  };

  const acquired = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:00.000Z"),
    env,
  });
  assert.equal(acquired.ok, true);

  const renewed = renewLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:30.000Z"),
    env,
  });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.reason, "lease_renewed");
  assert.equal(renewed.lease.lease_expires_at, "2026-03-16T10:01:30.000Z");

  const loaded = readCurrentLease({ paths });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.lease.lease_expires_at, "2026-03-16T10:01:30.000Z");
});

test("resolveDaemonLeaseTtl uses config then env then default", () => {
  const fromConfig = resolveDaemonLeaseTtl({ config: { lease_ttl_sec: 77 }, env: { HATCH_LEASE_TTL_SEC: "55" } });
  assert.deepEqual(fromConfig, { ttlSec: 77, source: "config" });

  const fromEnv = resolveDaemonLeaseTtl({ config: {}, env: { HATCH_LEASE_TTL_SEC: "55" } });
  assert.deepEqual(fromEnv, { ttlSec: 55, source: "env" });

  const fallback = resolveDaemonLeaseTtl({ config: {}, env: {} });
  assert.deepEqual(fallback, { ttlSec: 60, source: "default" });
});

test("releaseLease fails closed when caller identity does not match persisted lease", () => {
  const { paths, runtime } = makeLeaseFixture();

  const acquired = acquireLease({
    runtime,
    paths,
    ttlSec: 60,
    nowMs: Date.parse("2026-03-16T10:00:00.000Z"),
    env: {
      HATCH_HOST_ID: "host_a",
      HATCH_FACTORY_ID: "brainstorm",
    },
  });
  assert.equal(acquired.ok, true);

  const denied = releaseLease({
    runtime,
    paths,
    env: {
      HATCH_HOST_ID: "host_b",
      HATCH_FACTORY_ID: "brainstorm",
    },
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "split_brain");
});

test("runDaemon signal shutdown forwards releaseLeaseFn into terminate helper", async () => {
  const repoRoot = makeTmpDir("daemon-lease-signal-");
  const hostBaseDir = makeTmpDir("daemon-lease-signal-host-");
  const runtime = makeRuntime(repoRoot);
  const signalHandlers = new Map();
  const terminateCalls = [];

  const originalOn = process.on;
  const originalExit = process.exit;
  process.on = ((event, handler) => {
    signalHandlers.set(String(event), handler);
    return process;
  });
  process.exit = (() => undefined);

  try {
    const daemonPromise = runDaemon("brainstorm", {
      repoRoot,
      hostBaseDir,
      ...successfulDaemonLeaseOptions(runtime),
      renewLeaseFn: () => ({
        ok: true,
        reason: "lease_renewed",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          lease_expires_at: "2026-03-16T10:02:00.000Z",
        },
      }),
      releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
      terminateActiveChildAndExitFn: async (input) => {
        terminateCalls.push(input);
      },
      runGitPullFn: () => {},
      runRecoverySweepFn: () => {},
      runInstallAndBuildFn: () => {},
      runTickFn: async () => ({
        exitCode: 0,
        tickIdle: false,
        runId: "run-1",
        tickLogPath: path.join(repoRoot, "tick.log"),
      }),
      sleepFn: async () => {},
      maxTicks: 1,
    });

    const sigtermHandler = signalHandlers.get("SIGTERM");
    assert.equal(typeof sigtermHandler, "function");
    sigtermHandler();

    await daemonPromise;

    assert.equal(terminateCalls.length >= 1, true);
    assert.equal(typeof terminateCalls[0].leaseReleaseFn, "function");
    const release = terminateCalls[0].leaseReleaseFn({ runtime, paths: { tmpDir: path.join(repoRoot, "tmp") } });
    assert.equal(release.ok, true);
    assert.equal(release.reason, "lease_released");
  } finally {
    process.on = originalOn;
    process.exit = originalExit;
  }
});

test("runDaemon renews the lease while a long-running tick is still active", async () => {
  const repoRoot = makeTmpDir("daemon-lease-heartbeat-");
  const hostBaseDir = makeTmpDir("daemon-lease-heartbeat-host-");
  const runtime = makeRuntime(repoRoot);
  let runTickStarted = false;
  let renewalsDuringTick = 0;
  let resolveTick;

  const tickPromise = new Promise((resolve) => {
    resolveTick = resolve;
  });

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    ...successfulDaemonLeaseOptions(runtime),
    renewLeaseFn: () => {
      if (runTickStarted) {
        renewalsDuringTick += 1;
      }
      if (renewalsDuringTick === 1) {
        resolveTick({
          exitCode: 0,
          tickIdle: false,
          runId: "run-heartbeat",
          tickLogPath: path.join(repoRoot, "tick-heartbeat.log"),
        });
      }
      return {
        ok: true,
        reason: "lease_renewed",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          lease_expires_at: "2026-03-16T10:02:00.000Z",
        },
      };
    },
    releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      runTickStarted = true;
      return tickPromise;
    },
    runScheduledJobsFn: async () => {},
    sleepFn: async () => {},
    maxTicks: 1,
  });

  assert.equal(out.ok, true);
  assert.equal(renewalsDuringTick >= 1, true);
});

test("runDaemon renews lease before inter-tick sleep to prevent expiry", async () => {
  const repoRoot = makeTmpDir("daemon-lease-pre-sleep-");
  const hostBaseDir = makeTmpDir("daemon-lease-pre-sleep-host-");
  const runtime = makeRuntime(repoRoot);

  // Track the sequence of events to verify a renewal happens after scheduled
  // jobs but before the daemon exits/sleeps.  The heartbeat sleepFn fires
  // many times during the tick, so we use a phase counter instead.
  let phase = "pre-tick";     // pre-tick → tick → post-tick
  let renewalCount = 0;
  let postTickRenewals = 0;

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    ...successfulDaemonLeaseOptions(runtime),
    renewLeaseFn: () => {
      renewalCount += 1;
      if (phase === "post-tick") {
        postTickRenewals += 1;
      }
      return {
        ok: true,
        reason: "lease_renewed",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          lease_expires_at: "2026-03-16T10:02:00.000Z",
        },
      };
    },
    releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      phase = "tick";
      return {
        exitCode: 0,
        tickIdle: false,
        runId: "run-pre-sleep",
        tickLogPath: path.join(repoRoot, "tick.log"),
      };
    },
    runScheduledJobsFn: async () => {
      phase = "post-tick";
    },
    sleepFn: async () => {},
  });

  assert.equal(out.ok, true);
  assert.equal(out.ticks, 1);

  // The pre-sleep lease renewal must fire at least once after the tick and
  // scheduled jobs complete (phase === "post-tick").
  assert.ok(
    postTickRenewals >= 1,
    `expected >=1 lease renewal after scheduled jobs, got ${postTickRenewals} (total renewals: ${renewalCount})`,
  );
});

test("runDaemon renews lease between synchronous pre-tick operations", async () => {
  const repoRoot = makeTmpDir("daemon-lease-pretick-");
  const hostBaseDir = makeTmpDir("daemon-lease-pretick-host-");
  const runtime = makeRuntime(repoRoot);

  // Track which pre-tick ops ran and how many renewals happened between them.
  const ops = [];
  let renewalCount = 0;

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {}, reason: "" }),
    getControlStateActionFn: () => "none",
    resolveLeaseTtlFn: () => ({ ttlSec: 60, source: "test" }),
    acquireLeaseFn: () => ({
      ok: true, reason: "lease_acquired",
      lease: { lease_owner: "t:1:brainstorm:managed_daemon_lease", host_id: "t", lease_expires_at: "2099-01-01T00:00:00Z" },
    }),
    renewLeaseFn: () => {
      renewalCount += 1;
      ops.push(`renew_${renewalCount}`);
      return { ok: true, reason: "lease_renewed", lease: { lease_owner: "t:1:brainstorm:managed_daemon_lease", lease_expires_at: "2099-01-01T00:00:00Z" } };
    },
    releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
    runGitPullFn: () => { ops.push("git_pull"); },
    runRecoverySweepFn: () => { ops.push("recovery_sweep"); },
    runInstallAndBuildFn: () => { ops.push("install_build"); },
    runTickFn: async () => ({ exitCode: 0, tickIdle: false, runId: "r1", tickLogPath: path.join(repoRoot, "t.log") }),
    runScheduledJobsFn: async () => {},
    sleepFn: async () => {},
  });

  assert.equal(out.ok, true);
  // Verify: git_pull → renew → recovery_sweep → renew → install_build (in that order).
  const pullIdx = ops.indexOf("git_pull");
  const sweepIdx = ops.indexOf("recovery_sweep");
  const installIdx = ops.indexOf("install_build");
  const renewBetweenPullAndSweep = ops.slice(pullIdx + 1, sweepIdx).some((o) => o.startsWith("renew_"));
  const renewBetweenSweepAndInstall = ops.slice(sweepIdx + 1, installIdx).some((o) => o.startsWith("renew_"));
  assert.ok(renewBetweenPullAndSweep, `expected lease renewal between git_pull and recovery_sweep, ops: ${ops.join(",")}`);
  assert.ok(renewBetweenSweepAndInstall, `expected lease renewal between recovery_sweep and install_build, ops: ${ops.join(",")}`);
});

test("ACTIVE_SLEEP_MS must be shorter than lease TTL to survive inter-tick sleep", () => {
  const ttlMs = DEFAULT_DAEMON_LEASE_TTL_SEC * 1000;
  assert.ok(
    ACTIVE_SLEEP_MS < ttlMs,
    `ACTIVE_SLEEP_MS (${ACTIVE_SLEEP_MS}) must be < lease TTL (${ttlMs}) so the lease survives inter-tick sleep`,
  );
});

test("runDaemon pauses and skips tick when lease renewal fails", async () => {
  const repoRoot = makeTmpDir("daemon-lease-loop-");
  const hostBaseDir = makeTmpDir("daemon-lease-loop-host-");
  const runtime = makeRuntime(repoRoot);
  const writes = [];
  const tickCalls = [];

  let now = 1_000_000;
  mock.method(Date, "now", () => {
    now += 1_100;
    return now;
  });

  let acquireCalls = 0;
  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {}, reason: "" }),
    getControlStateActionFn: () => "none",
    runGitPullFn: () => {
      throw new Error("runGitPull must not run when lease is lost");
    },
    runRecoverySweepFn: () => {
      throw new Error("runRecoverySweep must not run when lease is lost");
    },
    runInstallAndBuildFn: () => {
      throw new Error("runInstallAndBuild must not run when lease is lost");
    },
    runTickFn: async () => {
      tickCalls.push(true);
      return {
        exitCode: 0,
        tickIdle: false,
        runId: "run-should-not-happen",
        tickLogPath: path.join(repoRoot, "tick.log"),
      };
    },
    writeControlStateFn: (input) => {
      writes.push(input);
      return { version: writes.length, ...input.nextState };
    },
    resolveLeaseTtlFn: () => ({ ttlSec: 1, source: "test" }),
    acquireLeaseFn: () => {
      acquireCalls += 1;
      if (acquireCalls === 1) {
        return {
          ok: true,
          reason: "lease_acquired",
          lease: {
            lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
            host_id: "host_a",
            lease_expires_at: "2026-03-16T10:00:59.000Z",
          },
        };
      }
      return {
        ok: false,
        reason: "lease_missing",
        detail: "reacquire_denied",
        current: null,
      };
    },
    renewLeaseFn: () => ({
      ok: false,
      reason: "lease_stale",
      detail: "lease_expired",
      current: {
        lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
      },
    }),
    releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
    sleepFn: async () => {},
  });

  assert.equal(out.ticks, 0);
  assert.equal(tickCalls.length, 0);
  assert.equal(writes.length >= 1, true);
  assert.equal(writes[0].reason, "lease_lost");
  assert.equal(writes[0].nextState.reason, "lease_lost");
  assert.equal(writes[0].nextState.action_state.pause.active, true);

  const daemonLogPath = path.join(hostBaseDir, "brainstorm", "logs", "daemon.log");
  const daemonLog = readFileSync(daemonLogPath, "utf8");
  assert.match(daemonLog, /tick_skip lease_missing/);
  assert.match(daemonLog, /lease_renew_failed/);
});

test("renewLeaseOrPause reacquires expired lease instead of pausing when same owner", () => {
  const logs = [];
  const writes = [];
  const runtime = { factoryId: "brainstorm" };
  const paths = { tmpDir: "/tmp/lease-reacquire-test" };

  // Simulate: renewLease fails with lease_stale (our own lease expired),
  // but acquireLease succeeds (expired lease, same owner, no contention).
  const result = renewLeaseOrPause({
    leaseHeld: true,
    nextLeaseRenewAtMs: 0,
    runtime,
    paths,
    ttlSec: 60,
    leaseRenewLeadMs: 30_000,
    nowMs: Date.parse("2026-03-16T10:01:10.000Z"),
    controlState: { action_state: {} },
    repoRoot: "/tmp",
    renewLeaseFn: () => ({
      ok: false,
      reason: "lease_stale",
      detail: "lease_expired",
      current: {
        lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
        lease_expires_at: "2026-03-16T10:01:00.000Z",
      },
    }),
    acquireLeaseFn: () => ({
      ok: true,
      reason: "lease_acquired",
      lease: {
        lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
        lease_expires_at: "2026-03-16T10:02:10.000Z",
      },
    }),
    writeControlStateFn: (input) => {
      writes.push(input);
      return { version: 1 };
    },
    buildClearedActionStateFn: (s) => s,
    appendLogLineFn: (p, msg) => logs.push(msg),
    daemonLogPath: "/tmp/daemon.log",
  });

  // The lease should be reacquired — NOT paused.
  assert.equal(result.leaseHeld, true, "lease must be held after reacquire");
  assert.equal(result.paused, false, "must not pause when reacquire succeeds");
  assert.equal(writes.length, 0, "must not write lease_lost to control state");
  assert.ok(logs.some((l) => l.includes("lease_reacquire_ok")), `expected reacquire log, got: ${logs.join(" | ")}`);
});

test("renewLeaseOrPause pauses when reacquire also fails (split brain)", () => {
  const logs = [];
  const writes = [];
  const runtime = { factoryId: "brainstorm" };
  const paths = { tmpDir: "/tmp/lease-reacquire-fail-test" };

  const result = renewLeaseOrPause({
    leaseHeld: true,
    nextLeaseRenewAtMs: 0,
    runtime,
    paths,
    ttlSec: 60,
    leaseRenewLeadMs: 30_000,
    nowMs: Date.parse("2026-03-16T10:01:10.000Z"),
    controlState: { action_state: {} },
    repoRoot: "/tmp",
    renewLeaseFn: () => ({
      ok: false,
      reason: "lease_stale",
      detail: "lease_expired",
      current: {
        lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
        lease_expires_at: "2026-03-16T10:01:00.000Z",
      },
    }),
    acquireLeaseFn: () => ({
      ok: false,
      reason: "split_brain",
      detail: "identity_mismatch",
      current: null,
    }),
    writeControlStateFn: (input) => {
      writes.push(input);
      return { version: 1 };
    },
    buildClearedActionStateFn: (s) => s,
    appendLogLineFn: (p, msg) => logs.push(msg),
    daemonLogPath: "/tmp/daemon.log",
  });

  // Reacquire failed — should fall through to pause.
  assert.equal(result.leaseHeld, false, "lease must not be held");
  assert.equal(result.paused, true, "must pause when reacquire fails");
  assert.equal(writes.length, 1, "must write lease_lost to control state");
  assert.equal(writes[0].reason, "lease_lost");
});

test("runDaemon self-recovers from lease_stale by reacquiring instead of permanent pause", async () => {
  const repoRoot = makeTmpDir("daemon-lease-self-recover-");
  const hostBaseDir = makeTmpDir("daemon-lease-self-recover-host-");
  const runtime = makeRuntime(repoRoot);
  const tickCalls = [];

  let renewCallCount = 0;
  let acquireCallCount = 0;

  const out = await runDaemon("brainstorm", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({ action_state: {}, reason: "" }),
    getControlStateActionFn: () => "none",
    resolveLeaseTtlFn: () => ({ ttlSec: 60, source: "test" }),
    acquireLeaseFn: () => {
      acquireCallCount += 1;
      return {
        ok: true,
        reason: "lease_acquired",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          host_id: "host_a",
          lease_expires_at: "2099-01-01T00:00:00Z",
        },
      };
    },
    renewLeaseFn: () => {
      renewCallCount += 1;
      // First renewal (after git pull) succeeds, second (after recovery sweep) fails
      // simulating a long recovery sweep that expired the lease.
      if (renewCallCount <= 2) {
        return {
          ok: true,
          reason: "lease_renewed",
          lease: {
            lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
            lease_expires_at: "2099-01-01T00:00:00Z",
          },
        };
      }
      // Third renewal (after recovery sweep): lease expired
      if (renewCallCount === 3) {
        return {
          ok: false,
          reason: "lease_stale",
          detail: "lease_expired",
          current: {
            lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          },
        };
      }
      // Subsequent renewals succeed (after reacquire)
      return {
        ok: true,
        reason: "lease_renewed",
        lease: {
          lease_owner: "host_a:123:brainstorm:managed_daemon_lease",
          lease_expires_at: "2099-01-01T00:00:00Z",
        },
      };
    },
    releaseLeaseFn: () => ({ ok: true, reason: "lease_released", released: true }),
    writeControlStateFn: () => ({ version: 1 }),
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      tickCalls.push(true);
      return {
        exitCode: 0,
        tickIdle: false,
        runId: "run-recovered",
        tickLogPath: path.join(repoRoot, "tick.log"),
      };
    },
    runScheduledJobsFn: async () => {},
    sleepFn: async () => {},
  });

  // The daemon should have recovered and run the tick despite the mid-loop lease expiry.
  assert.equal(out.ok, true, "daemon should complete successfully");
  assert.equal(out.ticks, 1, "daemon should run exactly 1 tick");
  assert.equal(tickCalls.length, 1, "tick must have executed");
  // acquireLease called at startup + once for reacquire
  assert.ok(acquireCallCount >= 2, `expected >=2 acquire calls (startup + reacquire), got ${acquireCallCount}`);
});
