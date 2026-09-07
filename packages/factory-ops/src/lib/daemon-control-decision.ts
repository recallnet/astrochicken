function trim(value = "") {
  return String(value || "").trim();
}

export function evaluateDaemonControlStateAction({ stateAction = "", reason = "" } = {}) {
  const action = trim(stateAction).toLowerCase();
  const normalizedReason = trim(reason);

  if (action === "pause") {
    return {
      action,
      reason: normalizedReason,
      mode: "skip",
      shouldRunTick: false,
      shouldSleepIdle: true,
      shouldStop: false,
      shouldClearState: false,
      logReason: "paused",
    };
  }

  if (action === "quarantine") {
    return {
      action,
      reason: normalizedReason,
      mode: "skip",
      shouldRunTick: false,
      shouldSleepIdle: true,
      shouldStop: false,
      shouldClearState: false,
      logReason: "quarantined",
    };
  }

  if (action === "draining") {
    return {
      action,
      reason: normalizedReason,
      mode: "drain_stop",
      shouldRunTick: false,
      shouldSleepIdle: false,
      shouldStop: true,
      shouldClearState: false,
      logReason: "draining",
    };
  }

  if (action === "resume") {
    return {
      action,
      reason: normalizedReason,
      mode: "run",
      shouldRunTick: true,
      shouldSleepIdle: false,
      shouldStop: false,
      shouldClearState: false,
      logReason: action,
    };
  }

  if (action === "retry") {
    return {
      action,
      reason: normalizedReason,
      mode: "clear_and_run",
      shouldRunTick: true,
      shouldSleepIdle: false,
      shouldStop: false,
      shouldClearState: true,
      logReason: action,
    };
  }

  return {
    action: action || "none",
    reason: normalizedReason,
    mode: "run",
    shouldRunTick: true,
    shouldSleepIdle: false,
    shouldStop: false,
    shouldClearState: false,
    logReason: action || "none",
  };
}
