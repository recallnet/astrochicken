import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES,
} from "./canonical-domain-events.ts";
import { resolveGraph, resolveIssue, resolveMilestone } from "./factory-status-support.ts";

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function trim(value = "") {
  return String(value || "").trim();
}

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "suspended",
  "guarded",
  "guarded_terminal",
  "blocked",
  "terminal",
]);

function isTerminalRunStatus(status = "") {
  return TERMINAL_RUN_STATUSES.has(trim(status).toLowerCase());
}

export function readProjectedRunState(runsDir = "", runId = "") {
  if (!runsDir || !runId) return null;
  const statePath = join(runsDir, runId, "state.json");
  if (!existsSync(statePath)) return null;
  return parseJson(readFileSync(statePath, "utf8"), null);
}

function emptyRun(runId = "") {
  return {
    id: runId,
    run_id: runId,
    status: "running",
    node: "",
    current_node: "",
    graph: "",
    issue: "",
    milestone: "",
    started_at: "",
    updated_at: "",
  };
}

function hasReadableProjectedRunState(diskState = null) {
  return Boolean(
    diskState
    && typeof diskState === "object"
    && Object.keys(diskState).length > 0
    && String(diskState.runId || diskState.currentNode || diskState.pipelineFile || "").trim(),
  );
}

function copyKnownStateFromDisk(run, diskState = {}) {
  const hasDiskState = diskState && typeof diskState === "object" && Object.keys(diskState).length > 0;
  const diskStatus = trim(diskState.status || "");
  const preferDiskTerminalStatus = isTerminalRunStatus(diskStatus);
  return {
    ...run,
    // @context:regression !critical Canonical event rows can lag behind the
    // local terminal run artifacts on disk. When disk state already proves a
    // run is terminal, operator projections must not keep it "running" or the
    // factory appears to burn LLM budget on ghost active work.
    status: preferDiskTerminalStatus ? diskStatus : String(run.status || ""),
    graph: hasDiskState ? String(resolveGraph(diskState) || "") : String(run.graph || ""),
    node: String(diskState.currentNode || run.node || ""),
    current_node: String(diskState.currentNode || run.current_node || ""),
    issue: hasDiskState ? String(resolveIssue(diskState) || "") : String(run.issue || ""),
    milestone: hasDiskState ? String(resolveMilestone(diskState) || "") : String(run.milestone || ""),
    started_at: hasDiskState
      ? String(diskState.startedAt || diskState.createdAt || "")
      : String(run.started_at || ""),
    updated_at: hasDiskState
      ? String(diskState.updatedAt || "")
      : String(run.updated_at || ""),
  };
}

export function projectRunsFromCanonicalRows(rows = [], runsDir = "") {
  const runs = new Map();
  let latestControlAction = null;

  for (const row of rows) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const runId = String(row.run_id || payload.run_id || "").trim();

    if (row.event_family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.CONTROL_ACTION_APPLIED) {
      latestControlAction = row;
      continue;
    }

    if (!runId) continue;
    const run = runs.get(runId) || emptyRun(runId);
    const emittedAt = String(row.emitted_at || "").trim();
    const payloadNode = String(payload.node || "").trim();
    const payloadGraph = String(payload.graph || "").trim();
    const payloadIssue = String(payload.issue || "").trim();
    const payloadMilestone = String(payload.milestone || "").trim();

    if (row.event_family === "hatch.run.started") {
      run.status = "running";
      run.started_at = emittedAt || run.started_at;
    }
    if (row.event_family === "hatch.run.node_entered") {
      run.status = "running";
      run.node = payloadNode || run.node;
      run.current_node = payloadNode || run.current_node;
    }
    if (row.event_family === "hatch.run.completed") {
      run.status = "completed";
      run.node = payloadNode || run.node;
      run.current_node = payloadNode || run.current_node;
    }
    if (row.event_family === "hatch.run.failed") {
      run.status = "failed";
      run.node = payloadNode || run.node;
      run.current_node = payloadNode || run.current_node;
    }

    run.graph = payloadGraph || run.graph;
    run.issue = payloadIssue || run.issue;
    run.milestone = payloadMilestone || run.milestone;
    run.updated_at = emittedAt || run.updated_at;
    const diskState = readProjectedRunState(runsDir, runId) || {};
    // @context:regression !critical Canonical status events can outlive local run cleanup.
    // A run without readable local state must not remain "running" in factory status,
    // or operators see ghost active work and the daemon appears to keep spending LLM
    // budget after the last real goal finished.
    if (String(run.status || "") === "running" && !hasReadableProjectedRunState(diskState)) {
      runs.delete(runId);
      continue;
    }
    runs.set(runId, copyKnownStateFromDisk(run, diskState));
  }

  return {
    runs: [...runs.values()],
    latestControlAction,
  };
}

export function buildProjectedStateFromRun(run = {}, diskState = null) {
  const state = diskState && typeof diskState === "object" ? { ...diskState } : {};
  return {
    ...state,
    runId: String(run.run_id || run.id || state.runId || ""),
    status: String(run.status || state.status || ""),
    currentNode: String(run.current_node || run.node || state.currentNode || ""),
    pipelineFile: String(state.pipelineFile || run.graph || ""),
    startedAt: String(run.started_at || state.startedAt || state.createdAt || ""),
    updatedAt: String(run.updated_at || state.updatedAt || ""),
    context: state.context && typeof state.context === "object" ? state.context : {},
  };
}
