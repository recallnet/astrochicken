import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { Command, Option } from "clipanion";

import { runAnalysisLensFollowupCandidates } from "./lens-followup-candidates.ts";
import { materializePendingAnalysisFromAgentResult } from "./lens-graph-analysis-file.ts";
import {
  buildShapingInsightsLatest,
  deriveCollectorManifestFromCollected,
  deriveTrendWindowsFromAnalysis,
  normalizeLensAnalysis,
  persistSuggestionOutcomes,
} from "./lens.ts";
import {
  publishLensArtifacts,
  resolveFactoryConfigSlackWebhookUrl,
  resolveIssueLabels,
  resetAnalysisPublishLensRuntimeForTest,
  setAnalysisPublishLensRuntimeForTest,
} from "./publish-lens.ts";
import { parsePositiveNumber } from "../../cli/helpers.ts";
import {
  DEFAULT_LEARNING_LOG_JSON_PATH,
  appendLearningItem,
} from "../../lib/analysis/learning-log.ts";
import { buildFallbackMarkdownFromFindings, writeLensArtifacts } from "../../lib/analysis/lens-artifacts.ts";
import { collectLensData } from "../../lib/analysis/lens-collector.ts";
import { buildLensManifest } from "../../lib/analysis/lens-manifest.ts";
let runtimeOverrides = {};

function asString(value) {
  return String(value ?? "").trim();
}

function asBooleanString(value) { return asString(value).toLowerCase() === "true"; }

function resolveRuntime() {
  return {
    fs: {
      ...fsPromises,
      ...(runtimeOverrides.fs || {}),
    },
    collectLensData: runtimeOverrides.collectLensData || collectLensData,
    buildLensManifest: runtimeOverrides.buildLensManifest || buildLensManifest,
    writeLensArtifacts: runtimeOverrides.writeLensArtifacts || writeLensArtifacts,
    appendLearningItem: runtimeOverrides.appendLearningItem || appendLearningItem,
    runAnalysisLensFollowupCandidates: runtimeOverrides.runAnalysisLensFollowupCandidates || runAnalysisLensFollowupCandidates,
  };
}

function resolveRuntimeDir({ outputDir = "reports/lens", runId = "" } = {}) {
  return path.join(outputDir, "runtime", asString(runId) || "manual");
}

async function writeJsonFile(runtimeFs, filePath, value) {
  await runtimeFs.mkdir(path.dirname(filePath), { recursive: true });
  await runtimeFs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonFileAtomic(runtimeFs, filePath, value) {
  await runtimeFs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await runtimeFs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (typeof runtimeFs.rename === "function") {
    await runtimeFs.rename(tempPath, filePath);
    return;
  }
  await runtimeFs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(runtimeFs, filePath = "") {
  return JSON.parse(await runtimeFs.readFile(filePath, "utf8"));
}

function resolveCollectorErrors(bundle = {}) {
  return [
    bundle?.base?.langfuse?.meta?.error,
    bundle?.base?.github?.meta?.error,
    bundle?.base?.git?.meta?.error,
    bundle?.base?.hatch_runs?.meta?.error,
    bundle?.base?.supervisor?.meta?.error,
  ].filter(Boolean).map((entry) => asString(entry)).filter(Boolean);
}

export function setAnalysisLensGraphRuntimeForTest(overrides = {}) {
  runtimeOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
  setAnalysisPublishLensRuntimeForTest(overrides);
}

export function resetAnalysisLensGraphRuntimeForTest() {
  runtimeOverrides = {};
  resetAnalysisPublishLensRuntimeForTest();
}

export async function runAnalysisLensPrepare({
  date = "",
  repo = "",
  factoryId = "mothership",
  outputDir = "reports/lens",
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  runsDir = ".hatch/runs",
  repoPath = ".",
  windowStart = "",
  windowEnd = "",
  langfuseRetries = 2,
  runId = "",
  issueLabels = ["daily-lens"],
  notifySlack = false,
} = {}) {
  if (!asString(date)) throw new Error("missing_date: --date is required");
  if (!asString(repo)) throw new Error("missing_repo: --repo is required");
  if (!asString(windowStart) || !asString(windowEnd)) {
    throw new Error("missing_window: --window-start and --window-end are required");
  }

  const runtime = resolveRuntime();
  const runtimeDir = resolveRuntimeDir({ outputDir, runId });
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const bundleManifestPath = path.join(runtimeDir, "bundle-manifest.json");
  const analysisOutputPath = path.join(runtimeDir, "analysis-output.json");

  const collected = await runtime.collectLensData({
    date: asString(date),
    repo: asString(repo),
    factoryId,
    analysisStart: asString(windowStart),
    analysisEnd: asString(windowEnd),
    learningLogPath,
    langfuseRetries,
    runsDir,
    repoPath,
    runtimeFs: runtime.fs,
  });

  const manifest = await runtime.buildLensManifest({
    collected,
    runtimeFs: runtime.fs,
    runtimeDir,
    date: asString(date),
    repo: asString(repo),
    factoryId,
    window: {
      start: asString(windowStart),
      end: asString(windowEnd),
    },
    bundlePath,
    analysisOutputPath,
    repoPath: asString(repoPath),
    runsDir: asString(runsDir),
    issueLabels: resolveIssueLabels(issueLabels),
  });

  await writeJsonFile(runtime.fs, bundlePath, collected);
  await writeJsonFileAtomic(runtime.fs, bundleManifestPath, manifest);
  await writeJsonFile(runtime.fs, analysisOutputPath, {
    status: "pending_agent_analysis",
    bundle_manifest_path: bundleManifestPath,
  });

  return {
    ok: true,
    date: asString(date),
    repo: asString(repo),
    factory_id: asString(factoryId),
    window_start: asString(windowStart),
    window_end: asString(windowEnd),
    bundle_path: bundlePath,
    bundle_manifest_path: bundleManifestPath,
    analysis_output_path: analysisOutputPath,
    output_dir: asString(outputDir),
    issue_labels_json: JSON.stringify(resolveIssueLabels(issueLabels)),
    notify_slack: notifySlack === true ? "true" : "false",
  };
}

export async function runAnalysisLensFinalize({
  date = "",
  repo = "",
  factoryId = "mothership",
  outputDir = "reports/lens",
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  bundlePath = "",
  analysisPath = "",
  windowStart = "",
  windowEnd = "",
  notifySlack = false,
  issueLabels = ["daily-lens"],
  slackWebhookUrl = "",
  factoryConfigWebhookUrl = "",
  runId = "",
  publicationSha = "",
  skipFollowupCandidates = false,
  agentResultJson = "",
} = {}) {
  if (!asString(date)) throw new Error("missing_date: --date is required");
  if (!asString(repo)) throw new Error("missing_repo: --repo is required");
  if (!asString(bundlePath)) throw new Error("missing_bundle_path: --bundle-path is required");
  if (!asString(analysisPath)) throw new Error("missing_analysis_path: --analysis-path is required");
  if (!asString(windowStart) || !asString(windowEnd)) {
    throw new Error("missing_window: --window-start and --window-end are required");
  }

  const runtime = resolveRuntime();
  const bundle = await readJsonFile(runtime.fs, bundlePath);
  let analysisRaw = await readJsonFile(runtime.fs, analysisPath);
  analysisRaw = await materializePendingAnalysisFromAgentResult({
    runtimeFs: runtime.fs,
    analysisPath,
    analysisRaw,
    agentResultJson,
    writeJsonFileAtomic,
  });

  if (
    analysisRaw
    && typeof analysisRaw === "object"
    && analysisRaw.status === "pending_agent_analysis"
    && !analysisRaw.report_body
  ) {
    throw new Error(
      "lens_analysis_not_written: the analysis agent did not write the analysis file — "
      + "analysis-output.json still contains the pending_agent_analysis stub. "
      + "Refusing to publish a fallback report."
    );
  }

  const normalizedAnalysis = normalizeLensAnalysis(analysisRaw);
  const collectorErrors = resolveCollectorErrors(bundle);
  const learningOutcomes = await persistSuggestionOutcomes({
    suggestions: normalizedAnalysis.suggestions,
    appendLearningItemFn: runtime.appendLearningItem,
    learningLogPath,
  });

  const lensJson = {
    date: asString(date),
    repo: asString(repo),
    factory_id: asString(factoryId),
    window: {
      start: asString(windowStart),
      end: asString(windowEnd),
    },
    ...normalizedAnalysis,
    meta: {
      analysis_mode: "graph_agent",
      collector_errors: collectorErrors,
      suggestion_outcomes: learningOutcomes,
    },
  };

  const markdown = asString(normalizedAnalysis.report_body)
    || buildFallbackMarkdownFromFindings({ date: asString(date), repo: asString(repo), windowStart: asString(windowStart), windowEnd: asString(windowEnd), normalizedAnalysis, collectorErrors });
  const insightsLatest = buildShapingInsightsLatest(lensJson);
  const artifacts = await runtime.writeLensArtifacts({
    fs: runtime.fs,
    outputDir,
    date: asString(date),
    lensJson,
    markdown,
    insightsLatest,
  });

  const publication = await publishLensArtifacts({
    date,
    repo,
    factoryId,
    lensJson,
    artifacts,
    notifySlack,
    issueLabels,
    slackWebhookUrl,
    factoryConfigWebhookUrl,
  });

  let followupCandidates = null;
  if (!skipFollowupCandidates) {
    const reportIssueNumber = Number(publication.issue?.number || 0);
    if (!Number.isFinite(reportIssueNumber) || reportIssueNumber <= 0) {
      throw new Error("lens_followup_candidates_missing_report_issue: unable_to_resolve_report_issue_number");
    }

    followupCandidates = await runtime.runAnalysisLensFollowupCandidates({
      repo: asString(repo),
      reportIssueNumber,
      analysisPath: asString(artifacts?.json_path || analysisPath),
      runId,
      publicationSha,
      factoryId: asString(factoryId),
      learningLogPath,
    });
  }

  const artifactsWithNarrative = {
    ...artifacts,
    narrative_json_path: publication?.narrative_document?.json_path || "",
    narrative_markdown_path: publication?.narrative_document?.markdown_path || "",
  };

  return {
    ok: true,
    date: asString(date),
    repo: asString(repo),
    factory_id: asString(factoryId),
    window: { start: asString(windowStart), end: asString(windowEnd) },
    artifacts: artifactsWithNarrative,
    issue: publication.issue,
    narrative_document: publication.narrative_document,
    slack: publication.slack,
    committed: publication.committed,
    followup_candidates: followupCandidates,
    scheduled_job_issue_url: publication.issue?.url || "",
    scheduled_job_issue_number: Number(publication.issue?.number || 0),
  };
}

export class AnalysisLensPrepareCommand extends Command {
  static paths = [["analysis", "lens-prepare"]];

  date = Option.String("--date", "");
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  outputDir = Option.String("--output-dir", "reports/lens");
  learningLogPath = Option.String("--learning-log-path", DEFAULT_LEARNING_LOG_JSON_PATH);
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  repoPath = Option.String("--repo-path", ".");
  windowStart = Option.String("--window-start", "");
  windowEnd = Option.String("--window-end", "");
  langfuseRetries = Option.String("--langfuse-retries", "2");
  runId = Option.String("--run-id", "");
  issueLabelsJson = Option.String("--issue-labels-json", "[\"daily-lens\",\"report\"]");
  notifySlack = Option.String("--notify-slack", "false");

  async execute() {
    const result = await runAnalysisLensPrepare({
      date: this.date,
      repo: this.repo,
      factoryId: this.factoryId,
      outputDir: this.outputDir,
      learningLogPath: this.learningLogPath,
      runsDir: this.runsDir,
      repoPath: this.repoPath,
      windowStart: this.windowStart,
      windowEnd: this.windowEnd,
      langfuseRetries: parsePositiveNumber(this.langfuseRetries, 2),
      runId: this.runId,
      issueLabels: JSON.parse(this.issueLabelsJson),
      notifySlack: asBooleanString(this.notifySlack),
    });
    this.context.stdout.write(JSON.stringify(result, null, 2));
    return 0;
  }
}

export class AnalysisLensFinalizeCommand extends Command {
  static paths = [["analysis", "lens-finalize"]];

  date = Option.String("--date", "");
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  outputDir = Option.String("--output-dir", "reports/lens");
  learningLogPath = Option.String("--learning-log-path", DEFAULT_LEARNING_LOG_JSON_PATH);
  bundlePath = Option.String("--bundle-path", "");
  analysisPath = Option.String("--analysis-path", "");
  windowStart = Option.String("--window-start", "");
  windowEnd = Option.String("--window-end", "");
  notifySlack = Option.String("--notify-slack", "false");
  slackWebhookUrl = Option.String("--slack-webhook-url", "");
  issueLabelsJson = Option.String("--issue-labels-json", "[\"daily-lens\",\"report\"]");
  runId = Option.String("--run-id", "");
  publicationSha = Option.String("--publication-sha", "");
  skipFollowupCandidates = Option.String("--skip-followup-candidates", "false");
  agentResultJson = Option.String("--agent-result-json", "");

  async execute() {
    const result = await runAnalysisLensFinalize({
      date: this.date,
      repo: this.repo,
      factoryId: this.factoryId,
      outputDir: this.outputDir,
      learningLogPath: this.learningLogPath,
      bundlePath: this.bundlePath,
      analysisPath: this.analysisPath,
      windowStart: this.windowStart,
      windowEnd: this.windowEnd,
      notifySlack: asBooleanString(this.notifySlack),
      slackWebhookUrl: this.slackWebhookUrl,
      factoryConfigWebhookUrl: resolveFactoryConfigSlackWebhookUrl(this.factoryId),
      issueLabels: JSON.parse(this.issueLabelsJson),
      runId: this.runId,
      publicationSha: this.publicationSha,
      skipFollowupCandidates: asBooleanString(this.skipFollowupCandidates),
      agentResultJson: this.agentResultJson,
    });
    this.context.stdout.write(JSON.stringify(result, null, 2));
    return 0;
  }
}
