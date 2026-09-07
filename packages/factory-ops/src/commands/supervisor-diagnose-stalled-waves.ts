import { readAllRunStates } from "./factory-status.ts";
import { collectActiveWaveLeases } from "./wave-sanitize-state.ts";
import { trim, gh, ghJson } from "../lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const FEATURE_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.FEATURE);
const READY_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);
const WAVE_IN_PROGRESS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS);

function ageMinutes(iso, nowMs) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return 0;
  return Math.floor((nowMs - t) / 60000);
}

/**
 * Pure evaluation: given in-progress waves (with pre-fetched features) and active milestones,
 * return the list of stale wave entries. No side effects, no gh calls.
 */
export function evaluateStalledWaves({ inProgressWaves = [], activeMilestones = new Set(), staleMinutes = 20, nowMs = Date.now() } = {}) {
  const threshold = Number(staleMinutes || 20);
  const stale = [];

  for (const wave of inProgressWaves) {
    const milestone = String(wave?.milestone?.title || String(wave?.title || "").replace(/^Wave Ready:\s*/, "")).trim();

    // Skip waves that have an active (non-stale) pipeline run — the coding agent
    // is working in a worktree with no GitHub issue API activity until pipeline completes.
    if (activeMilestones.has(milestone)) continue;

    const waveAge = ageMinutes(wave.updatedAt, nowMs);
    const features = Array.isArray(wave.features) ? wave.features : [];
    const featureAges = features.map((f) => ({
      number: Number(f.number),
      title: String(f.title || ""),
      stale_minutes: ageMinutes(f.updatedAt, nowMs),
    }));

    const staleByWaveMarker = waveAge >= threshold;
    const hasFeatures = featureAges.length > 0;
    const staleByFeatureInactivity = hasFeatures && featureAges.every((f) => f.stale_minutes >= threshold);
    const hasRecentFeatureActivity = hasFeatures && featureAges.some((f) => f.stale_minutes < threshold);

    if (hasRecentFeatureActivity) continue;
    if (!staleByWaveMarker && !staleByFeatureInactivity) continue;

    const reason = staleByWaveMarker && staleByFeatureInactivity
      ? "wave_and_feature_stale"
      : staleByWaveMarker
        ? "wave_marker_stale"
        : "feature_inactivity_stale";

    stale.push({
      reason,
      wave_issue_number: Number(wave.number),
      wave_title: String(wave.title || ""),
      milestone,
      wave_stale_minutes: waveAge,
      threshold_minutes: threshold,
      open_feature_count: featureAges.length,
      open_features: featureAges,
      wave_labels: (wave.labels || []).map((l) => String(l?.name || "")),
      active_run_ids: Array.isArray(wave.active_run_ids) ? wave.active_run_ids : [],
    });
  }

  return stale;
}

function findActiveRunForMilestone(milestone, runStates) {
  let best = null;
  let bestMs = 0;
  for (const run of runStates) {
    const pipeline = String(run?.pipelineFile || run?.pipeline || run?.graph?.label || "").toLowerCase();
    if (!pipeline.includes("wave_execute")) continue;
    const runMilestone = String(run?.context?.milestone_title || "").trim();
    if (runMilestone !== milestone) continue;
    const status = String(run?.status || "");
    if (status !== "running" && status !== "queued") continue;
    const updatedMs = Date.parse(String(run?.updatedAt || ""));
    if (Number.isFinite(updatedMs) && updatedMs > bestMs) {
      bestMs = updatedMs;
      best = {
        run_id: String(run?.runId || run?.id || ""),
        node: String(run?.currentNode || ""),
        status,
        updated_at: String(run?.updatedAt || ""),
      };
    }
  }
  return best;
}

function buildDiagnosis(entry, activeRun, repo) {
  const wave = entry.wave_issue_number;
  const labels = entry.wave_labels || [];
  const hasWip = labels.includes(WAVE_IN_PROGRESS_LABEL);
  const hasReady = labels.includes(READY_LABEL);
  const commands = [];

  if (hasWip && !activeRun) {
    commands.push(
      `node packages/factory-ops/src/cli.ts factory recovery-sweep --runs-dir .hatch/runs --stale-minutes 20 --apply true`,
      `gh issue edit ${wave} --repo ${repo} --remove-label wave-in-progress --add-label ready`,
    );
    return {
      diagnosis: `Wave #${wave} has wave-in-progress label but no active pipeline run. Likely a crashed or reaped run. Recovery sweep + relabel to ready.`,
      action_type: "RECOVERY_SWEEP_AND_RELABEL",
      suggested_commands: commands,
    };
  }

  if (hasWip && activeRun) {
    const staleMin = entry.wave_stale_minutes || 0;
    if (staleMin >= 60) {
      commands.push(
        `node packages/factory-ops/src/cli.ts factory recovery-sweep --runs-dir .hatch/runs --stale-minutes 20 --apply true`,
      );
      return {
        diagnosis: `Wave #${wave} has an active run (${activeRun.run_id}, node=${activeRun.node}) but no GitHub activity for ${staleMin} minutes. The run is likely hung. Recovery sweep will clean it up.`,
        action_type: "INVESTIGATE_HUNG_RUN",
        suggested_commands: commands,
      };
    }
    return {
      diagnosis: `Wave #${wave} has an active run (${activeRun.run_id}, node=${activeRun.node}) with no GitHub activity for ${staleMin} minutes. The agent may still be working in a worktree. Defer — check again next tick.`,
      action_type: "DEFER",
      suggested_commands: [],
    };
  }

  if (!hasWip && hasReady) {
    return {
      diagnosis: `Wave #${wave} is ready but hasn't been picked up by dispatch. Likely blocked by lease, main branch health, or max_concurrent_waves. Will be picked up next tick when unblocked.`,
      action_type: "DEFER",
      suggested_commands: [],
    };
  }

  if (!hasWip && !hasReady) {
    commands.push(`gh issue edit ${wave} --repo ${repo} --add-label ready`);
    return {
      diagnosis: `Wave #${wave} has no ready or wave-in-progress label. Needs ready label to be picked up by dispatch.`,
      action_type: "ADD_READY_LABEL",
      suggested_commands: commands,
    };
  }

  return {
    diagnosis: `Wave #${wave} is stalled for unknown reason (labels: ${labels.join(", ")}).`,
    action_type: "INVESTIGATE",
    suggested_commands: [],
  };
}

/**
 * Diagnose stalled waves: detect, classify, and produce actionable diagnostics.
 * Returns compact array of diagnostics with plain-English diagnosis and concrete commands.
 */
export function diagnoseStalledWaves({
  repo,
  staleMinutes = 20,
  runsDir = ".hatch/runs",
  ghJsonFn = ghJson,
  nowMs = Date.now(),
} = {}) {
  if (!repo) return { ok: false, stalled_wave_count: 0, diagnostics: [], summary: "missing_repo" };

  const threshold = Number(staleMinutes || 20);
  const allStates = readAllRunStates({ runsDir });
  const runStates = Array.from(allStates.values());
  const { active_milestones } = collectActiveWaveLeases(runStates, { nowEpochMs: nowMs, staleRunMinutes: threshold });
  const activeMilestoneSet = new Set(active_milestones);

  const ready = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--search", '"Wave Ready:" in:title', "--limit", "50",
    "--json", "number,title,updatedAt,url,milestone,labels",
  ], []);

  const inProgress = ready.filter((i) => (i.labels || []).some((l) => String(l?.name || "") === WAVE_IN_PROGRESS_LABEL));

  // Enrich each wave with open features
  const enriched = inProgress.map((wave) => {
    const milestone = String(wave?.milestone?.title || String(wave?.title || "").replace(/^Wave Ready:\s*/, "")).trim();
    const features = milestone
      ? ghJsonFn([
        "issue", "list", "--repo", repo, "--state", "open", "--milestone", milestone, "--label", FEATURE_LABEL, "--limit", "200",
        "--json", "number,title,updatedAt",
      ], [])
      : [];
    return { ...wave, features };
  });

  const stale = evaluateStalledWaves({ inProgressWaves: enriched, activeMilestones: activeMilestoneSet, staleMinutes: threshold, nowMs });

  const diagnostics = stale.map((entry) => {
    const activeRun = findActiveRunForMilestone(entry.milestone, runStates);
    const { diagnosis, action_type, suggested_commands } = buildDiagnosis(entry, activeRun, repo);
    return {
      wave_issue_number: entry.wave_issue_number,
      milestone: entry.milestone,
      stale_minutes: entry.wave_stale_minutes,
      reason: entry.reason,
      open_feature_count: entry.open_feature_count,
      open_features: (entry.open_features || []).slice(0, 10).map((f) => ({
        number: f.number,
        title: f.title,
        stale_minutes: f.stale_minutes,
      })),
      active_run: activeRun,
      diagnosis,
      action_type,
      suggested_commands,
    };
  });

  return {
    ok: true,
    stalled_wave_count: diagnostics.length,
    threshold_minutes: threshold,
    active_milestones: [...activeMilestoneSet].sort((a, b) => a.localeCompare(b)),
    diagnostics,
    // Flat alias for graph output_key consumption
    stalled_wave_telemetry: diagnostics,
    stalled_wave_telemetry_count: diagnostics.length,
    summary: diagnostics.length > 0
      ? `Detected ${diagnostics.length} stalled wave(s): ${diagnostics.map((d) => `#${d.wave_issue_number} (${d.action_type})`).join(", ")}.`
      : "No stalled waves detected.",
  };
}
