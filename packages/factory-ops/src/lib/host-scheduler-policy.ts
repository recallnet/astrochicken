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
  const parsed = parseEpochMs(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeBasePriority(value, fallback = 1000) {
  return toInteger(value, fallback, { min: 0, max: 10_000 });
}

function normalizeAgeBonus(value, cap = 200) {
  return toInteger(value, 0, { min: 0, max: Math.max(0, cap) });
}

function normalizeWaitCycles(value) {
  return toInteger(value, 0, { min: 0, max: 100_000 });
}

function buildEntry(installation = {}, previous = {}, opts = {}) {
  const ageBonusCap = toInteger(opts.ageBonusCap, 200, { min: 0, max: 10_000 });
  const installationId = trim(installation.installation_id);
  const instanceId = trim(installation.instance_id);
  const previousBasePriority = normalizeBasePriority(previous.base_priority, 1000);
  const basePriority = normalizeBasePriority(
    installation.base_priority,
    previousBasePriority,
  );
  const previousAgeBonus = normalizeAgeBonus(
    previous.age_bonus ?? previous.age_bonus_counter,
    ageBonusCap,
  );
  const previousWaitCycles = normalizeWaitCycles(previous.wait_cycles);
  const lastScheduledAt = normalizeIsoTimestamp(
    installation.last_scheduled_at || previous.last_scheduled_at,
  );

  return {
    installation_id: installationId,
    instance_id: instanceId,
    base_priority: basePriority,
    age_bonus: previousAgeBonus,
    wait_cycles: previousWaitCycles,
    effective_priority: basePriority - previousAgeBonus,
    eligible: installation.eligible !== false,
    ineligible_reason: trim(installation.ineligible_reason),
    last_scheduled_at: lastScheduledAt,
    selection_reason: "",
    selection_score: basePriority - previousAgeBonus,
    capacity_reject_reason: "",
  };
}

function compareByPriority(left = {}, right = {}) {
  const leftEffective = toInteger(left.effective_priority, 1000, { min: -10_000, max: 10_000 });
  const rightEffective = toInteger(right.effective_priority, 1000, { min: -10_000, max: 10_000 });
  if (leftEffective !== rightEffective) return leftEffective - rightEffective;

  const leftWait = normalizeWaitCycles(left.wait_cycles);
  const rightWait = normalizeWaitCycles(right.wait_cycles);
  if (leftWait !== rightWait) return rightWait - leftWait;

  const leftLastScheduled = parseEpochMs(left.last_scheduled_at);
  const rightLastScheduled = parseEpochMs(right.last_scheduled_at);
  const leftScheduledScore = Number.isFinite(leftLastScheduled) ? leftLastScheduled : Number.NEGATIVE_INFINITY;
  const rightScheduledScore = Number.isFinite(rightLastScheduled) ? rightLastScheduled : Number.NEGATIVE_INFINITY;
  if (leftScheduledScore !== rightScheduledScore) return leftScheduledScore - rightScheduledScore;

  return trim(left.installation_id).localeCompare(trim(right.installation_id), "en");
}

export function buildSchedulerState(installations = [], previousState = {}, opts = {}) {
  const previousEntries = previousState?.instances && typeof previousState.instances === "object"
    ? previousState.instances
    : (previousState && typeof previousState === "object" ? previousState : {});

  const entries = [];
  for (const installation of Array.isArray(installations) ? installations : []) {
    const installationId = trim(installation?.installation_id);
    if (!installationId) continue;
    const previous = previousEntries?.[installationId] || {};
    entries.push(buildEntry(installation, previous, opts));
  }

  return {
    entries,
    age_bonus_cap: toInteger(opts.ageBonusCap, 200, { min: 0, max: 10_000 }),
    starvation_threshold: toInteger(opts.starvationThreshold, 3, { min: 1, max: 10_000 }),
  };
}

export function selectCandidates(state = {}, { maxActive = 1, maxPerTick = Number.MAX_SAFE_INTEGER } = {}) {
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const ageBonusCap = toInteger(state.age_bonus_cap, 200, { min: 0, max: 10_000 });
  const starvationThreshold = toInteger(state.starvation_threshold, 3, { min: 1, max: 10_000 });
  const slots = Math.max(0, Math.min(
    toInteger(maxActive, 1, { min: 0, max: 10_000 }),
    toInteger(maxPerTick, Number.MAX_SAFE_INTEGER, { min: 0, max: 10_000 }),
  ));

  const eligible = entries.filter((entry) => entry.eligible);
  const ineligible = entries.filter((entry) => !entry.eligible);

  const starved = eligible
    .filter((entry) => normalizeWaitCycles(entry.wait_cycles) >= starvationThreshold)
    .sort((left, right) => {
      const waitDiff = normalizeWaitCycles(right.wait_cycles) - normalizeWaitCycles(left.wait_cycles);
      if (waitDiff !== 0) return waitDiff;
      return compareByPriority(left, right);
    });

  const selected = [];
  const selectedIds = new Set();

  for (const entry of starved) {
    if (selected.length >= slots) break;
    const installationId = trim(entry.installation_id);
    if (selectedIds.has(installationId)) continue;
    selected.push({ ...entry, selection_reason: "low_priority_nudge" });
    selectedIds.add(installationId);
  }

  const orderedEligible = [...eligible].sort(compareByPriority);
  for (const entry of orderedEligible) {
    if (selected.length >= slots) break;
    const installationId = trim(entry.installation_id);
    if (selectedIds.has(installationId)) continue;
    selected.push({ ...entry, selection_reason: "priority_order" });
    selectedIds.add(installationId);
  }

  const selectedById = new Map(selected.map((entry, index) => [trim(entry.installation_id), {
    ...entry,
    selection_rank: index + 1,
    selection_score: toInteger(entry.effective_priority, 1000, { min: -10_000, max: 10_000 }),
    capacity_reject_reason: "",
    age_bonus: 0,
    wait_cycles: 0,
    effective_priority: entry.base_priority,
  }]));

  const deferredById = new Map();
  for (const entry of orderedEligible) {
    const installationId = trim(entry.installation_id);
    if (selectedById.has(installationId)) continue;
    const nextAgeBonus = Math.min(ageBonusCap, normalizeAgeBonus(entry.age_bonus, ageBonusCap) + 1);
    const nextWaitCycles = normalizeWaitCycles(entry.wait_cycles) + 1;
    deferredById.set(installationId, {
      ...entry,
      selection_reason: "deferred_capacity",
      selection_rank: selected.length + deferredById.size + 1,
      selection_score: toInteger(entry.effective_priority, 1000, { min: -10_000, max: 10_000 }),
      capacity_reject_reason: "max_active_reached",
      age_bonus: nextAgeBonus,
      wait_cycles: nextWaitCycles,
      effective_priority: entry.base_priority - nextAgeBonus,
    });
  }

  for (const entry of ineligible.sort(compareByPriority)) {
    const installationId = trim(entry.installation_id);
    deferredById.set(installationId, {
      ...entry,
      selection_reason: "ineligible",
      selection_rank: selected.length + deferredById.size + 1,
      selection_score: toInteger(entry.effective_priority, 1000, { min: -10_000, max: 10_000 }),
      capacity_reject_reason: "",
      age_bonus: entry.ineligible_reason === "cooldown"
        ? normalizeAgeBonus(entry.age_bonus, ageBonusCap)
        : 0,
      wait_cycles: entry.ineligible_reason === "cooldown"
        ? normalizeWaitCycles(entry.wait_cycles)
        : 0,
      effective_priority: entry.ineligible_reason === "cooldown"
        ? entry.base_priority - normalizeAgeBonus(entry.age_bonus, ageBonusCap)
        : entry.base_priority,
    });
  }

  const updated = [];
  for (const entry of entries) {
    const installationId = trim(entry.installation_id);
    updated.push(selectedById.get(installationId) || deferredById.get(installationId) || {
      ...entry,
      selection_reason: "ineligible",
      selection_rank: selected.length + deferredById.size + 1,
      selection_score: toInteger(entry.effective_priority, 1000, { min: -10_000, max: 10_000 }),
      capacity_reject_reason: "",
    });
  }

  updated.sort((left, right) => {
    const leftRank = toInteger(left.selection_rank, Number.MAX_SAFE_INTEGER, { min: 0, max: 1_000_000 });
    const rightRank = toInteger(right.selection_rank, Number.MAX_SAFE_INTEGER, { min: 0, max: 1_000_000 });
    if (leftRank !== rightRank) return leftRank - rightRank;
    return trim(left.installation_id).localeCompare(trim(right.installation_id), "en");
  });

  return {
    selected: updated.filter((entry) => selectedIds.has(trim(entry.installation_id))),
    rejected: updated.filter((entry) => !selectedIds.has(trim(entry.installation_id))),
    entries: updated,
    selection_order: updated.map((entry) => ({
      installation_id: entry.installation_id,
      selection_reason: entry.selection_reason,
      selection_score: entry.selection_score,
      effective_priority: entry.effective_priority,
      capacity_reject_reason: entry.capacity_reject_reason,
      age_bonus: entry.age_bonus,
      wait_cycles: entry.wait_cycles,
    })),
  };
}
