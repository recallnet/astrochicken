import { HOST_PATHS } from "./external-lifecycle.fixture.ts";
import { BASE_INPUT } from "./external-lifecycle.fixture.ts";
import { readInactiveControlState } from "./external-lifecycle.fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_LIFECYCLE_REASON,
  runExternalFactoryLifecycleGate,
} from "../../src/commands/supervisor-external-factory-lifecycle.ts";




function stableCrashTuple(out) {
  return {
    lifecycle_state: out.lifecycle_state,
    resume_allowed: out.resume_allowed,
    reason: out.reason,
    reason_code: out.reason_code,
  };
}

test("Arc 4 — crash while blocked on upstream preserves blocked-wait idempotency", async () => {
  const blockedWaitArgs = {
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: false,
      can_resume: false,
      reason: "manifest_schema_mismatch",
      manifest_release: { tag: "v1.0.0" },
    }),
  };

  const first = await runExternalFactoryLifecycleGate(blockedWaitArgs);
  const second = await runExternalFactoryLifecycleGate(blockedWaitArgs);

  assert.deepEqual(stableCrashTuple(first), {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS,
    reason_code: EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS,
  });
  assert.deepEqual(stableCrashTuple(second), stableCrashTuple(first));
});

test("Arc 5 — crash during host restart rejects once, then next tick recovers to ready_to_resume", async () => {
  await assert.rejects(
    runExternalFactoryLifecycleGate({
      ...BASE_INPUT,
      factoryId: "external/issue-worker",
      requireRestart: true,
      readExternalFactoryControlStateFn: readInactiveControlState,
      ensureResumeReadyFn: () => ({
        ok: true,
        can_resume: true,
        reason: "ready_to_resume",
        local_factory_release_after: "2.0.0",
        manifest_release: { tag: "v2.0.0", sha: "abc123" },
      }),
      resolveHostPathsFn: () => ({ ...HOST_PATHS }),
      hostRestartFn: async () => {
        throw new Error("crash_during_restart");
      },
    }),
    /crash_during_restart/,
  );

  const recovered = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    factoryId: "external/issue-worker",
    requireRestart: true,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      local_factory_release_after: "2.0.0",
      manifest_release: { tag: "v2.0.0", sha: "abc123" },
    }),
    resolveHostPathsFn: () => ({ ...HOST_PATHS }),
    hostRestartFn: async () => ({ ok: true, status: "restarted", pid: 4242 }),
    hostHealthFn: () => ({ ok: true, status: "running", running: true, pid: 4242 }),
  });

  assert.deepEqual(stableCrashTuple(recovered), {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
    reason_code: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
});

test("Arc 6 — self-update failure safely retries to ready_to_resume after manual fix", async () => {
  const failed = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    requireRestart: false,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "factory_release_below_required",
      attempted_self_update: true,
      self_update_ok: false,
    }),
  });

  assert.deepEqual(stableCrashTuple(failed), {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.SELF_UPDATE_FAILED,
    reason_code: EXTERNAL_LIFECYCLE_REASON.SELF_UPDATE_FAILED,
  });

  const recovered = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    requireRestart: false,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      attempted_self_update: true,
      self_update_ok: true,
      local_factory_release_after: "2.1.0",
      manifest_release: { tag: "v2.1.0" },
    }),
  });

  assert.deepEqual(stableCrashTuple(recovered), {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
    reason_code: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
});
