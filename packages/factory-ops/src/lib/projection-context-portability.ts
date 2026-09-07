import { normalizeFactoryContext } from "./factory-context-resolver.ts";

export function overlayInvocationFactoryContext({
  projection = {},
  context = {},
  runsDirFallback = "",
} = {}) {
  const projectionRecord = projection && typeof projection === "object" ? { ...projection } : {};
  const projectionContext = projectionRecord.context && typeof projectionRecord.context === "object"
    ? projectionRecord.context
    : {};
  const invocationContext = context && typeof context === "object" ? context : {};

  const normalizedContext = normalizeFactoryContext({
    ...projectionContext,
    ...invocationContext,
  }, { runsDirFallback });

  return {
    ...projectionRecord,
    context: {
      // @context:regression !critical Canonical projections are cached by
      // factory_id, but factory_root/factory_config_path/runs_dir are
      // invocation-scoped for portability probes and external layouts. Always
      // overlay the caller's resolved context so a fresh CLI spawn cannot reuse
      // a stale temp-root context from an earlier projection read.
      ...projectionContext,
      ...invocationContext,
      ...normalizedContext,
    },
  };
}
