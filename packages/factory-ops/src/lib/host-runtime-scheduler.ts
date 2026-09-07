import { loadFactoryRegistry } from "./factory-registry.ts";
import {
  normalizeHostRuntimeSchedulerEntry,
  normalizeHostRuntimeSchedulerState,
} from "./host-runtime-scheduler-state.ts";
import { buildSchedulerState, selectCandidates } from "./host-scheduler-policy.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toInteger(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, Math.trunc(fallback)));
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeIsoTimestamp(value = "") {
  if (value instanceof Date) return value.toISOString();

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(Math.trunc(numeric)).toISOString();
  }

  const text = trim(value);
  if (!text) return "";
  const parsed = parseEpochMs(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function resolveHostMaxActive(env = process.env) {
  return toInteger(env?.HATCH_HOST_MAX_ACTIVE, 1, { min: 1, max: 1024 });
}

function resolveMaxAgeBonusCycles(env = process.env) {
  return toInteger(env?.HATCH_HOST_MAX_AGE_BONUS_CYCLES, 5, { min: 1, max: 100 });
}

function resolveStarvationThreshold(env = process.env) {
  return toInteger(env?.HATCH_HOST_STARVATION_THRESHOLD, 3, { min: 1, max: 100 });
}

function resolveCapacityDeferMs(env = process.env) {
  return toInteger(env?.HATCH_HOST_CAPACITY_DEFER_MS, 0, { min: 0, max: 86_400_000 });
}

function resolveRegistryContext(paths = {}, env = process.env) {
  return {
    registryPath: trim(env?.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json"),
    registryCwd: trim(env?.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd()),
  };
}

function normalizePolicyFromRegistryRow(row = {}, { hostId = "" } = {}) {
  const assignedHostId = trim(row?.assigned_host_id);
  const schedulerWeight = toInteger(row?.scheduler_weight, 1, { min: 0, max: 10_000 });
  const basePriority = toInteger(
    row?.base_priority,
    Math.max(0, 1000 - schedulerWeight),
    { min: 0, max: 10_000 },
  );

  return {
    scheduler_weight: schedulerWeight,
    base_priority: basePriority,
    reserved_capacity: toInteger(row?.reserved_capacity, 0, { min: 0, max: 10_000 }),
    service_profile_id: trim(row?.service_profile_id || row?.service_tier),
    max_concurrent_installations: toInteger(row?.max_concurrent_installations, 0, { min: 0, max: 1024 }),
    assigned_host_id: assignedHostId,
    host_mismatch: Boolean(assignedHostId && assignedHostId !== "unassigned" && assignedHostId !== trim(hostId)),
  };
}

function loadRegistryRowMap({ paths = {}, env = process.env } = {}) {
  const context = resolveRegistryContext(paths, env);
  try {
    const loaded = loadFactoryRegistry({
      registryPath: context.registryPath,
      cwd: context.registryCwd,
    });

    const rowByInstanceId = new Map();
    for (const entry of Array.isArray(loaded.registry?.instances) ? loaded.registry.instances : []) {
      const instanceId = trim(entry?.instance_id);
      if (!instanceId) continue;
      rowByInstanceId.set(instanceId, entry);
    }

    return {
      registryPath: loaded.registryPath,
      registryFound: true,
      rowByInstanceId,
    };
  } catch {
    return {
      registryPath: context.registryPath,
      registryFound: false,
      rowByInstanceId: new Map(),
    };
  }
}

function evaluateLeaseGate({ installation = {}, hostId = "", nowEpochMs = Date.now() } = {}) {
  const lease = installation?.lease;
  if (!lease || typeof lease !== "object") {
    return {
      ok: false,
      defer_reason: "lease_invalid",
      reason_detail: "missing_lease",
    };
  }

  const leaseHostId = trim(lease.host_id);
  if (!leaseHostId || leaseHostId !== trim(hostId)) {
    return {
      ok: false,
      defer_reason: "lease_invalid",
      reason_detail: "lease_host_mismatch",
    };
  }

  const expiresAtMs = parseEpochMs(lease.lease_expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowEpochMs) {
    return {
      ok: false,
      defer_reason: "lease_invalid",
      reason_detail: "lease_expired",
    };
  }

  return {
    ok: true,
    defer_reason: "",
    reason_detail: "",
  };
}

function evaluateEligibilityGate({ previous = {}, nowEpochMs = Date.now() } = {}) {
  const nextEligibleAtMs = parseEpochMs(previous.next_eligible_at);
  if (Number.isFinite(nextEligibleAtMs) && nextEligibleAtMs > nowEpochMs) {
    return {
      ok: false,
      defer_reason: "cooldown",
      reason_detail: "next_eligible_at_in_future",
    };
  }

  return {
    ok: true,
    defer_reason: "",
    reason_detail: "",
  };
}

function buildCandidate({ installation = {}, previous = {}, policy = {}, hostId = "", nowEpochMs = Date.now() } = {}) {
  const normalizedPrevious = normalizeHostRuntimeSchedulerEntry(previous, {
    installation_id: installation.installation_id,
    instance_id: installation.instance_id,
  });

  const normalizedPolicy = {
    scheduler_weight: toInteger(policy.scheduler_weight, 1, { min: 0, max: 10_000 }),
    base_priority: toInteger(policy.base_priority, 1000, { min: 0, max: 10_000 }),
    reserved_capacity: toInteger(policy.reserved_capacity, 0, { min: 0, max: 10_000 }),
    service_profile_id: trim(policy.service_profile_id),
    max_concurrent_installations: toInteger(policy.max_concurrent_installations, 0, { min: 0, max: 1024 }),
    assigned_host_id: trim(policy.assigned_host_id),
    host_mismatch: Boolean(policy.host_mismatch),
  };

  const leaseGate = evaluateLeaseGate({ installation, hostId, nowEpochMs });
  const eligibilityGate = evaluateEligibilityGate({ previous: normalizedPrevious, nowEpochMs });

  let gate = leaseGate;
  if (gate.ok) gate = eligibilityGate;
  if (gate.ok && normalizedPolicy.host_mismatch) {
    gate = {
      ok: false,
      defer_reason: "lease_invalid",
      reason_detail: "assigned_host_mismatch",
    };
  }

  return {
    installation,
    previous: normalizedPrevious,
    policy: normalizedPolicy,
    gate,
  };
}

function buildDecisionRecord({
  candidate = {},
  policyDecision = {},
  decision = "deferred",
  deferReason = "",
  nowIso = "",
  nextEligibleAt = "",
  activeState = "idle",
  reasonDetail = "",
} = {}) {
  const installation = candidate.installation || {};
  const policy = candidate.policy || {};

  const effectivePriority = toInteger(
    policyDecision.effective_priority,
    toInteger(policy.base_priority, 1000, { min: 0, max: 10_000 }),
    { min: -10_000, max: 10_000 },
  );
  const selectionScore = toInteger(
    policyDecision.selection_score,
    effectivePriority,
    { min: -10_000, max: 10_000 },
  );
  const ageBonus = toInteger(policyDecision.age_bonus, candidate.previous?.age_bonus_counter, { min: 0, max: 1000 });

  return {
    decision,
    installation_id: trim(installation.installation_id),
    instance_id: trim(installation.instance_id),
    scheduler_weight: toInteger(policy.scheduler_weight, 1, { min: 0 }),
    reserved_capacity: toInteger(policy.reserved_capacity, 0, { min: 0 }),
    service_profile_id: trim(policy.service_profile_id),
    assigned_host_id: trim(policy.assigned_host_id),
    base_priority: toInteger(policy.base_priority, 1000, { min: 0, max: 10_000 }),
    effective_priority: effectivePriority,
    selection_reason: trim(policyDecision.selection_reason),
    selection_score: selectionScore,
    capacity_reject_reason: trim(policyDecision.capacity_reject_reason),
    wait_cycles: toInteger(policyDecision.wait_cycles, candidate.previous?.wait_cycles, { min: 0, max: 100_000 }),
    defer_reason: trim(deferReason),
    reason_detail: trim(reasonDetail),
    decision_at: nowIso,
    scheduled_at: decision === "scheduled" ? nowIso : "",
    next_eligible_at: normalizeIsoTimestamp(nextEligibleAt),
    active_state: activeState === "running" ? "running" : "idle",
    age_bonus: ageBonus,
    age_bonus_counter: ageBonus,
    scheduler_score: selectionScore,
    selection_rank: toInteger(policyDecision.selection_rank, 0, { min: 0, max: 1_000_000 }),
  };
}

function toDiagnosticLine(decision = {}) {
  return [
    `decision=${trim(decision.decision) || "deferred"}`,
    `installation_id=${trim(decision.installation_id)}`,
    `instance_id=${trim(decision.instance_id)}`,
    `base_priority=${toInteger(decision.base_priority, 1000, { min: 0 })}`,
    `effective_priority=${toInteger(decision.effective_priority, 1000, { min: -10_000 })}`,
    `selection_reason=${trim(decision.selection_reason) || "none"}`,
    `age_bonus=${toInteger(decision.age_bonus_counter, 0, { min: 0 })}`,
    `wait_cycles=${toInteger(decision.wait_cycles, 0, { min: 0 })}`,
    `capacity_reject_reason=${trim(decision.capacity_reject_reason) || "none"}`,
    `defer_reason=${trim(decision.defer_reason) || "none"}`,
  ].join(" ");
}

export function summarizeHostRuntimeSchedulerState({ state = {} } = {}) {
  const normalizedState = normalizeHostRuntimeSchedulerState(state, {
    hostId: trim(state?.host_id),
  });

  const instanceEntries = Object.values(normalizedState.instances || {})
    .map((entry) => normalizeHostRuntimeSchedulerEntry(entry))
    .sort((left, right) => trim(left.installation_id).localeCompare(trim(right.installation_id), "en"));

  const activeInstances = instanceEntries
    .filter((entry) => entry.active_state === "running")
    .map((entry) => ({
      installation_id: entry.installation_id,
      instance_id: entry.instance_id,
      scheduler_weight: entry.scheduler_weight,
      service_profile_id: entry.service_profile_id,
      base_priority: entry.base_priority,
      effective_priority: entry.effective_priority,
      selection_reason: entry.selection_reason,
      selection_score: entry.selection_score,
      wait_cycles: entry.wait_cycles,
      age_bonus: entry.age_bonus_counter,
      age_bonus_counter: entry.age_bonus_counter,
    }));

  const queuedInstances = instanceEntries
    .filter((entry) => trim(entry.defer_reason) || entry.decision === "deferred")
    .map((entry) => ({
      installation_id: entry.installation_id,
      instance_id: entry.instance_id,
      defer_reason: trim(entry.defer_reason),
      next_eligible_at: entry.next_eligible_at,
      age_bonus: entry.age_bonus_counter,
      age_bonus_counter: entry.age_bonus_counter,
      wait_cycles: entry.wait_cycles,
      base_priority: entry.base_priority,
      effective_priority: entry.effective_priority,
      selection_reason: entry.selection_reason,
      selection_score: entry.selection_score,
      capacity_reject_reason: entry.capacity_reject_reason,
    }));

  return {
    host_id: normalizedState.host_id,
    updated_at: normalizedState.updated_at,
    last_cycle: normalizedState.last_cycle || {},
    active_instances: activeInstances,
    queued_instances: queuedInstances,
    instance_count: instanceEntries.length,
    instances: instanceEntries,
  };
}

export function runHostRuntimeSchedulerCycle({
  hostId = "",
  installations = [],
  previousState = {},
  paths = {},
  env = process.env,
  nowEpochMs = Date.now(),
} = {}) {
  const normalizedHostId = trim(hostId);
  const nowIso = new Date(nowEpochMs).toISOString();
  const envMaxActive = resolveHostMaxActive(env);
  const maxAgeBonusCycles = resolveMaxAgeBonusCycles(env);
  const starvationThreshold = resolveStarvationThreshold(env);
  const capacityDeferMs = resolveCapacityDeferMs(env);

  const normalizedPreviousState = normalizeHostRuntimeSchedulerState(previousState, {
    hostId: normalizedHostId,
  });

  const registry = loadRegistryRowMap({ paths, env });
  const candidates = [];

  for (const installation of Array.isArray(installations) ? installations : []) {
    const installationId = trim(installation?.installation_id);
    if (!installationId) continue;

    const instanceId = trim(installation?.instance_id);
    const registryRow = registry.registryFound
      ? (registry.rowByInstanceId.get(instanceId) || null)
      : null;

    const policy = normalizePolicyFromRegistryRow(registryRow, {
      hostId: normalizedHostId,
    });

    const previousEntry = normalizedPreviousState.instances?.[installationId] || {};
    candidates.push(buildCandidate({
      installation,
      previous: previousEntry,
      policy,
      hostId: normalizedHostId,
      nowEpochMs,
    }));
  }

  const serviceProfileCap = candidates.reduce((acc, candidate) => {
    const cap = toInteger(candidate.policy.max_concurrent_installations, 0, { min: 0, max: 1024 });
    if (cap <= 0) return acc;
    return Math.min(acc, cap);
  }, Number.POSITIVE_INFINITY);

  const maxActive = Number.isFinite(serviceProfileCap)
    ? Math.max(1, Math.min(envMaxActive, serviceProfileCap))
    : envMaxActive;

  const policyInstallations = candidates.map((candidate) => ({
    installation_id: trim(candidate.installation.installation_id),
    instance_id: trim(candidate.installation.instance_id),
    base_priority: candidate.policy.base_priority,
    eligible: candidate.gate.ok,
    ineligible_reason: candidate.gate.defer_reason,
    last_scheduled_at: candidate.previous.last_scheduled_at,
  }));

  const policyPreviousState = {
    instances: Object.fromEntries(candidates.map((candidate) => [
      trim(candidate.installation.installation_id),
      {
        installation_id: trim(candidate.installation.installation_id),
        base_priority: candidate.policy.base_priority,
        age_bonus: candidate.previous.age_bonus_counter,
        wait_cycles: candidate.previous.wait_cycles,
        last_scheduled_at: candidate.previous.last_scheduled_at,
      },
    ])),
  };

  const policyState = buildSchedulerState(policyInstallations, policyPreviousState, {
    ageBonusCap: maxAgeBonusCycles,
    starvationThreshold,
  });

  const policySelection = selectCandidates(policyState, {
    maxActive,
    maxPerTick: maxActive,
  });

  const policyDecisionByInstallationId = new Map(
    (policySelection.entries || []).map((entry) => [trim(entry.installation_id), entry]),
  );

  const orderedDecisions = [];
  for (const candidate of candidates) {
    const installationId = trim(candidate.installation.installation_id);
    const policyDecision = policyDecisionByInstallationId.get(installationId) || {};
    const isScheduled = trim(policyDecision.selection_reason) === "priority_order"
      || trim(policyDecision.selection_reason) === "low_priority_nudge";

    const deferReason = isScheduled
      ? ""
      : (candidate.gate.ok ? "capacity" : candidate.gate.defer_reason);

    const nextEligibleAt = !isScheduled && deferReason === "capacity" && capacityDeferMs > 0
      ? new Date(nowEpochMs + capacityDeferMs).toISOString()
      : (!isScheduled && deferReason === "cooldown" ? candidate.previous.next_eligible_at : "");

    orderedDecisions.push(buildDecisionRecord({
      candidate,
      policyDecision,
      decision: isScheduled ? "scheduled" : "deferred",
      deferReason,
      nowIso,
      nextEligibleAt,
      activeState: isScheduled ? "running" : "idle",
      reasonDetail: !isScheduled && !candidate.gate.ok ? candidate.gate.reason_detail : "",
    }));
  }

  orderedDecisions.sort((left, right) => {
    const leftRank = toInteger(left.selection_rank, Number.MAX_SAFE_INTEGER, { min: 0 });
    const rightRank = toInteger(right.selection_rank, Number.MAX_SAFE_INTEGER, { min: 0 });
    if (leftRank !== rightRank) return leftRank - rightRank;
    return trim(left.installation_id).localeCompare(trim(right.installation_id), "en");
  });

  const nextInstances = {};
  for (const decision of orderedDecisions) {
    const installationId = trim(decision.installation_id);
    if (!installationId) continue;
    nextInstances[installationId] = normalizeHostRuntimeSchedulerEntry({
      installation_id: installationId,
      instance_id: trim(decision.instance_id),
      service_profile_id: trim(decision.service_profile_id),
      scheduler_weight: decision.scheduler_weight,
      reserved_capacity: decision.reserved_capacity,
      assigned_host_id: trim(decision.assigned_host_id),
      base_priority: decision.base_priority,
      effective_priority: decision.effective_priority,
      selection_reason: trim(decision.selection_reason),
      selection_score: decision.selection_score,
      capacity_reject_reason: trim(decision.capacity_reject_reason),
      wait_cycles: decision.wait_cycles,
      last_scheduled_at: decision.decision === "scheduled" ? nowIso : "",
      next_eligible_at: decision.next_eligible_at,
      defer_reason: decision.defer_reason,
      active_state: decision.active_state,
      age_bonus_counter: decision.age_bonus_counter,
      decision: decision.decision,
      decision_at: nowIso,
    });
  }

  const scheduled = orderedDecisions.filter((entry) => entry.decision === "scheduled");
  const deferred = orderedDecisions.filter((entry) => entry.decision !== "scheduled");

  const lastCycle = {
    host_id: normalizedHostId,
    at: nowIso,
    max_active: maxActive,
    max_active_env: envMaxActive,
    max_active_service_profile: Number.isFinite(serviceProfileCap) ? serviceProfileCap : "",
    active_count: scheduled.length,
    scheduled_installations: scheduled.map((entry) => entry.installation_id),
    deferred_installations: deferred.map((entry) => ({
      installation_id: entry.installation_id,
      instance_id: entry.instance_id,
      defer_reason: entry.defer_reason,
      selection_reason: entry.selection_reason,
      capacity_reject_reason: entry.capacity_reject_reason,
    })),
    selection_order: orderedDecisions.map((entry) => ({
      installation_id: entry.installation_id,
      decision: entry.decision,
      selection_reason: entry.selection_reason,
      selection_score: entry.selection_score,
      effective_priority: entry.effective_priority,
      age_bonus: entry.age_bonus_counter,
      wait_cycles: entry.wait_cycles,
      capacity_reject_reason: entry.capacity_reject_reason,
      defer_reason: entry.defer_reason,
    })),
    starvation_threshold: starvationThreshold,
    max_age_bonus_cycles: maxAgeBonusCycles,
    registry_path: registry.registryPath,
    registry_found: registry.registryFound,
  };

  const nextState = normalizeHostRuntimeSchedulerState({
    schema: normalizedPreviousState.schema,
    host_id: normalizedHostId,
    updated_at: nowIso,
    last_cycle: lastCycle,
    instances: nextInstances,
  }, {
    hostId: normalizedHostId,
  });

  return {
    host_id: normalizedHostId,
    at: nowIso,
    max_active: maxActive,
    active_count: scheduled.length,
    decisions: orderedDecisions,
    diagnostics: orderedDecisions.map((entry) => toDiagnosticLine(entry)),
    state: nextState,
    summary: summarizeHostRuntimeSchedulerState({ state: nextState }),
  };
}
