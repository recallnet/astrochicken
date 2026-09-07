import { trim } from "../lib/cli-helpers.ts";

export function classifyManagedLifecycleState({
  controlGate = "",
  hasOpenUpstreamBugs = "false",
  hasActionItems = "false",
  hasSelectedWork = "false",
  hasDomainFailure = "false",
} = {}) {
  const gate = trim(controlGate);
  if (gate === "paused") return { lifecycle_state: "paused", health_state: "paused" };
  if (gate === "draining") return { lifecycle_state: "draining", health_state: "draining" };

  if (trim(hasOpenUpstreamBugs) === "true") {
    return { lifecycle_state: "blocked_platform", health_state: "blocked_platform" };
  }

  if (trim(hasActionItems) === "true") {
    return { lifecycle_state: "blocked_local", health_state: "blocked_local" };
  }

  if (trim(hasDomainFailure) === "true") {
    return { lifecycle_state: "degraded", health_state: "degraded" };
  }

  if (trim(hasSelectedWork) === "true") {
    return { lifecycle_state: "active", health_state: "active" };
  }

  return { lifecycle_state: "idle", health_state: "idle" };
}
