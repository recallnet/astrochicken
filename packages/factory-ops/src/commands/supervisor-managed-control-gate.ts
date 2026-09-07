import {
  getCanonicalControlActiveAction,
  readCanonicalFactoryControlStateSync,
} from "../lib/canonical-control-state.ts";
import { trim } from "../lib/cli-helpers.ts";

function normalizeAction(value = "") {
  return trim(value).toLowerCase();
}

export function evaluateManagedControlGate({ stateAction = "", reason = "" } = {}) {
  const action = normalizeAction(stateAction);
  const normalizedReason = trim(reason);

  if (action === "pause" || action === "quarantine") {
    return {
      control_gate: "paused",
      control_state_action: action,
      control_state_reason: normalizedReason,
      should_run: "false",
    };
  }

  if (action === "draining") {
    return {
      control_gate: "draining",
      control_state_action: action,
      control_state_reason: normalizedReason,
      should_run: "false",
    };
  }

  return {
    control_gate: "run",
    control_state_action: action || "none",
    control_state_reason: normalizedReason,
    should_run: "true",
  };
}

export function evaluateManagedControlStateGate({
  factoryId = "",
  rootDir = process.cwd(),
  readControlStateFn = readCanonicalFactoryControlStateSync,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    return {
      control_gate: "run",
      control_state_action: "none",
      control_state_reason: "",
      should_run: "true",
      parse_error: "missing_factory_id",
      state_path: "",
    };
  }

  try {
    const state = readControlStateFn({ factoryId: normalizedFactoryId, rootDir });
    const activeAction = getCanonicalControlActiveAction(state);
    const evaluated = evaluateManagedControlGate({ stateAction: activeAction, reason: state?.reason || "" });
    return {
      ...evaluated,
      parse_error: "",
      state_path: trim(state?.state_path || ""),
    };
  } catch (error) {
    return {
      control_gate: "run",
      control_state_action: "none",
      control_state_reason: "",
      should_run: "true",
      parse_error: String(error?.message || error || "control_state_read_failed"),
      state_path: "",
    };
  }
}
