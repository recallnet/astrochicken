import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function parseIsoMs(value = "") {
  if (!value) return Number.NaN;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function findRunEndMs(state = {}) {
  const candidates = [
    state?.completedAt,
    state?.finishedAt,
    state?.endedAt,
    state?.updatedAt,
    state?.updated_at,
  ];

  for (const candidate of candidates) {
    const parsed = parseIsoMs(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function findRunDurationMs(state = {}, endMs = Number.NaN) {
  const directCandidates = [
    state?.durationMs,
    state?.duration_ms,
    state?.elapsedMs,
    state?.elapsed_ms,
    state?.context?.durationMs,
    state?.context?.duration_ms,
    state?.context?.elapsedMs,
    state?.context?.elapsed_ms,
  ];

  for (const candidate of directCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const startedMs = parseIsoMs(state?.startedAt || state?.createdAt || state?.created_at);
  if (Number.isFinite(startedMs) && Number.isFinite(endMs) && endMs > startedMs) {
    return endMs - startedMs;
  }

  return Number.NaN;
}

function isWaveExecuteState(state = {}) {
  const pipeline = String(state?.pipeline || state?.pipelineFile || state?.graph?.label || "").toLowerCase();
  return pipeline.includes("wave_execute");
}

function isMergedWave(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  const mergeStatus = String(
    context?.wave_merge_status
    || context?.merge_status
    || state?.merge_status
    || "",
  ).trim().toLowerCase();

  if (mergeStatus === "merged" || mergeStatus === "already_merged") return true;

  const mergedCount = Number(
    context?.merged_count
    ?? context?.mergedCount
    ?? state?.merged_count
    ?? state?.mergedCount
    ?? 0,
  );

  if (Number.isFinite(mergedCount) && mergedCount > 0) return true;

  const status = String(state?.status || "").trim().toLowerCase();
  return status === "completed" && mergeStatus === "" && mergedCount > 0;
}

function roundTwo(value = 0) {
  return Number((Number(value) || 0).toFixed(2));
}

export function collectWaveTimingMetadata({
  factoryId = "",
  sinceIso = "",
  nowIso = "",
  hatchRoot = ".hatch",
  existsSyncFn = existsSync,
  readdirSyncFn = readdirSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const normalizedFactoryId = String(factoryId || "").trim();
  if (!normalizedFactoryId) {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: 0,
      degraded: true,
      reason: "factory_id_missing",
    };
  }

  const sinceMs = parseIsoMs(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: 0,
      degraded: true,
      reason: "invalid_since_iso",
    };
  }

  const nowMs = nowIso ? parseIsoMs(nowIso) : Date.now();
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  const runsDir = join(String(hatchRoot || ".hatch"), normalizedFactoryId, "runs");
  if (!existsSyncFn(runsDir)) {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: 0,
      degraded: true,
      reason: "runs_dir_missing",
    };
  }

  let entries = [];
  try {
    entries = readdirSyncFn(runsDir, { withFileTypes: true });
  } catch {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: 0,
      degraded: true,
      reason: "runs_dir_unreadable",
    };
  }

  const runIds = entries
    .filter((entry) => (entry?.isDirectory ? entry.isDirectory() : true))
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (runIds.length === 0) {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: 0,
      degraded: true,
      reason: "runs_empty",
    };
  }

  const durations = [];
  let mergedWaveCount = 0;

  for (const runId of runIds) {
    const statePath = join(runsDir, runId, "state.json");
    let state;
    try {
      state = parseJson(readFileSyncFn(statePath, "utf8"), null);
    } catch {
      continue;
    }
    if (!state || typeof state !== "object") continue;
    if (!isWaveExecuteState(state)) continue;

    const endMs = findRunEndMs(state);
    if (!Number.isFinite(endMs) || endMs < sinceMs || endMs > safeNowMs) continue;
    if (!isMergedWave(state)) continue;

    mergedWaveCount += 1;

    const durationMs = findRunDurationMs(state, endMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
    durations.push(durationMs);
  }

  if (durations.length === 0) {
    return {
      avg_wave_minutes: 0,
      sample_count: 0,
      merged_wave_count: mergedWaveCount,
      degraded: true,
      reason: mergedWaveCount > 0 ? "wave_duration_missing" : "no_merged_waves_in_window",
    };
  }

  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);

  return {
    avg_wave_minutes: roundTwo(totalDurationMs / durations.length / 60_000),
    sample_count: durations.length,
    merged_wave_count: mergedWaveCount,
    degraded: false,
    reason: null,
  };
}
