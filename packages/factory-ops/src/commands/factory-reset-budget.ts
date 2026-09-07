import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";


function sanitize(value = "") {
  return String(value || "default").replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function factoryGuardPath({ scope = "default", workerPeriod = "default" } = {}) {
  return join(process.cwd(), ".hatch", "guard", `${sanitize(scope)}.${sanitize(workerPeriod)}.json`);
}

function factoryGuardEventsPath({ scope = "default", workerPeriod = "default" } = {}) {
  return join(process.cwd(), ".hatch", "guard", `${sanitize(scope)}.${sanitize(workerPeriod)}.events.jsonl`);
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function writeAtomic(path, payload) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

function zeroCounters() {
  return {
    tool_calls: 0,
    llm_calls: 0,
    review_retry_calls: 0,
    pipeline_transition_calls: 0,
  };
}

function normalizeGuardScope(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.toLowerCase() === "default") return "";
  return candidate;
}

function deriveFactoryScopeFromState(state = {}) {
  const context = state && typeof state.context === "object" ? state.context : {};
  const pipelineFile = String(state?.pipelineFile || state?.pipeline || "").trim();
  const candidates = [
    context.factory_id,
    context.factory,
    context.instance_id,
    process.env.HATCH_FACTORY_ID,
    process.env.HATCH_INSTANCE_ID,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeGuardScope(candidate);
    if (normalized) return normalized;
  }
  const match = pipelineFile.match(/(?:^|\/)factories\/([^/]+)\//);
  return normalizeGuardScope(match?.[1] || "");
}

function resolveGuardScope(guard = {}, state = {}) {
  return normalizeGuardScope(guard.factoryScope) || deriveFactoryScopeFromState(state) || "default";
}

function resolveWorkerPeriod(guard = {}, state = {}) {
  const context = state && typeof state.context === "object" ? state.context : {};
  return (
    normalizeGuardScope(guard.workerPeriod) ||
    normalizeGuardScope(context.guard_worker_period) ||
    normalizeGuardScope(context.worker_period) ||
    normalizeGuardScope(process.env.HATCH_GUARD_WORKER_PERIOD) ||
    "default"
  );
}

export function resetFactoryBudget({ runId = "", runsDir = ".hatch/runs", actorId = "", force = false } = {}) {
  const id = String(runId || "").trim();
  if (!id) return { ok: false, reason: "missing_run_id" };

  const runDir = join(runsDir, id);
  const statePath = join(runDir, "state.json");
  if (!existsSync(statePath)) return { ok: false, reason: "run_state_missing", run_id: id };

  const state = parseJson(readFileSync(statePath, "utf8"), null);
  if (!state || typeof state !== "object") return { ok: false, reason: "run_state_invalid", run_id: id };

  const guard = state.guard && typeof state.guard === "object" ? state.guard : {};
  const ownerId = String(guard?.owner?.ownerId || `run:${id}`);
  const actor = String(actorId || ownerId).trim() || ownerId;

  if (!force && ownerId && actor !== ownerId) {
    return { ok: false, reason: "owner_mismatch", owner_id: ownerId, actor_id: actor, run_id: id };
  }

  const ts = new Date().toISOString();
  const scope = resolveGuardScope(guard, state);
  const workerPeriod = resolveWorkerPeriod(guard, state);

  state.guard = {
    policyRevision: String(guard.policyRevision || "guard.v1"),
    factoryScope: scope,
    workerPeriod,
    counters: zeroCounters(),
    factoryCounters: zeroCounters(),
    circuitState: "closed",
    reasonCode: "guard_reset",
    overflowCount: 0,
    openedAt: "",
    expiresAt: "",
    terminalAt: "",
    lastDecisionAt: ts,
    lastDecisionType: "reset",
    resetCount: Number(guard.resetCount || 0) + 1,
    owner: {
      ownerId: actor,
      leaseName: String(guard?.owner?.leaseName || ""),
      leaseGeneration: Number(guard?.owner?.leaseGeneration || 0),
    },
  };

  writeAtomic(statePath, state);

  const fgPath = factoryGuardPath({ scope, workerPeriod });
  let fg = existsSync(fgPath) ? parseJson(readFileSync(fgPath, "utf8"), null) : null;
  if (!fg || typeof fg !== "object") {
    fg = {
      schemaVersion: 1,
      factoryScope: scope,
      workerPeriod,
      policyRevision: String(state.guard.policyRevision || "guard.v1"),
      counters: zeroCounters(),
      circuitState: "closed",
      reasonCode: "guard_reset",
      overflowCount: 0,
      openedAt: "",
      expiresAt: "",
      terminalAt: "",
      lastDecisionAt: ts,
      lastDecisionType: "reset",
      resetCount: 0,
      owner: { ownerId: actor, leaseName: "", leaseGeneration: 0 },
      updatedAt: ts,
    };
  }

  if (!force && fg?.owner?.ownerId && String(fg.owner.ownerId) !== actor) {
    return { ok: false, reason: "factory_owner_mismatch", owner_id: String(fg.owner.ownerId), actor_id: actor, run_id: id };
  }

  fg.counters = zeroCounters();
  fg.circuitState = "closed";
  fg.reasonCode = "guard_reset";
  fg.overflowCount = 0;
  fg.openedAt = "";
  fg.expiresAt = "";
  fg.terminalAt = "";
  fg.lastDecisionAt = ts;
  fg.lastDecisionType = "reset";
  fg.resetCount = Number(fg.resetCount || 0) + 1;
  fg.updatedAt = ts;
  fg.owner = {
    ownerId: actor,
    leaseName: String(fg?.owner?.leaseName || ""),
    leaseGeneration: Number(fg?.owner?.leaseGeneration || 0),
  };
  writeAtomic(fgPath, fg);

  const runGuardDir = join(runDir, "guard");
  ensureDir(runGuardDir);
  const artifactPath = join(runGuardDir, `guard-reset-${ts.replace(/[:.]/g, "-")}.json`);
  const artifact = {
    schemaVersion: 1,
    ts,
    action: "guard_reset",
    run_id: id,
    actor_id: actor,
    scope,
    worker_period: workerPeriod,
    run_guard: state.guard,
    factory_guard: fg,
  };
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  const runEventsPath = join(runDir, "guard-events.jsonl");
  const event = {
    schemaVersion: 1,
    ts,
    kind: "guard.reset",
    runId: id,
    actorId: actor,
    reason: "guard_reset",
    artifactPath,
    decision: {
      transition: "reset",
      circuitState: "closed",
      reasonCode: "guard_reset",
      counter: "",
      threshold: 0,
      scope: "none",
      backoffMs: 0,
      nextAttemptAt: "",
    },
  };
  writeFileSync(runEventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });

  const fgEventsPath = factoryGuardEventsPath({ scope, workerPeriod });
  ensureDir(dirname(fgEventsPath));
  writeFileSync(fgEventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });

  return {
    ok: true,
    reason: "reset_applied",
    run_id: id,
    actor_id: actor,
    scope,
    worker_period: workerPeriod,
    artifact_path: artifactPath,
    run_guard: state.guard,
    factory_guard: {
      counters: fg.counters,
      circuitState: fg.circuitState,
      reasonCode: fg.reasonCode,
      resetCount: fg.resetCount,
    },
  };
}
