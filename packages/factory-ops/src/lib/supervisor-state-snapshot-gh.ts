import { ghJsonPaginatedWithOptions, ghJsonWithOptions } from "./cli-helpers.ts";
import { listGoalSubIssues } from "../commands/goal-sub-issues.ts";

const DEFAULT_SNAPSHOT_GH_TIMEOUT_MS = 5_000;

function resolveSnapshotGhTimeoutMs(env = process.env) {
  const raw = String(env?.HATCH_GH_TIMEOUT_MS || "").trim();
  if (!raw) return DEFAULT_SNAPSHOT_GH_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SNAPSHOT_GH_TIMEOUT_MS;
}

function createSnapshotGhJsonFn({ timeoutMs = DEFAULT_SNAPSHOT_GH_TIMEOUT_MS } = {}) {
  return (args, fallback) => ghJsonWithOptions(args, fallback, {
    timeout: timeoutMs,
    // @context:regression !critical Snapshot generation must fail closed when GH stalls; otherwise the
    // supervisor pins in snapshot_state_fast and the factory appears alive while making zero progress.
    killSignal: "SIGKILL",
  });
}

function createSnapshotGhPaginatedFn({ timeoutMs = DEFAULT_SNAPSHOT_GH_TIMEOUT_MS } = {}) {
  return (apiPath, fallback) => ghJsonPaginatedWithOptions(apiPath, fallback, {
    timeout: timeoutMs,
    // @context:regression !critical Goal sub-issue expansion must obey the same timeout budget
    // as direct GH reads; otherwise snapshot_state_fast can still wedge in paginated sub-issue fetches.
    killSignal: "SIGKILL",
  });
}

export function resolveSnapshotGitHubReaders({
  ghJsonFn,
  ghPaginatedFn,
  listGoalSubIssuesFn = listGoalSubIssues,
  env = process.env,
} = {}) {
  const snapshotGhTimeoutMs = resolveSnapshotGhTimeoutMs(env);
  const resolvedGhPaginatedFn = typeof ghPaginatedFn === "function"
    ? ghPaginatedFn
    : createSnapshotGhPaginatedFn({ timeoutMs: snapshotGhTimeoutMs });
  const resolvedGhJsonFn = typeof ghJsonFn === "function"
    ? ghJsonFn
    : createSnapshotGhJsonFn({ timeoutMs: snapshotGhTimeoutMs });
  const resolvedListGoalSubIssuesFn = typeof listGoalSubIssuesFn === "function" && listGoalSubIssuesFn !== listGoalSubIssues
    ? listGoalSubIssuesFn
    : ((args = {}) => listGoalSubIssues({
      ...args,
      ghPaginatedFn: resolvedGhPaginatedFn,
    }));
  return {
    ghJsonFn: resolvedGhJsonFn,
    ghPaginatedFn: resolvedGhPaginatedFn,
    listGoalSubIssuesFn: resolvedListGoalSubIssuesFn,
  };
}
