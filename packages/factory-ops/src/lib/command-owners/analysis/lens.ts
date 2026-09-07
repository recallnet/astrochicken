import { promises as fsPromises } from "node:fs";

import { Command, Option } from "clipanion";

import { computePreviousDayWindow } from "./daily-report.ts";
import { parsePositiveNumber } from "../../../cli/helpers.ts";
import {
  appendLearningItem,
  DEFAULT_LEARNING_LOG_JSON_PATH,
} from "../../analysis/learning-log.ts";
import { writeLensArtifacts } from "../../analysis/lens-artifacts.ts";
import { collectLensData } from "../../analysis/lens-collector.ts";
import {
  buildLensAnalysisPrompt,
  buildLensMetaReflectionPrompt,
} from "../../analysis/lens-prompt-builder.ts";
import { callLlmJson } from "../../analysis/llm-call.ts";

let runtimeOverrides = {};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value ?? "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeShapingInsight(item = {}) {
  const evidenceValue = item?.evidence;
  const evidence = typeof evidenceValue === "string"
    ? evidenceValue.trim()
    : evidenceValue && typeof evidenceValue === "object"
      ? JSON.stringify(evidenceValue)
      : "";

  return {
    id: asString(item?.id),
    category: asString(item?.category) || "patterns",
    recommendation: asString(item?.recommendation || item?.summary),
    evidence,
    affectedGoals: asArray(item?.affectedGoals || item?.affected_goals)
      .map((goal) => asString(goal))
      .filter(Boolean),
    actionLabel: asString(item?.actionLabel || item?.action_label),
  };
}

export function buildShapingInsightsLatest(lensJson = {}) {
  return asArray(lensJson?.shaping_insights || lensJson?.appendix?.shaping_insights)
    .map((item) => normalizeShapingInsight(item));
}

function buildFallbackMarkdown({ date = "", repo = "", analysisStart = "", analysisEnd = "" } = {}) {
  return `# Daily Lens — ${date}\n\n\`${repo}\` · ${date} · \`${analysisStart}\` → \`${analysisEnd}\`\n\nAnalysis failed. See JSON artifacts for collector data.\n`;
}

function normalizeEvidenceRefs(evidenceRefs) {
  if (!Array.isArray(evidenceRefs)) return [];
  return evidenceRefs
    .map((entry) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed ? { ref: trimmed } : null;
      }
      if (typeof entry === "object") {
        const out = {};
        for (const [key, value] of Object.entries(entry)) {
          out[String(key)] = String(value ?? "");
        }
        return out;
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeSuggestions(suggestions) {
  return asArray(suggestions).map((suggestion) => ({
    id: asString(suggestion?.id),
    summary: asString(suggestion?.summary),
    type: asString(suggestion?.type) || "suggestion",
    status: asString(suggestion?.status) || "pending",
    elevation: asString(suggestion?.elevation),
    evidence_refs: normalizeEvidenceRefs(suggestion?.evidence_refs || suggestion?.evidenceRefs),
    impact_notes: asString(suggestion?.impact_notes || suggestion?.impactNotes),
    why_now: asString(suggestion?.why_now || suggestion?.whyNow),
    success_metric: asString(suggestion?.success_metric || suggestion?.successMetric),
    recommendation: asString(suggestion?.recommendation),
    dependency_hints: asArray(suggestion?.dependency_hints || suggestion?.dependencyHints)
      .map((hint) => asString(hint)).filter(Boolean),
  }));
}

export function normalizeMetaReflection(metaReflection = {}) {
  return {
    data_quality_notes: asString(metaReflection?.data_quality_notes),
    blind_spots: asString(metaReflection?.blind_spots),
    prompt_effectiveness: asString(metaReflection?.prompt_effectiveness),
    missing_data: asArray(metaReflection?.missing_data).map((item) => asString(item)).filter(Boolean),
    suggested_experiments: asArray(metaReflection?.suggested_experiments).map((item) => asString(item)).filter(Boolean),
    questions_for_next_time: asArray(metaReflection?.questions_for_next_time).map((item) => asString(item)).filter(Boolean),
  };
}

export function normalizeLensAnalysis(analysis = {}) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return {
      focus_choices: {
        prioritized_elevations: [],
        deprioritized_elevations: [],
        reasoning: "",
      },
      findings: [],
      trends: {
        improving: [],
        degrading: [],
        stable: [],
      },
      suggestions: [],
      shaping_insights: [],
      meta_reflection: normalizeMetaReflection({}),
    };
  }

  const focusChoices = analysis.focus_choices && typeof analysis.focus_choices === "object"
    ? analysis.focus_choices
    : {};

  const trends = analysis.trends && typeof analysis.trends === "object"
    ? analysis.trends
    : {};

  return {
    focus_choices: {
      prioritized_elevations: asArray(focusChoices.prioritized_elevations).map((value) => asString(value)).filter(Boolean),
      deprioritized_elevations: asArray(focusChoices.deprioritized_elevations).map((value) => asString(value)).filter(Boolean),
      reasoning: asString(focusChoices.reasoning),
    },
    findings: asArray(analysis.findings),
    trends: {
      improving: asArray(trends.improving),
      degrading: asArray(trends.degrading),
      stable: asArray(trends.stable),
    },
    suggestions: normalizeSuggestions(analysis.suggestions),
    shaping_insights: asArray(analysis.shaping_insights),
    meta_reflection: normalizeMetaReflection(analysis.meta_reflection),
    report_body: typeof analysis.report_body === "string" ? analysis.report_body : undefined,
    executive_summary: analysis.executive_summary && typeof analysis.executive_summary === "object"
      ? analysis.executive_summary
      : undefined,
    key_metrics: Array.isArray(analysis.key_metrics) ? analysis.key_metrics : undefined,
  };
}

export function deriveCollectorManifestFromCollected(collected = {}) {
  const base = collected?.base && typeof collected.base === "object" ? collected.base : {};
  const collectorHealth = Object.fromEntries(
    Object.entries(base).map(([key, value]) => {
      const error = asString(value?.meta?.error);
      return [key, {
        status: error ? "degraded" : "ok",
        meta_error: error,
      }];
    }),
  );

  return {
    base,
    collector_health: collectorHealth,
  };
}

export function deriveTrendWindowsFromAnalysis(analysis = {}, fallbackWindow = {}) {
  const trendWindows = {
    ...(analysis?.trend_windows && typeof analysis.trend_windows === "object" ? analysis.trend_windows : {}),
  };

  if (asString(fallbackWindow?.start) && asString(fallbackWindow?.end)) {
    trendWindows.default = {
      ...(trendWindows.default && typeof trendWindows.default === "object" ? trendWindows.default : {}),
      start: asString(trendWindows?.default?.start || fallbackWindow.start),
      end: asString(trendWindows?.default?.end || fallbackWindow.end),
    };
  }

  const trends = analysis?.trends && typeof analysis.trends === "object" ? analysis.trends : {};
  for (const bucket of ["improving", "degrading", "stable"]) {
    for (const item of asArray(trends[bucket])) {
      if (!item || typeof item !== "object") continue;
      const trendKey = asString(item.trend_key || item.trendKey || item.key || item.id || item.label);
      if (!trendKey) continue;
      const trendWindow = item.comparison_window || item.comparisonWindow || item.window;
      if (trendWindow && typeof trendWindow === "object") {
        trendWindows[trendKey] = trendWindow;
      }
    }
  }

  return trendWindows;
}

async function defaultRunLensAnalysis({
  date = "",
  repo = "",
  factoryId = "",
  model = "",
  analysisStart = "",
  analysisEnd = "",
  collected = {},
  callLlmFn = callLlmJson,
} = {}) {
  const prompt = buildLensAnalysisPrompt({
    date,
    repo,
    factoryId,
    analysisStart,
    analysisEnd,
    collected,
  });
  return callLlmFn({ prompt, model });
}

async function defaultRunLensMetaReflection({
  date = "",
  repo = "",
  factoryId = "",
  model = "",
  analysisOutput = {},
  collected = {},
  callLlmFn = callLlmJson,
} = {}) {
  const prompt = buildLensMetaReflectionPrompt({
    date,
    repo,
    factoryId,
    analysisOutput,
    collected,
  });
  return callLlmFn({ prompt, model });
}

function resolveRuntimeDeps() {
  const baseFs = {
    mkdir: fsPromises.mkdir.bind(fsPromises),
    writeFile: fsPromises.writeFile.bind(fsPromises),
  };

  return {
    fs: {
      ...baseFs,
      ...(runtimeOverrides.fs || {}),
    },
    collectLensData: runtimeOverrides.collectLensData || collectLensData,
    callLlm: runtimeOverrides.callLlm || callLlmJson,
    runLensAnalysis: runtimeOverrides.runLensAnalysis || defaultRunLensAnalysis,
    runLensMetaReflection: runtimeOverrides.runLensMetaReflection || defaultRunLensMetaReflection,
    appendLearningItem: runtimeOverrides.appendLearningItem || appendLearningItem,
    writeLensArtifacts: runtimeOverrides.writeLensArtifacts || writeLensArtifacts,
  };
}

export async function persistSuggestionOutcomes({
  suggestions = [],
  appendLearningItemFn,
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
} = {}) {
  const outcomes = {
    attempted: asArray(suggestions).length,
    appended_ids: [],
    duplicate_ids: [],
    invalid_ids: [],
    error_items: [],
  };

  for (const suggestion of asArray(suggestions)) {
    const id = asString(suggestion?.id) || "(missing-id)";
    try {
      await appendLearningItemFn({
        logPath: learningLogPath,
        id: suggestion?.id,
        summary: suggestion?.summary,
        type: suggestion?.type,
        status: "pending",
        evidenceRefs: suggestion?.evidence_refs,
        impactNotes: suggestion?.impact_notes,
      });
      outcomes.appended_ids.push(id);
    } catch (error) {
      const message = String(error?.message || error);
      if (message.startsWith("learning_log_duplicate_id:")) {
        outcomes.duplicate_ids.push(id);
        continue;
      }
      if (message.startsWith("learning_log_invalid_")) {
        outcomes.invalid_ids.push(id);
        outcomes.error_items.push({ id, message });
        continue;
      }
      outcomes.error_items.push({ id, message });
    }
  }

  return outcomes;
}

export function setAnalysisLensRuntimeForTest(overrides = {}) {
  runtimeOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
}

export function resetAnalysisLensRuntimeForTest() {
  runtimeOverrides = {};
}

export async function runAnalysisLens({
  date = "",
  repo = "",
  factoryId = "mothership",
  outputDir = "reports/lens",
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  model = "claude-sonnet-4-6",
  notifySlack = false,
  langfuseRetries = 2,
  runsDir = ".hatch/runs",
  repoPath = ".",
  logLevel = "info",
  windowStart = "",
  windowEnd = "",
} = {}) {
  if (!asString(date)) {
    throw new Error("missing_date: --date is required");
  }
  if (!asString(repo)) {
    throw new Error("missing_repo: --repo is required");
  }

  const normalizedDate = String(date || "").trim();
  const computedWindow = (String(windowStart || "").trim() && String(windowEnd || "").trim())
    ? {
      analysisStart: String(windowStart).trim(),
      analysisEnd: String(windowEnd).trim(),
      date: normalizedDate,
    }
    : computePreviousDayWindow(date);
  const { analysisStart, analysisEnd } = computedWindow;
  const runtime = resolveRuntimeDeps();

  let collected = {};
  const collectorErrors = [];
  try {
    collected = await runtime.collectLensData({
      date: normalizedDate,
      repo,
      factoryId,
      analysisStart,
      analysisEnd,
      learningLogPath,
      langfuseRetries,
      runsDir,
      repoPath,
      ...(runtime.fs?.readFile ? { runtimeFs: runtime.fs } : {}),
    });
  } catch (error) {
    collectorErrors.push(`collector_bundle_failed: ${String(error?.message || error)}`);
    collected = {};
  }

  const sourceErrors = [
    collected?.base?.langfuse?.meta?.error,
    collected?.base?.github?.meta?.error,
    collected?.base?.git?.meta?.error,
    collected?.base?.hatch_runs?.meta?.error,
    collected?.base?.supervisor?.meta?.error,
  ].filter(Boolean);

  let analysisMode = "normal";
  let analysisErrorMessage = "";
  let metaReflectionErrorMessage = "";
  let analysisOutput = {};
  let metaReflection = {};

  try {
    analysisOutput = await runtime.runLensAnalysis({
      date: normalizedDate,
      repo,
      factoryId,
      model,
      analysisStart,
      analysisEnd,
      collected,
      callLlmFn: runtime.callLlm,
    });

    if (!analysisOutput || typeof analysisOutput !== "object" || Array.isArray(analysisOutput)) {
      throw new Error("lens_analysis_invalid_output: expected object");
    }

    try {
      metaReflection = await runtime.runLensMetaReflection({
        date: normalizedDate,
        repo,
        factoryId,
        model,
        analysisStart,
        analysisEnd,
        analysisOutput,
        collected,
        callLlmFn: runtime.callLlm,
      });
    } catch (error) {
      metaReflectionErrorMessage = `lens_meta_reflection_failed: ${String(error?.message || error)}`;
      metaReflection = {
        data_quality_notes: "Meta-reflection call failed; lens output retained with fallback metadata.",
        blind_spots: "Meta-reflection unavailable for this run.",
        prompt_effectiveness: "Meta-reflection call failed.",
        missing_data: [],
        suggested_experiments: [],
        questions_for_next_time: [],
      };
    }
  } catch (error) {
    analysisMode = "fail_open";
    analysisErrorMessage = String(error?.message || error);
    analysisOutput = {};
    metaReflection = {
      data_quality_notes: "Primary analysis call failed; emitting fail-open artifacts.",
      blind_spots: "No model-generated blind spot analysis because analysis call failed.",
      prompt_effectiveness: "Unavailable because primary analysis call failed.",
      missing_data: [],
      suggested_experiments: [],
      questions_for_next_time: [
        "Which deterministic fallback fields should be expanded to improve fail-open usefulness?",
      ],
    };
  }

  const normalizedAnalysis = normalizeLensAnalysis(analysisOutput);
  const effectiveMetaReflection = Object.keys(metaReflection).length > 0
    ? normalizeMetaReflection(metaReflection)
    : normalizedAnalysis.meta_reflection;

  const lensJson = {
    date: normalizedDate,
    repo,
    factory_id: factoryId,
    model,
    window: {
      start: analysisStart,
      end: analysisEnd,
    },
    focus_choices: normalizedAnalysis.focus_choices,
    findings: normalizedAnalysis.findings,
    trends: normalizedAnalysis.trends,
    suggestions: normalizedAnalysis.suggestions,
    shaping_insights: normalizedAnalysis.shaping_insights,
    meta_reflection: effectiveMetaReflection,
    collected_data: collected,
    meta: {
      analysis_mode: analysisMode,
      collector_errors: [...collectorErrors, ...sourceErrors],
      meta_reflection_error: metaReflectionErrorMessage,
      log_level: asString(logLevel) || "info",
      notify_slack_requested: notifySlack === true,
    },
  };

  if (analysisMode === "fail_open") {
    lensJson.error_annotation = {
      code: "lens_analysis_failed",
      message: analysisErrorMessage || "unknown lens analysis error",
    };
  }

  const suggestionPersistence = await persistSuggestionOutcomes({
    suggestions: lensJson.suggestions,
    appendLearningItemFn: runtime.appendLearningItem,
    learningLogPath,
  });
  lensJson.meta.suggestion_persistence = suggestionPersistence;

  const markdown = asString(normalizedAnalysis.report_body)
    || buildFallbackMarkdown({ date: normalizedDate, repo, analysisStart, analysisEnd });
  const insightsLatest = buildShapingInsightsLatest(lensJson);

  const artifacts = await runtime.writeLensArtifacts({
    fs: runtime.fs,
    outputDir,
    date: normalizedDate,
    lensJson,
    markdown,
    insightsLatest,
  });

  return {
    ok: true,
    repo,
    date: normalizedDate,
    factory_id: factoryId,
    model,
    analysis_start: analysisStart,
    analysis_end: analysisEnd,
    artifacts,
    suggestion_persistence: suggestionPersistence,
    analysis_mode: analysisMode,
    error_annotation: lensJson.error_annotation || null,
  };
}

export class AnalysisLensCommand extends Command {
  static paths = [["analysis", "lens"]];

  date = Option.String("--date", "");
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  outputDir = Option.String("--output-dir", "reports/lens");
  learningLogPath = Option.String("--learning-log-path", DEFAULT_LEARNING_LOG_JSON_PATH);
  model = Option.String("--model", "claude-sonnet-4-6");
  notifySlack = Option.Boolean("--notify-slack", false);
  langfuseRetries = Option.String("--langfuse-retries", "2");
  logLevel = Option.String("--log-level", "info");

  async execute() {
    try {
      const out = await runAnalysisLens({
        date: this.date,
        repo: this.repo,
        factoryId: this.factoryId,
        outputDir: this.outputDir,
        learningLogPath: this.learningLogPath,
        model: this.model,
        notifySlack: this.notifySlack,
        langfuseRetries: parsePositiveNumber(this.langfuseRetries, 2),
        logLevel: this.logLevel,
      });
      this.context.stdout.write(JSON.stringify(out, null, 2));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      if (String(error?.message || "").startsWith("missing_") || String(error?.message || "").startsWith("invalid_date")) {
        return 2;
      }
      return 1;
    }
  }
}
