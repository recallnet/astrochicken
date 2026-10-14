import { HOST_PATHS } from "./external-lifecycle.fixture.ts";
import { BASE_INPUT } from "./external-lifecycle.fixture.ts";
import { assertStableLifecycle } from "./external-lifecycle.fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_LIFECYCLE_REASON,
  runExternalFactoryLifecycleGate,
} from "../../src/commands/supervisor-external-factory-lifecycle.ts";




function readyGate(overrides = {}) {
  return {
    ok: true,
    can_resume: true,
    reason: "ready_to_resume",
    local_factory_release_after: "2.0.0",
    manifest_release: { tag: "v2.0.0", sha: "123abc" },
    rollout_gate: { reason: "release_promoted", rollout_status: "promoted" },
    ...overrides,
  };
}

test("runExternalFactoryLifecycleGate respects operator pause state before resume checks", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    readExternalFactoryControlStateFn: () => ({
      action_state: {
        pause: { active: true },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      reason: "maintenance window",
    }),
    ensureResumeReadyFn: () => {
      throw new Error("ensureResumeReadyFn should not be called when paused");
    },
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.OPERATOR_PAUSED,
  });
});

test("runExternalFactoryLifecycleGate respects operator quarantine state before resume checks", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    readExternalFactoryControlStateFn: () => ({
      action_state: {
        pause: { active: false },
        quarantine: { active: true },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      reason: "cooldown active",
    }),
    ensureResumeReadyFn: () => {
      throw new Error("ensureResumeReadyFn should not be called when quarantined");
    },
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.OPERATOR_QUARANTINED,
  });
});

test("runExternalFactoryLifecycleGate fails closed with manifest_ambiguous when release state is ambiguous", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    blockedItems: [{ issue_number: 1504 }],
    ensureResumeReadyFn: () => ({
      ok: false,
      can_resume: false,
      reason: "manifest_schema_mismatch",
      manifest_release: { tag: "v1.0.0", sha: "abc123" },
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS,
  });
  assert.equal(out.reason_code, EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS);
  assert.equal(out.manifest_id, "v1.0.0");
});

test("runExternalFactoryLifecycleGate returns rollout_blocked when release rollout guard blocks resume", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "release_not_promoted_to_general",
      rollout_gate: { reason: "release_not_promoted_to_general" },
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.ROLLOUT_BLOCKED,
  });
});

test("runExternalFactoryLifecycleGate returns self_update_failed when self-update attempt fails", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "factory_release_below_required",
      attempted_self_update: true,
      self_update_ok: false,
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.SELF_UPDATE_FAILED,
  });
});

test("runExternalFactoryLifecycleGate returns rejected_upstream when manifest status is rejected", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "rejected_upstream",
      status: "rejected",
      blockerRef: "#4242",
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "rejected_upstream",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM,
  });
  assert.equal(out.blockerRef, "#4242");
});

test("runExternalFactoryLifecycleGate returns rejected_upstream when manifest status is superseded", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "rejected_upstream",
      status: "superseded",
      blockerRef: "#5000",
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "rejected_upstream",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM,
  });
  assert.equal(out.blockerRef, "#5000");
});

test("runExternalFactoryLifecycleGate returns verification_failed when release verification remains unsatisfied after self-update", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "factory_release_below_required",
      attempted_self_update: true,
      self_update_ok: true,
      local_factory_release_after: "1.2.0",
      manifest_release: { tag: "v1.3.0", sha: "def456" },
      rollout_gate: { reason: "release_promoted" },
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.VERIFICATION_FAILED,
  });
});

test("runExternalFactoryLifecycleGate returns ready_to_resume after successful restart + health verification", async () => {
  let restartCalled = 0;
  let healthCalled = 0;

  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    requireRestart: true,
    ensureResumeReadyFn: () => readyGate(),
    resolveHostPathsFn: () => ({ ...HOST_PATHS }),
    hostRestartFn: async () => {
      restartCalled += 1;
      return { ok: true, status: "restarted", message: "factory_host_started", pid: 4242 };
    },
    hostHealthFn: () => {
      healthCalled += 1;
      return { ok: true, status: "running", running: true, pid: 4242 };
    },
  });

  assert.equal(restartCalled, 1);
  assert.equal(healthCalled, 1);
  assertStableLifecycle(out, {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
  assert.equal(out.resume_metadata.version, "2.0.0");
  assert.equal(out.manifest_id, "v2.0.0");
});

test("runExternalFactoryLifecycleGate returns restart_failed when host restart fails", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    requireRestart: true,
    ensureResumeReadyFn: () => readyGate(),
    resolveHostPathsFn: () => ({ ...HOST_PATHS }),
    hostRestartFn: async () => ({
      ok: false,
      status: "restart_failed",
      message: "factory_host_process_not_running",
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "restart_failed",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.HOST_RESTART_FAILED,
  });
});

test("runExternalFactoryLifecycleGate returns restart_failed when host health check fails after restart", async () => {
  const out = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    requireRestart: true,
    ensureResumeReadyFn: () => readyGate(),
    resolveHostPathsFn: () => ({ ...HOST_PATHS }),
    hostRestartFn: async () => ({
      ok: true,
      status: "restarted",
      message: "factory_host_started",
      pid: 999,
    }),
    hostHealthFn: () => ({
      ok: true,
      status: "stopped",
      running: false,
      pid: 0,
    }),
  });

  assertStableLifecycle(out, {
    lifecycle_state: "restart_failed",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.HOST_HEALTH_FAILED,
  });
});
