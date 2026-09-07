import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { listPersistedPackets } from "../lib/packet-core.ts";

export const TICK_IDLE_CURSOR_SCHEMA = "tick-idle-cursor/v1";

/**
 * Determines whether the current supervisor tick is in an idle state.
 *
 * Two idle modes:
 * 1. Waves in flight, nothing new happened → idle (skip expensive LLM tail)
 * 2. No waves in flight, no external changes detected → idle
 *
 * @param {object} opts
 * @param {string|number} opts.inFlightCount  — waves currently in progress
 * @param {string|number} opts.selectedCount  — new waves dispatched this tick
 * @param {string|number} opts.stalledWaveCount — stalled waves detected
 * @param {string|number} opts.spawnSuccessCount — new wave processes spawned
 * @param {string|number} opts.openDurablePacketCount — open durable supervisor packets
 * @param {boolean} [opts.externalChangesDetected] — whether git HEAD or GitHub issues changed since last tick
 * @returns {{ tick_idle: "true"|"false", tick_idle_reason: string }}
 */
export function tickIdleCheck({
  inFlightCount = 0,
  selectedCount = 0,
  stalledWaveCount = 0,
  spawnSuccessCount = 0,
  openDurablePacketCount = 0,
  externalChangesDetected,
} = {}) {
  const inFlight = Number(inFlightCount) || 0;
  const selected = Number(selectedCount) || 0;
  const stalled = Number(stalledWaveCount) || 0;
  const spawned = Number(spawnSuccessCount) || 0;
  const openDurablePackets = Number(openDurablePacketCount) || 0;

  // Case 1: Waves in flight — idle when nothing new happened this tick
  // AND no external changes detected (e.g. a wave merge pushing to main).
  if (inFlight > 0) {
    const idle = selected === 0 && stalled === 0 && spawned === 0
      && openDurablePackets === 0 && externalChangesDetected !== true;
    if (idle) {
      return { tick_idle: "true", tick_idle_reason: `${inFlight} wave(s) in flight, no new dispatches/spawns/stalls` };
    }
    const parts = [];
    if (selected > 0) parts.push(`${selected}_new_dispatches`);
    if (stalled > 0) parts.push(`${stalled}_stalled_waves`);
    if (spawned > 0) parts.push(`${spawned}_new_spawns`);
    if (openDurablePackets > 0) parts.push(`${openDurablePackets}_open_durable_packets`);
    if (externalChangesDetected === true) parts.push("external_changes_detected");
    return { tick_idle: "false", tick_idle_reason: parts.join(",") };
  }

  // Case 2: No waves in flight — idle only when no external changes detected.
  // externalChangesDetected === undefined means caller didn't check (backward compat) => not idle.
  const hasActivity = selected > 0 || stalled > 0 || spawned > 0 || openDurablePackets > 0;

  if (externalChangesDetected === false && !hasActivity) {
    return { tick_idle: "true", tick_idle_reason: "no_waves_no_external_changes" };
  }

  const parts = ["no_waves_in_flight"];
  if (externalChangesDetected === true) parts.push("external_changes_detected");
  else if (externalChangesDetected === undefined) parts.push("external_check_not_performed");
  if (selected > 0) parts.push(`${selected}_new_dispatches`);
  if (stalled > 0) parts.push(`${stalled}_stalled_waves`);
  if (spawned > 0) parts.push(`${spawned}_new_spawns`);
  if (openDurablePackets > 0) parts.push(`${openDurablePackets}_open_durable_packets`);
  return { tick_idle: "false", tick_idle_reason: parts.join(",") };
}

export function countOpenDurablePackets({ runsDir = "", nowMs = Date.now() } = {}) {
  return listPersistedPackets({
    runsDir,
    durableOnly: true,
    packetState: "open",
    nowMs,
    windowMs: 24 * 60 * 60 * 1000,
  }).length;
}

// --- External change detection ---

function resolveCursorPath({ factoryId = "", rootDir = "." } = {}) {
  const id = String(factoryId || "default").trim();
  return join(String(rootDir || "."), ".hatch", "factories", id, "tick-idle-cursor.json");
}

function readTickIdleCursor(cursorPath) {
  if (!existsSync(cursorPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cursorPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    if (String(raw.schema || "").trim() !== TICK_IDLE_CURSOR_SCHEMA) return null;
    return {
      last_head_sha: String(raw.last_head_sha || "").trim(),
      last_checked_at: String(raw.last_checked_at || "").trim(),
    };
  } catch {
    return null;
  }
}

function writeTickIdleCursor(cursorPath, { lastHeadSha = "", factoryId = "" } = {}) {
  const now = new Date().toISOString();
  const payload = {
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: String(factoryId || "default").trim(),
    last_head_sha: String(lastHeadSha || "").trim(),
    last_checked_at: now,
    updated_at: now,
  };
  mkdirSync(dirname(cursorPath), { recursive: true });
  const tmpPath = `${cursorPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmpPath, cursorPath);
}

/**
 * Detects whether external state (git HEAD, GitHub issues) has changed since
 * the last tick. Used when inFlight === 0 to decide whether the LLM tail is needed.
 *
 * READ-ONLY: does not update the cursor. Call updateTickIdleCursor() at the
 * end of the tick (after all issue-modifying actions) to advance the cursor.
 * This prevents the supervisor's own issue modifications from triggering
 * false "external changes" on the next tick.
 *
 * Conservative: returns changes_detected=true on any error or first run.
 *
 * @param {object} opts
 * @param {string} opts.factoryId    — factory id for cursor path scoping
 * @param {string} opts.ghRepo       — GitHub owner/repo for issue query
 * @param {string} [opts.rootDir]    — repo root for cursor file (default ".")
 * @param {Function} [opts.spawnSyncFn] — injectable spawnSync for testing
 * @returns {{ changes_detected: boolean, reason: string }}
 */
export function detectExternalChanges({
  factoryId = "",
  ghRepo = "",
  rootDir = ".",
  spawnSyncFn = spawnSync,
} = {}) {
  const headResult = spawnSyncFn("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 });
  const currentHead = (headResult.status === 0) ? String(headResult.stdout || "").trim() : "";

  if (!currentHead) {
    return { changes_detected: true, reason: "git_head_unresolvable" };
  }

  const cursorPath = resolveCursorPath({ factoryId, rootDir });
  const cursor = readTickIdleCursor(cursorPath);

  if (!cursor) {
    return { changes_detected: true, reason: "no_prior_cursor" };
  }

  if (cursor.last_head_sha !== currentHead) {
    return { changes_detected: true, reason: "head_sha_changed" };
  }

  if (ghRepo && cursor.last_checked_at) {
    const issueResult = spawnSyncFn("gh", [
      "api", `repos/${ghRepo}/issues?since=${cursor.last_checked_at}&per_page=1&state=all`,
      "--jq", "length",
    ], { encoding: "utf8", timeout: 10000 });

    if (issueResult.status !== 0) {
      return { changes_detected: true, reason: "github_api_error" };
    }

    const count = Number(String(issueResult.stdout || "").trim()) || 0;
    if (count > 0) {
      return { changes_detected: true, reason: `${count}_issues_changed` };
    }
  }

  return { changes_detected: false, reason: "no_external_changes" };
}

/**
 * Updates the tick-idle cursor with current HEAD and timestamp.
 * Call at the END of every tick (after all issue-modifying actions like
 * supervisor_review) so the next tick's detectExternalChanges() compares
 * against post-action state, not mid-tick state.
 *
 * @param {object} opts
 * @param {string} opts.factoryId    — factory id for cursor path scoping
 * @param {string} [opts.rootDir]    — repo root for cursor file (default ".")
 * @param {Function} [opts.spawnSyncFn] — injectable spawnSync for testing
 * @returns {{ updated: boolean, reason: string }}
 */
export function updateTickIdleCursor({
  factoryId = "",
  rootDir = ".",
  spawnSyncFn = spawnSync,
} = {}) {
  const headResult = spawnSyncFn("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 });
  const currentHead = (headResult.status === 0) ? String(headResult.stdout || "").trim() : "";

  if (!currentHead) {
    return { updated: false, reason: "git_head_unresolvable" };
  }

  const cursorPath = resolveCursorPath({ factoryId, rootDir });
  writeTickIdleCursor(cursorPath, { lastHeadSha: currentHead, factoryId });
  return { updated: true, reason: "cursor_advanced" };
}
