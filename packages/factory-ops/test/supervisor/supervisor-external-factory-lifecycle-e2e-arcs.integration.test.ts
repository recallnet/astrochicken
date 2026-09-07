import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_LIFECYCLE_REASON,
  runExternalFactoryLifecycleGate,
} from "../../src/commands/supervisor-external-factory-lifecycle.ts";

const BASE_INPUT = Object.freeze({
  controlPlaneRepo: "recallnet/astrochicken",
  sourceRepo: "example/external-factory",
  sourceIssueNumber: 1504,
});

function assertStableLifecycle(out, { lifecycle_state, resume_allowed, reason }) {
  assert.deepEqual(
    {
      lifecycle_state: out.lifecycle_state,
      resume_allowed: out.resume_allowed,
      reason: out.reason,
    },
    {
      lifecycle_state,
      resume_allowed,
      reason,
    },
  );
}

function readInactiveControlState() {
  return {
    action_state: {
      pause: { active: false },
      quarantine: { active: false },
      retry: { active: false },
      unblock: { active: false },
      resume: { active: false },
    },
  };
}

test("Arc 1 — local defect fixed locally transitions waiting_for_release -> ready_to_resume", async () => {
  const firstTick = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: false,
      can_resume: false,
      reason: "manifest_schema_mismatch",
      manifest_release: { tag: "v1.0.0", sha: "abc123" },
    }),
  });

  assertStableLifecycle(firstTick, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.MANIFEST_AMBIGUOUS,
  });

  const secondTick = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      local_factory_release_after: "2.0.0",
      manifest_release: { tag: "v2.0.0", sha: "123abc" },
      rollout_gate: { reason: "release_promoted", rollout_status: "promoted" },
    }),
  });

  assertStableLifecycle(secondTick, {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
});

test("Arc 2 — control-plane escalation transitions rejected_upstream -> waiting_for_release -> ready_to_resume", async () => {
  const escalated = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: false,
      can_resume: false,
      reason: "rejected_upstream",
      status: "rejected",
      blockerRef: "#9999",
    }),
  });

  assertStableLifecycle(escalated, {
    lifecycle_state: "rejected_upstream",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM,
  });
  assert.equal(escalated.blockerRef, "#9999");

  const waitingForRollout = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: false,
      reason: "release_not_promoted_to_general",
      rollout_gate: { reason: "release_not_promoted_to_general" },
    }),
  });

  assertStableLifecycle(waitingForRollout, {
    lifecycle_state: "waiting_for_release",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.ROLLOUT_BLOCKED,
  });

  const resumed = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      local_factory_release_after: "2.1.0",
      manifest_release: { tag: "v2.1.0", sha: "def456" },
      rollout_gate: { reason: "release_promoted", rollout_status: "promoted" },
    }),
  });

  assertStableLifecycle(resumed, {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
});

test("Arc 3 — superseded upstream transitions rejected_upstream -> ready_to_resume", async () => {
  const superseded = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: false,
      can_resume: false,
      reason: "rejected_upstream",
      status: "superseded",
      blockerRef: "#5000",
    }),
  });

  assertStableLifecycle(superseded, {
    lifecycle_state: "rejected_upstream",
    resume_allowed: false,
    reason: EXTERNAL_LIFECYCLE_REASON.REJECTED_UPSTREAM,
  });
  assert.equal(superseded.blockerRef, "#5000");

  const resumed = await runExternalFactoryLifecycleGate({
    ...BASE_INPUT,
    readExternalFactoryControlStateFn: readInactiveControlState,
    ensureResumeReadyFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      local_factory_release_after: "3.0.0",
      manifest_release: { tag: "v3.0.0", sha: "fff000" },
      rollout_gate: { reason: "release_promoted", rollout_status: "promoted" },
    }),
  });

  assertStableLifecycle(resumed, {
    lifecycle_state: "ready_to_resume",
    resume_allowed: true,
    reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
  });
});
