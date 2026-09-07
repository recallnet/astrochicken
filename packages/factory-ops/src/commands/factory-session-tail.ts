import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  findLatestSessionLog,
  listRunIds,
  readRunState,
  renderSessionLine,
  selectTargetRun,
} from "../lib/factory-session-log.ts";

function readSessionLines(sessionPath) {
  let raw = "";
  try { raw = readFileSync(sessionPath, "utf8"); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean);
}

function normalizeChildRole(value = "") {
  const role = String(value || "").trim().toLowerCase();
  if (["coder", "reviewer", "manager", "judge"].includes(role)) return role;
  return "";
}

function rolePriority(role = "") {
  if (role === "reviewer") return 4;
  if (role === "coder") return 3;
  if (role === "manager") return 2;
  if (role === "judge") return 1;
  return 0;
}

function parseActiveChildren(state = {}) {
  const activeChildrenRaw = state.activeChildren && typeof state.activeChildren === "object"
    ? state.activeChildren
    : {};
  const out = [];
  for (const [entryKey, value] of Object.entries(activeChildrenRaw)) {
    if (!value || typeof value !== "object") continue;
    const childRunDir = String(value.childRunDir || value.child_run_dir || "").trim();
    const runId = String(value.childRunId || value.child_run_id || (childRunDir ? childRunDir.split("/").pop() : "") || "").trim();
    const parentNodeId = String(value.parentNodeId || value.parent_node_id || entryKey).trim();
    const childId = String(value.childId || value.child_id || (parentNodeId && runId ? `${parentNodeId}__${runId}` : entryKey)).trim();
    const role = normalizeChildRole(value.role);
    out.push({
      childId,
      parentNodeId,
      runId,
      role,
      traceKind: String(value.traceKind || value.trace_kind || role || "run").trim() || "run",
      status: String(value.status || "running").trim().toLowerCase(),
      sessionId: String(value.sessionId || value.session_id || "").trim(),
      workerIndex: Number.isFinite(Number(value.workerIndex ?? value.worker_index)) ? Number(value.workerIndex ?? value.worker_index) : null,
    });
  }
  return out;
}

function selectChildMetadata(state, statesByRunId) {
  const children = parseActiveChildren(state)
    .filter((child) => child.runId && statesByRunId.has(child.runId));
  if (!children.length) return null;

  children.sort((a, b) => {
    const aRun = statesByRunId.get(a.runId) || {};
    const bRun = statesByRunId.get(b.runId) || {};
    const aRunning = String(a.status || "") === "running" && String(aRun.status || "") === "running" ? 1 : 0;
    const bRunning = String(b.status || "") === "running" && String(bRun.status || "") === "running" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    const roleDelta = rolePriority(b.role) - rolePriority(a.role);
    if (roleDelta !== 0) return roleDelta;
    const aUpdated = Date.parse(String(aRun.updatedAt || ""));
    const bUpdated = Date.parse(String(bRun.updatedAt || ""));
    const aMs = Number.isFinite(aUpdated) ? aUpdated : 0;
    const bMs = Number.isFinite(bUpdated) ? bUpdated : 0;
    if (aMs !== bMs) return bMs - aMs;
    return String(a.childId || "").localeCompare(String(b.childId || ""));
  });

  return children[0] || null;
}

function resolveTargetRunState({ runsDir, runId }) {
  const states = listRunIds(runsDir)
    .map((id) => readRunState(runsDir, id))
    .filter(Boolean);
  const targetRunId = selectTargetRun(states, runId);
  if (!targetRunId) return { ok: false, error: "no_runs_found" };
  const state = states.find((row) => row?.runId === targetRunId) || readRunState(runsDir, targetRunId);
  if (!state) return { ok: false, error: "run_not_found", run_id: targetRunId };
  const statesByRunId = new Map(states.filter((row) => row?.runId).map((row) => [row.runId, row]));
  return { ok: true, run_id: targetRunId, state, statesByRunId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function factorySessionTail({
  runsDir = ".hatch/runs",
  runId = "",
  lines = 20,
  follow = false,
  pollMs = 1000,
  stdout = process.stdout,
} = {}) {
  const target = resolveTargetRunState({ runsDir, runId });
  if (!target.ok) return target;

  const selectedChild = selectChildMetadata(target.state, target.statesByRunId || new Map());
  const traceRunId = selectedChild?.runId || target.run_id;
  const traceState = (target.statesByRunId && target.statesByRunId.get(traceRunId))
    || (traceRunId === target.run_id ? target.state : readRunState(runsDir, traceRunId))
    || target.state;
  const childMetadata = selectedChild
    ? {
      childId: selectedChild.childId,
      parentNodeId: selectedChild.parentNodeId,
      role: selectedChild.role,
      traceKind: selectedChild.traceKind,
      workerIndex: selectedChild.workerIndex,
      sessionId: selectedChild.sessionId,
    }
    : undefined;

  const sessionLog = findLatestSessionLog(traceState, {
    runSessionsDir: join(runsDir, traceRunId, "sessions"),
    childMetadata,
  });
  if (!sessionLog) {
    stdout.write(`session_log_not_found run_id=${traceRunId}\n`);
    return {
      ok: false,
      error: "session_log_not_found",
      run_id: traceRunId,
      child_id: selectedChild?.childId || "",
    };
  }

  stdout.write(`session_log=${sessionLog}\n`);
  let printed = 0;
  let previousSize = 0;

  const printNewLines = () => {
    const allLines = readSessionLines(sessionLog);
    const start = printed === 0 ? Math.max(0, allLines.length - Math.max(1, Number(lines) || 20)) : printed;
    for (let idx = start; idx < allLines.length; idx++) {
      stdout.write(`${renderSessionLine(allLines[idx])}\n`);
    }
    printed = allLines.length;
    try { previousSize = statSync(sessionLog).size; } catch { previousSize = 0; }
  };

  printNewLines();
  if (!follow) {
    return {
      ok: true,
      run_id: traceRunId,
      session_log: sessionLog,
      child_id: selectedChild?.childId || "",
      parent_run_id: target.run_id,
    };
  }

  while (true) {
    await sleep(Math.max(100, Number(pollMs) || 1000));
    let currentSize = 0;
    try {
      currentSize = statSync(sessionLog).size;
    } catch {
      return {
        ok: true,
        run_id: traceRunId,
        session_log: sessionLog,
        child_id: selectedChild?.childId || "",
        parent_run_id: target.run_id,
      };
    }
    if (currentSize < previousSize) {
      printed = 0;
    }
    if (currentSize !== previousSize) printNewLines();
  }
}
