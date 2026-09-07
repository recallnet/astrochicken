function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export async function runWithLeaseHeartbeat({
  taskFn = async () => ({}),
  heartbeatIntervalMs = 1_000,
  sleepFn = sleep,
  onHeartbeatFn = async () => ({ leaseHeld: true }),
} = {}) {
  let settled = false;
  let heartbeatOutcome = { leaseHeld: true };

  const taskPromise = (async () => taskFn())()
    .finally(() => {
      settled = true;
    });

  const heartbeatPromise = (async () => {
    while (!settled) {
      await sleepFn(heartbeatIntervalMs);
      if (settled) break;
      heartbeatOutcome = await onHeartbeatFn();
      if (heartbeatOutcome?.leaseHeld === false) break;
    }
    return heartbeatOutcome;
  })();

  const [taskResult, finalHeartbeatOutcome] = await Promise.all([taskPromise, heartbeatPromise]);
  return {
    taskResult,
    heartbeatOutcome: finalHeartbeatOutcome,
  };
}
