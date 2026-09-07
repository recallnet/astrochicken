import {
  applyCanonicalFactoryControlActionSync,
  readCanonicalFactoryControlStateSync,
} from "../lib/canonical-control-state.ts";
import {
  buildControlActionAppliedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { trim } from "../lib/cli-helpers.ts";

const CONTROL_ACTIONS = new Set(["pause", "quarantine", "retry", "unblock", "resume"]);

function errorPayload(error, fallbackCode = "control_state_error") {
  const code = trim(error?.code) || fallbackCode;
  const message = trim(error?.message) || code;
  return {
    ok: false,
    error: code,
    message,
  };
}

export function runFactoryControlAction({
  action = "",
  factoryId = "",
  reason = "",
  actor = "",
  retryTarget = "",
  expectedVersion = undefined,
  rootDir = process.cwd(),
  runId = "",
  emitDomainEventFn,
  applyControlActionFn = applyCanonicalFactoryControlActionSync,
} = {}) {
  const normalizedAction = trim(action).toLowerCase();
  const normalizedFactoryId = trim(factoryId);
  const normalizedReason = trim(reason);

  if (!normalizedAction) {
    return {
      ok: false,
      error: "missing_action",
      message: "action is required",
    };
  }

  if (!normalizedFactoryId) {
    return {
      ok: false,
      error: "missing_factory_id",
      message: "factory-id is required",
    };
  }

  if (!normalizedReason) {
    return {
      ok: false,
      error: "missing_reason",
      message: "reason is required",
    };
  }

  if (!CONTROL_ACTIONS.has(normalizedAction)) {
    return {
      ok: false,
      error: "invalid_action",
      message: `unsupported_action:${normalizedAction}`,
    };
  }

  try {
    const out = applyControlActionFn({
      action: normalizedAction,
      factoryId: normalizedFactoryId,
      reason: normalizedReason,
      actor,
      retryTarget,
      expectedVersion,
      rootDir,
    });
    const canonicalEvents = dispatchCanonicalDomainEvents({
      events: [
        buildControlActionAppliedEvent({
          factoryId: normalizedFactoryId,
          runId,
          action: normalizedAction,
          reason: normalizedReason,
          actor,
          retryTarget,
          stateVersion: out.state_version,
          stateAction: out.state_action,
          statePath: out.state_path,
        }),
      ],
      emitDomainEventFn,
    });
    return {
      ok: true,
      action: normalizedAction,
      state_version: out.state_version,
      state_path: out.state_path,
      state_action: out.state_action,
      canonical_events: canonicalEvents,
    };
  } catch (error) {
    return errorPayload(error);
  }
}

export function runFactoryControlStateRead({
  factoryId = "",
  rootDir = process.cwd(),
  readControlStateFn = readCanonicalFactoryControlStateSync,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    return {
      ok: false,
      error: "missing_factory_id",
      message: "factory-id is required",
    };
  }

  try {
    return readControlStateFn({
      factoryId: normalizedFactoryId,
      rootDir,
    });
  } catch (error) {
    return errorPayload(error, "control_state_read_failed");
  }
}
