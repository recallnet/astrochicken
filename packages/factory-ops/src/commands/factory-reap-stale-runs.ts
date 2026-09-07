import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Scan .hatch/runs/ for stale runs (status=running but updatedAt older than threshold).
 * Mark them as failed. Returns structured results for the supervisor LLM.
 */
export function reapStaleRuns({ runsDir = ".hatch/runs", staleMinutes = 20, dryRun = false } = {}) {
  const threshold = Number(staleMinutes) || 20;
  const now = Date.now();
  const cutoff = now - threshold * 60 * 1000;
  const reaped = [];
  const stalled = [];

  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return { reaped: [], stalled: [], count: 0, stalled_count: 0, dryRun, error: "runs_dir_not_found" };
  }

  for (const entry of entries) {
    const statePath = join(runsDir, entry.name, "state.json");
    let state;
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      continue;
    }

    if (state.status !== "running") continue;

    const updatedAt = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
    // Fall back to startedAt when nodeStartedAt is missing (pre-fix runs)
    const nodeStartedAt = (state.nodeStartedAt || state.startedAt)
      ? new Date((state.nodeStartedAt || state.startedAt)).getTime()
      : 0;

    // Only fail closed when heartbeat ownership is stale or missing.
    // Long-running nodes with fresh heartbeats are surfaced as stalled so
    // operators can inspect them without killing healthy builds.
    const staleByUpdate = updatedAt > 0 && updatedAt < cutoff;
    const missingHeartbeat = updatedAt <= 0;
    const staleByNode = nodeStartedAt > 0 && nodeStartedAt < cutoff;
    const shouldReap = staleByUpdate || (missingHeartbeat && staleByNode);
    const shouldReportStalled = !shouldReap && staleByNode;
    if (!shouldReap && !shouldReportStalled) continue;

    const ageMinutes = Math.round((now - updatedAt) / 60000);
    const info = {
      runId: state.runId || entry.name,
      pipeline: state.pipelineFile || state.pipeline || "",
      currentNode: state.currentNode || "",
      ageMinutes,
      updatedAt: state.updatedAt || "",
    };

    if (shouldReportStalled) {
      stalled.push(info);
      continue;
    }

    reaped.push(info);

    if (!dryRun) {
      state.status = "failed";
      state.updatedAt = new Date().toISOString();
      try {
        writeFileSync(statePath, JSON.stringify(state, null, 2));
      } catch {
        // best-effort
      }
    }
  }

  return { reaped, stalled, count: reaped.length, stalled_count: stalled.length, dryRun };
}
