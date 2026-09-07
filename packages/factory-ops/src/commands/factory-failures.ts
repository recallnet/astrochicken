import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseJson } from "../lib/cli-helpers.ts";


function readState(runDir) {
  try {
    return parseJson(readFileSync(join(runDir, "state.json"), "utf8"), null);
  } catch {
    return null;
  }
}

function summarizeFailure(state = {}) {
  const records = Array.isArray(state.records) ? state.records : [];
  const failedRecord = [...records].reverse().find((r) => r?.status === "failed") || null;
  const failedOutcomeRecord = [...records].reverse().find((r) => r?.outcome?.status === "failed") || null;
  const activeChildren = Object.entries(state.activeChildren || {}).map(([nodeId, c]) => ({
    node_id: nodeId,
    status: String(c?.status || ""),
    child_run_dir: String(c?.childRunDir || ""),
    child_pipeline: String(c?.pipelineFile || ""),
    child_node: String(c?.currentNode || ""),
  }));

  const source = failedOutcomeRecord || failedRecord;
  return {
    failed_node: String(source?.nodeId || state.currentNode || ""),
    error: String(source?.outcome?.error || ""),
    outcome_status: String(source?.outcome?.status || ""),
    active_children: activeChildren,
  };
}

export function listRecentFailures({ runsDir = ".hatch/runs", limit = 10 } = {}) {
  let entries = [];
  try { entries = readdirSync(runsDir); } catch { return []; }

  const failed = [];
  for (const id of entries) {
    const state = readState(join(runsDir, id));
    if (!state) continue;
    const status = String(state.status || "");
    if (status !== "failed" && status !== "suspended") continue;

    failed.push({
      run_id: String(state.runId || id),
      pipeline: String(state.pipeline || state.pipelineFile || ""),
      current_node: String(state.currentNode || ""),
      updated_at: String(state.updatedAt || ""),
      started_at: String(state.startedAt || ""),
      ...summarizeFailure(state),
    });
  }

  failed.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return failed.slice(0, Math.max(1, Number(limit) || 10));
}
