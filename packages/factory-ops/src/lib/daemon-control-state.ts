import {
  applyCanonicalFactoryControlActionSync,
  buildClearedActionState,
  readCanonicalFactoryControlStateSync,
} from "./canonical-control-state.ts";

export { buildClearedActionState };

export function resumeDaemonControlState({
  factoryId = "",
  repoRoot = process.cwd(),
  reason = "operator_resume",
  actor = "daemon",
  nowIso = new Date().toISOString(),
  readControlStateFn = readCanonicalFactoryControlStateSync,
  applyControlActionFn = applyCanonicalFactoryControlActionSync,
  writeControlStateFn = null,
} = {}) {
  const current = readControlStateFn({
    factoryId,
    rootDir: repoRoot,
  });

  void nowIso;
  if (typeof writeControlStateFn === "function") {
    const nextActionState = buildClearedActionState(current?.action_state || {});
    nextActionState.resume = {
      ...(nextActionState.resume && typeof nextActionState.resume === "object" ? nextActionState.resume : {}),
      active: true,
      at: nowIso,
    };
    return writeControlStateFn({
      factoryId,
      rootDir: repoRoot,
      actor,
      reason,
      nextState: {
        action_state: nextActionState,
        reason: "active",
        retry_target: "",
      },
    });
  }

  return applyControlActionFn({
    action: "resume",
    factoryId,
    rootDir: repoRoot,
    actor,
    reason,
  });
}
