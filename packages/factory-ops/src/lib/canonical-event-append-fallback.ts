import { trim } from "./cli-helpers.ts";

export function isCanonicalAppendLockTimeout(error) {
  const message = trim(error?.message || error || "");
  const code = trim(error?.code || "");
  return code === "55P03" || /lock timeout/i.test(message);
}

export function appendCanonicalEventsWithLockTimeoutFallback({
  appendCanonicalEventsFn,
  appendArgs,
  stderr = "",
} = {}) {
  if (typeof appendCanonicalEventsFn !== "function") {
    return {
      canonicalEventCommitCursor: 0,
      canonicalEventPersistenceDeferred: false,
      stderr: String(stderr || ""),
    };
  }

  try {
    return {
      canonicalEventCommitCursor: Number(appendCanonicalEventsFn(appendArgs) || 0),
      canonicalEventPersistenceDeferred: false,
      stderr: String(stderr || ""),
    };
  } catch (error) {
    if (!isCanonicalAppendLockTimeout(error)) throw error;
    // @context:regression !critical GitHub issue mutations are already durable
    // when we append canonical events. A Postgres lock timeout here must degrade
    // to deferred canonical sync instead of replaying the irreversible mutation.
    const nextStderr = [String(stderr || "").trim(), `canonical_event_append_deferred: ${trim(error?.message || error || "")}`]
      .filter(Boolean)
      .join("\n");
    return {
      canonicalEventCommitCursor: 0,
      canonicalEventPersistenceDeferred: true,
      stderr: nextStderr,
    };
  }
}
