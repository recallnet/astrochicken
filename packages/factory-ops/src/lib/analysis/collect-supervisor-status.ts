import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  parseJsonSafe,
  toArray,
} from "./types.ts";

const execFileAsync = promisify(execFile);

function parseJsonOutput(raw = "") {
  const direct = parseJsonSafe(raw, null);
  if (direct && typeof direct === "object") return direct;

  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonSafe(lines[index], null);
    if (parsed && typeof parsed === "object") return parsed;
  }

  return null;
}

function extractRuns(statusPayload = {}) {
  const candidates = [
    statusPayload?.runs,
    statusPayload?.active,
    statusPayload?.active_runs,
    statusPayload?.items,
    statusPayload?.data?.runs,
    statusPayload?.data?.active,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractTicks(tickPayload = {}) {
  const candidates = [
    tickPayload?.ticks,
    tickPayload?.recent_ticks,
    tickPayload?.data?.ticks,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  if (tickPayload?.current_tick && typeof tickPayload.current_tick === "object") {
    return [tickPayload.current_tick, ...toArray(tickPayload?.recent_ticks)];
  }

  return [];
}

function toIsoCandidate(row = {}) {
  return String(
    row?.updated_at
      || row?.updatedAt
      || row?.started_at
      || row?.startedAt
      || row?.created_at
      || row?.createdAt
      || "",
  ).trim();
}

export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

export async function defaultExecFile(command, args) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: DEFAULT_EXEC_TIMEOUT_MS,
  });
}

export async function collectSupervisorStatus({
  windowStart,
  windowEnd,
  execFileFn = defaultExecFile,
} = {}) {
  let payload;
  try {
    payload = createCollectorEnvelope({ source: "supervisor_status", windowStart, windowEnd });
  } catch (error) {
    return {
      source: "supervisor_status",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{ reason: MissingDataReason.WINDOW_INVALID, detail: String(error?.message || error) }],
      runs: [],
      ticks: [],
      counts: { active_runs: 0, active_ticks: 0, guard_activations: 0 },
    };
  }

  let statusJson = null;
  let ticksJson = null;

  try {
    const statusOut = await Promise.resolve(execFileFn("hatch-ops", ["factory", "status", "--json"]));
    statusJson = parseJsonOutput(statusOut?.stdout || "");
    if (!statusJson) {
      addMissingData(payload, MissingDataReason.PARSE_ERROR, "factory status output was not JSON", {
        command: "hatch-ops factory status --json",
      });
    }
  } catch (error) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "factory status command unavailable", {
      command: "hatch-ops factory status --json",
      error: String(error?.message || error),
    });
  }

  try {
    const ticksOut = await Promise.resolve(execFileFn("hatch-ops", ["factory", "tick-status", "--json"]));
    ticksJson = parseJsonOutput(ticksOut?.stdout || "");
    if (!ticksJson) {
      addMissingData(payload, MissingDataReason.PARSE_ERROR, "factory tick-status output was not JSON", {
        command: "hatch-ops factory tick-status --json",
      });
    }
  } catch (error) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "factory tick-status command unavailable", {
      command: "hatch-ops factory tick-status --json",
      error: String(error?.message || error),
    });
  }

  const runs = extractRuns(statusJson)
    .filter((row) => inWindow(toIsoCandidate(row), payload._windowMs.startMs, payload._windowMs.endMs))
    .map((row) => ({
      run_id: String(row?.run_id || row?.runId || row?.id || ""),
      status: String(row?.status || "unknown"),
      node: String(row?.node || row?.current_node || row?.currentNode || ""),
      updated_at: toIsoCandidate(row),
    }));

  const ticks = extractTicks(ticksJson)
    .filter((row) => inWindow(toIsoCandidate(row), payload._windowMs.startMs, payload._windowMs.endMs))
    .map((row) => ({
      run_id: String(row?.run_id || row?.runId || row?.id || ""),
      status: String(row?.status || "unknown"),
      stage: String(row?.stage || row?.node || ""),
      updated_at: toIsoCandidate(row),
    }));

  const guardActivations = runs.filter((run) => {
    const status = run.status.toLowerCase();
    return status === "guarded" || status === "guarded_terminal" || status === "suspended";
  }).length;

  return finalizeCollectorEnvelope({
    ...payload,
    runs,
    ticks,
    counts: {
      active_runs: runs.length,
      active_ticks: ticks.length,
      guard_activations: guardActivations,
    },
  });
}
