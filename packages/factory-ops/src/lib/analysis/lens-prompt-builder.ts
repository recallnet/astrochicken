function asString(value) {
  return String(value ?? "").trim();
}

function sliceArray(value, limit = 20) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function summarizeCollectedData(collected = {}) {
  const base = collected?.base || {};
  return {
    langfuse_trace_count: Number(base?.langfuse?.trace_count || 0) || (Array.isArray(base?.langfuse?.traces) ? base.langfuse.traces.length : 0),
    github_issue_count: Array.isArray(base?.github?.issues) ? base.github.issues.length : 0,
    git_commit_count: Array.isArray(base?.git?.commits) ? base.git.commits.length : 0,
    hatch_run_count: Array.isArray(base?.hatch_runs?.runs) ? base.hatch_runs.runs.length : 0,
    supervisor_tick_count: Array.isArray(base?.supervisor?.ticks) ? base.supervisor.ticks.length : 0,
    pending_suggestion_count: Array.isArray(collected?.pending_suggestions) ? collected.pending_suggestions.length : 0,
    prior_lens_count: Array.isArray(collected?.past_lens_outputs) ? collected.past_lens_outputs.length : 0,
    agent_learning_count: Array.isArray(collected?.agent_learnings?.entries) ? collected.agent_learnings.entries.length : 0,
  };
}

export function buildLensAnalysisPrompt({
  date = "",
  repo = "",
  factoryId = "",
  analysisStart = "",
  analysisEnd = "",
  collected = {},
} = {}) {
  const rawLangfuse = collected?.base?.langfuse || {};
  const { traces: _rawTraces, ...langfuseWithoutTraces } = rawLangfuse;
  const compactPayload = {
    summary: summarizeCollectedData(collected),
    langfuse: langfuseWithoutTraces,
    github: collected?.base?.github || {},
    git: collected?.base?.git || {},
    hatch_runs: collected?.base?.hatch_runs || {},
    supervisor: collected?.base?.supervisor || {},
    agent_learnings: {
      path: asString(collected?.agent_learnings?.path),
      entries: sliceArray(collected?.agent_learnings?.entries, 10),
    },
    past_lens_outputs: sliceArray(collected?.past_lens_outputs, 3),
    pending_suggestions: sliceArray(collected?.pending_suggestions, 20),
    llm_inventory: collected?.llm_inventory || {},
    goal_decomposition_timeouts: collected?.goal_decomposition_timeouts || {},
  };

  return [
    "You are Daily Lens, an AI system analyzing a software factory for self-improvement.",
    "Return exactly one JSON object and no prose.",
    "Every finding must cite concrete evidence refs from the provided data.",
    "Choose focus elevations based on data richness; explicitly list what you deprioritized.",
    "Recent rationale docs may exist under docs/rationale/YYYY-MM-DD-*.md; read recent ones in the analysis window when they help explain a change or understanding debt.",
    "Use rationale docs as supporting understanding context, not as proof that work shipped.",
    "Required top-level keys: focus_choices, findings, trends, suggestions, shaping_insights, meta_reflection.",
    "Each finding must include: finding_id, observation, inference, action, candidate_type, impact, priority, confidence, evidence (or evidence_links).",
    "For directional trends, include comparison_window/window with start/end/comparison_start/comparison_end.",
    "If a trend has no comparison window, set trend_type=first_observation and include a short trend_rationale.",
    "",
    `date=${asString(date)}`,
    `repo=${asString(repo)}`,
    `factory_id=${asString(factoryId)}`,
    `window_start=${asString(analysisStart)}`,
    `window_end=${asString(analysisEnd)}`,
    "",
    JSON.stringify(compactPayload, null, 2),
  ].join("\n");
}

export function buildLensMetaReflectionPrompt({
  date = "",
  repo = "",
  factoryId = "",
  analysisOutput = {},
  collected = {},
} = {}) {
  return [
    "You are critiquing a Daily Lens analysis run.",
    "Return exactly one JSON object and no prose.",
    "Required keys: data_quality_notes, blind_spots, prompt_effectiveness, missing_data, suggested_experiments, questions_for_next_time.",
    "",
    `date=${asString(date)}`,
    `repo=${asString(repo)}`,
    `factory_id=${asString(factoryId)}`,
    "",
    JSON.stringify({
      analysis_output: analysisOutput,
      collected_summary: summarizeCollectedData(collected),
    }, null, 2),
  ].join("\n");
}
