import { statSync } from "node:fs";
import { join } from "node:path";

import {
  factoryActiveSummary,
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
} from "./factory-active-summary.ts";
import {
  factoryFleetStatus as canonicalFactoryFleetStatus,
} from "./factory-fleet-canonical.ts";
import {
  classifyFleetFactoryHealth,
  formatFleetStatusHuman,
  readFactoryRegistry,
} from "./factory-fleet-projection-support.ts";
import {
  emptyFleetIncidentProjection,
  projectFleetIncidents,
} from "./factory-state-fleet-triage.projection.ts";
import {
  collectFactoryProgressMetrics,
  formatFactoryProgressMetrics,
} from "./factory-state-metrics-projection.ts";
import {
  factoryStatus,
  formatFactoryStatus,
} from "./factory-status-canonical.ts";
import {
  ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
  describeOperatorSignals,
  duration,
  expectedNextOutcomeForNode,
  mtime,
  readAllRunStates,
  readState,
  resolveGraph,
  resolveIssue,
  resolveMilestone,
} from "./factory-status-support.ts";
import {
  STAGE_ORDER,
  STAGE_LABELS,
  formatTickStatus,
} from "./factory-tick-run-projection.ts";
import { parseJsonLoose, readJsonFile, listRunDirs } from "./io.ts";
import { collectFactoryOutcomes } from "../commands/factory-outcomes.ts";
import { tickStatus } from "../commands/factory-tick-status.ts";

/**
 * Canonical run state schema (`state.json`).
 *
 * @typedef {Object} RunState
 * @property {string|null} runId
 * @property {string|null} status
 * @property {string|null} currentNode
 * @property {string|null} pipelineFile - Resolved from `pipelineFile` or legacy `pipeline`.
 * @property {string|null} startedAt
 * @property {string|null} updatedAt
 * @property {string|null} createdAt
 * @property {Object<string, unknown>} context
 * @property {Object<string, unknown>} activeChildren
 * @property {number|null} pid
 */

/**
 * Canonical run metadata schema (`metadata.json`).
 *
 * @typedef {Object} RunMetadata
 * @property {string|null} heartbeatAt
 * @property {number|null} pid
 * @property {string|null} pipelineFile
 */

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = parseJsonLoose(value, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

function statSyncSafeDir(path = "") {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export class FactoryStateReader {
  /**
   * @param {string} runsDir - Absolute path to `.hatch/<factory_id>/runs/`.
   * @param {{ factoryId?: string, factoryRoot?: string }} [opts]
   */
  constructor(runsDir, opts = {}) {
    this._runsDir = runsDir;
    this._factoryId = String(opts?.factoryId || "").trim();
    this._factoryRoot = String(opts?.factoryRoot || "").trim();

    /** In-process LRU cache keyed by `${filePath}:${mtimeMs}`. */
    this._cache = new Map();
    this._stats = { hits: 0, misses: 0 };
  }

  /**
   * @returns {Array<{ runId: string, dir: string, state: RunState, metadata: RunMetadata|null }>}
   */
  listRuns() {
    const dirs = listRunDirs(this._runsDir);
    return dirs
      .map(({ name, path: dir }) => ({
        runId: name,
        dir,
        state: this.readRunState(dir),
        metadata: this.readRunMetadata(dir),
      }))
      .filter((entry) => entry.state !== null)
      .sort((a, b) => {
        const ta = String(a.state?.updatedAt || a.state?.startedAt || "");
        const tb = String(b.state?.updatedAt || b.state?.startedAt || "");
        return tb.localeCompare(ta);
      });
  }

  /** @param {string} runDir @returns {RunState|null} */
  readRunState(runDir) {
    const raw = this._readCachedJson(join(runDir, "state.json"));
    if (!raw) return null;

    return {
      runId: raw.runId ?? null,
      status: raw.status ?? null,
      currentNode: raw.currentNode ?? null,
      pipelineFile: raw.pipelineFile ?? raw.pipeline ?? null,
      startedAt: raw.startedAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      createdAt: raw.createdAt ?? null,
      context: asObject(raw.context) ?? {},
      activeChildren: asObject(raw.activeChildren) ?? {},
      pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : null,
    };
  }

  /** @param {string} runDir @returns {RunMetadata|null} */
  readRunMetadata(runDir) {
    const raw = this._readCachedJson(join(runDir, "metadata.json"));
    if (!raw) return null;

    return {
      heartbeatAt: raw.heartbeatAt ?? null,
      pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : null,
      pipelineFile: raw.pipelineFile ?? raw.pipeline ?? null,
    };
  }

  /**
   * Legacy tick reader used by unit tests (returns run rows, not tick projection).
   * @returns {Array<{ runId: string, dir: string, state: RunState, metadata: RunMetadata|null }>}
   */
  readTickState() {
    return this.listRuns()
      .filter((entry) => String(entry.state?.pipelineFile || entry.state?.pipeline || "").includes("factory_supervisor_tick"))
      .slice(0, 3);
  }

  /** @returns {{ hits: number, misses: number }} */
  _cacheStats() {
    return { ...this._stats };
  }

  _touchCacheEntry(key, value) {
    if (this._cache.has(key)) this._cache.delete(key);
    this._cache.set(key, value);
    if (this._cache.size > 200) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey) this._cache.delete(oldestKey);
    }
  }

  _readCachedJson(filePath) {
    let mtimeMs;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      return null;
    }

    const key = `${filePath}:${mtimeMs}`;
    if (this._cache.has(key)) {
      this._stats.hits += 1;
      const cached = this._cache.get(key);
      this._touchCacheEntry(key, cached);
      return cached;
    }

    const parsed = asObject(readJsonFile(filePath, null));
    if (!parsed) return null;

    this._stats.misses += 1;
    this._touchCacheEntry(key, parsed);
    return parsed;
  }

  readState(runDir) {
    return readState(runDir);
  }

  readAllRunStates(opts = {}) {
    return readAllRunStates(opts);
  }

  asStatus(opts = {}) {
    return factoryStatus(opts);
  }

  asTick(opts = {}) {
    return tickStatus(opts);
  }

  asOutcomes({ collectFactoryOutcomesFn = collectFactoryOutcomes, ...opts } = {}) {
    return asOutcomes({ collectFactoryOutcomesFn, ...opts });
  }

  asMetrics({ runsDir = this._runsDir, ...opts } = {}) {
    return collectFactoryProgressMetrics({
      ...opts,
      runsDir,
      reader: this,
    });
  }

  asFleet(opts = {}) {
    return canonicalFactoryFleetStatus(opts);
  }

  asFleetTriage(opts = {}) {
    const runsDir = String(opts?.runsDir || this._runsDir || ".hatch/runs").trim() || ".hatch/runs";
    const warningCode = String(opts?.warningCode || "runs_dir_missing").trim() || "runs_dir_missing";
    const now = Number.isFinite(Number(opts?.now)) ? Number(opts.now) : Date.now();

    if (!runsDir || !statSyncSafeDir(runsDir)) {
      return emptyFleetIncidentProjection({
        nowEpochMs: now,
        warnings: [`${warningCode}:${runsDir || "(missing)"}`],
        ok: true,
      });
    }

    const sourceReader = runsDir === this._runsDir
      ? this
      : new FactoryStateReader(runsDir, {
        factoryId: this._factoryId,
        factoryRoot: this._factoryRoot,
      });

    return projectFleetIncidents(sourceReader.listRuns(), {
      ...opts,
      now,
    });
  }

  // TODO(#2211): upcoming fleet triage CLI commands should consume this projection directly.
  async asFleetTriageQueues(opts = {}) {
    const { buildFleetTriageQueues } = await import("./fleet-triage-projection.ts");
    return buildFleetTriageQueues(opts);
  }

  asActiveSummary(opts = {}) {
    return factoryActiveSummary(opts);
  }

  formatActiveMinimal(summary = {}) {
    return formatFactoryActiveMinimal(summary);
  }
}

export function asStatus(opts = {}) {
  return new FactoryStateReader(opts?.runsDir || ".hatch/runs").asStatus(opts);
}

export function asTick(opts = {}) {
  return new FactoryStateReader(opts?.runsDir || ".hatch/runs").asTick(opts);
}

export function asOutcomes({ collectFactoryOutcomesFn = collectFactoryOutcomes, ...opts } = {}) {
  if (typeof collectFactoryOutcomesFn !== "function") {
    return { error: "missing_collect_factory_outcomes_fn" };
  }
  return collectFactoryOutcomesFn(opts);
}

export function asMetrics(opts = {}) {
  return new FactoryStateReader(opts?.runsDir || ".hatch/runs").asMetrics(opts);
}

export function asFleet(opts = {}) {
  return new FactoryStateReader(opts?.context?.runs_dir || ".hatch/runs").asFleet(opts);
}

export function asFleetTriage(opts = {}) {
  return new FactoryStateReader(opts?.context?.runs_dir || opts?.runsDir || ".hatch/runs").asFleetTriage(opts);
}

export async function asFleetTriageQueues(opts = {}) {
  return new FactoryStateReader(opts?.context?.runs_dir || ".hatch/runs").asFleetTriageQueues(opts);
}

export {
  ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
  STAGE_LABELS,
  STAGE_ORDER,
  classifyFleetFactoryHealth,
  collectFactoryProgressMetrics,
  describeOperatorSignals,
  duration,
  expectedNextOutcomeForNode,
  factoryActiveSummary,
  canonicalFactoryFleetStatus as factoryFleetStatus,
  factoryStatus,
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
  formatFactoryProgressMetrics,
  formatFactoryStatus,
  formatFleetStatusHuman,
  formatTickStatus,
  projectFleetIncidents,
  emptyFleetIncidentProjection,
  mtime,
  readAllRunStates,
  readFactoryRegistry,
  readState,
  resolveGraph,
  resolveIssue,
  resolveMilestone,
  tickStatus,
};
