import { promises as fsPromises } from "node:fs";
import path from "node:path";

import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  parseJsonSafe,
  toArray,
} from "./types.ts";

const ALIGNMENT_SUMMARY_FILE = "alignment-summary.json";
const RUN_STATE_FILE = "state.json";
const GUARD_EVENTS_FILE = "guard-events.jsonl";
const GUARD_DIR = "guard";

async function readJsonFile(filePath, readFileFn) {
  try {
    const raw = await readFileFn(filePath, "utf8");
    const parsed = parseJsonSafe(raw, null);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "invalid_json", value: null };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, error: "missing", value: null };
    }
    return { ok: false, error: String(error?.message || error), value: null };
  }
}

async function readGuardEvents(filePath, readFileFn) {
  try {
    const raw = await readFileFn(filePath, "utf8");
    const events = String(raw || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseJsonSafe(line, null))
      .filter(Boolean);
    return { ok: true, events };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, missing: true, events: [] };
    }
    return { ok: false, missing: false, error: String(error?.message || error), events: [] };
  }
}

function dirNames(entries) {
  return toArray(entries)
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && entry.name) {
        if (typeof entry.isDirectory === "function" && !entry.isDirectory()) return "";
        return String(entry.name);
      }
      return "";
    })
    .filter(Boolean);
}

// Pre-filter buffer: include dirs modified up to 2h before window start
// to account for runs that started just before the window but updated within it.
const MTIME_BUFFER_MS = 2 * 60 * 60 * 1000;

async function filterDirsByMtime(runsDir, runDirs, windowStartMs, statFn) {
  const lowerBound = windowStartMs - MTIME_BUFFER_MS;
  const eligible = [];
  for (const runId of runDirs) {
    try {
      const stats = await statFn(path.join(runsDir, runId));
      if (stats.mtimeMs >= lowerBound) {
        eligible.push(runId);
      }
    } catch {
      // If stat fails, include the directory to avoid silent data loss.
      eligible.push(runId);
    }
  }
  return eligible;
}

export async function collectRunsArtifacts({
  windowStart,
  windowEnd,
  runsDir = path.resolve(process.cwd(), ".hatch/runs"),
  readFileFn = fsPromises.readFile.bind(fsPromises),
  readdirFn = fsPromises.readdir.bind(fsPromises),
  statFn = (dirPath) => fsPromises.stat(dirPath),
} = {}) {
  let payload;
  try {
    payload = createCollectorEnvelope({ source: "runs_artifacts", windowStart, windowEnd });
  } catch (error) {
    return {
      source: "runs_artifacts",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{ reason: MissingDataReason.WINDOW_INVALID, detail: String(error?.message || error) }],
      runs: [],
      counts: { total_runs: 0, runs_in_window: 0, guarded_runs: 0 },
      guard_incidents: [],
    };
  }

  let allRunDirs = [];
  try {
    allRunDirs = dirNames(await readdirFn(runsDir, { withFileTypes: true }));
  } catch (error) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, ".hatch/runs directory unavailable", {
      path: runsDir,
      error: String(error?.message || error),
    });
    return finalizeCollectorEnvelope({
      ...payload,
      runs: [],
      counts: { total_runs: 0, runs_in_window: 0, guarded_runs: 0 },
      guard_incidents: [],
    });
  }

  // Pre-filter by directory mtime to avoid reading state.json for thousands of old runs.
  const runDirs = await filterDirsByMtime(runsDir, allRunDirs, payload._windowMs.startMs, statFn);

  const runs = [];
  const guardIncidents = [];

  for (const runId of runDirs) {
    const runPath = path.join(runsDir, runId);
    const statePath = path.join(runPath, RUN_STATE_FILE);

    const stateResult = await readJsonFile(statePath, readFileFn);
    if (!stateResult.ok) {
      continue;
    }

    const state = stateResult.value || {};
    const startedAt = String(state?.startedAt || "").trim();
    const updatedAt = String(state?.updatedAt || startedAt || "").trim();
    const inWindowRange = inWindow(startedAt, payload._windowMs.startMs, payload._windowMs.endMs)
      || inWindow(updatedAt, payload._windowMs.startMs, payload._windowMs.endMs);
    if (!inWindowRange) continue;

    const alignmentPath = path.join(runPath, ALIGNMENT_SUMMARY_FILE);
    const alignmentResult = await readJsonFile(alignmentPath, readFileFn);
    if (!alignmentResult.ok && alignmentResult.error === "missing") {
      addMissingData(payload, MissingDataReason.FILE_MISSING, "alignment summary missing", {
        run_id: runId,
        path: alignmentPath,
      });
    }

    const guardEventsPath = path.join(runPath, GUARD_EVENTS_FILE);
    const guardEventsResult = await readGuardEvents(guardEventsPath, readFileFn);
    if (!guardEventsResult.ok && guardEventsResult.missing) {
      addMissingData(payload, MissingDataReason.FILE_MISSING, "guard events file missing", {
        run_id: runId,
        path: guardEventsPath,
      });
    }

    const guardDirPath = path.join(runPath, GUARD_DIR);
    let guardArtifacts = [];
    try {
      guardArtifacts = dirNames(await readdirFn(guardDirPath, { withFileTypes: true }));
    } catch (error) {
      if (error?.code === "ENOENT") {
        addMissingData(payload, MissingDataReason.FILE_MISSING, "guard artifact directory missing", {
          run_id: runId,
          path: guardDirPath,
        });
      } else {
        addMissingData(payload, MissingDataReason.COMMAND_FAILED, "failed reading guard artifact directory", {
          run_id: runId,
          path: guardDirPath,
          error: String(error?.message || error),
        });
      }
    }

    const guardState = state?.guard && typeof state.guard === "object" ? state.guard : {};
    const guardStatus = String(guardState?.circuitState || "");
    const guardReasonCode = String(guardState?.reasonCode || "");

    const runSummary = {
      run_id: String(state?.runId || runId),
      status: String(state?.status || "unknown"),
      pipeline: String(state?.pipelineFile || state?.pipeline || ""),
      current_node: String(state?.currentNode || ""),
      started_at: startedAt,
      updated_at: updatedAt,
      alignment_status: String(alignmentResult.value?.status || ""),
      guard_status: guardStatus,
      guard_reason_code: guardReasonCode,
      guard_events_count: toArray(guardEventsResult.events).length,
      guard_artifacts_count: guardArtifacts.length,
    };
    runs.push(runSummary);

    if (guardStatus === "open" || guardStatus === "terminal") {
      guardIncidents.push({
        run_id: runSummary.run_id,
        guard_status: guardStatus,
        guard_reason_code: guardReasonCode,
        source: "state.guard",
      });
    }

    for (const event of toArray(guardEventsResult.events)) {
      const kind = String(event?.kind || "");
      if (!kind.startsWith("guard.")) continue;
      guardIncidents.push({
        run_id: runSummary.run_id,
        guard_status: String(event?.data?.circuit_state || guardStatus || "unknown"),
        guard_reason_code: String(event?.data?.reason_code || guardReasonCode || ""),
        source: "guard-events.jsonl",
      });
    }
  }

  return finalizeCollectorEnvelope({
    ...payload,
    runs,
    counts: {
      total_runs: runs.length,
      runs_in_window: runs.length,
      guarded_runs: runs.filter((run) => run.guard_status === "open" || run.guard_status === "terminal").length,
    },
    guard_incidents: guardIncidents,
  });
}
