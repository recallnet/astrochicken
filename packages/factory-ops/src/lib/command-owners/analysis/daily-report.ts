import { promises as fsPromises } from "node:fs";
import { join } from "node:path";

import { Command, Option } from "clipanion";

import { parsePositiveNumber } from "../../../cli/helpers.ts";
import { collectDailyInsightData } from "../../analysis/collectors.ts";
import { renderDailyInsight } from "../../analysis/renderer.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

let runtimeOverrides = {};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoOrEmpty(value) {
  if (!value) return "";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeDateInput(dateValue = "") {
  const normalized = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("invalid_date: expected --date in YYYY-MM-DD format");
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error("invalid_date: expected --date in YYYY-MM-DD format");
  }
  return normalized;
}

// For a report dated YYYY-MM-DD, analyze the previous 24h slice.
// Example: report date 2026-03-06 => analysis window [2026-03-05T00:00:00Z, 2026-03-06T00:00:00Z).
export function computePreviousDayWindow(reportDate) {
  const normalizedDate = normalizeDateInput(reportDate);
  const analysisEndMs = Date.parse(`${normalizedDate}T00:00:00.000Z`);
  const analysisStartMs = analysisEndMs - DAY_MS;
  return {
    date: normalizedDate,
    analysisStart: new Date(analysisStartMs).toISOString(),
    analysisEnd: new Date(analysisEndMs).toISOString(),
  };
}

function uniqueBy(items, keySelector) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keySelector(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildEvidence(type, id, extra = {}) {
  if (!id) return null;
  return {
    type,
    id,
    ...extra,
  };
}

function buildNormalizedPayload({
  date,
  repo,
  analysisStart,
  analysisEnd,
  collected,
  collectorErrors = [],
  logLevel = "info",
} = {}) {
  const langfuseTraces = uniqueBy(
    asArray(collected?.langfuse?.traces).map((trace) => ({
      id: String(trace?.id || trace?.trace_id || trace?.traceId || ""),
      name: String(trace?.name || trace?.session_name || ""),
      cost_usd: toNumber(trace?.cost_usd ?? trace?.cost ?? 0, 0),
      duration_ms: toNumber(trace?.duration_ms ?? trace?.duration ?? 0, 0),
    })),
    (trace) => trace.id,
  );

  const issues = uniqueBy(
    asArray(collected?.github?.issues).map((issue) => ({
      number: Number(issue?.number) || 0,
      title: String(issue?.title || ""),
      state: String(issue?.state || ""),
      url: String(issue?.url || ""),
    })),
    (issue) => String(issue.number || ""),
  );

  const pullRequests = uniqueBy(
    asArray(collected?.github?.pull_requests).map((pr) => ({
      number: Number(pr?.number) || 0,
      title: String(pr?.title || ""),
      state: String(pr?.state || ""),
      merged_at: toIsoOrEmpty(pr?.merged_at || pr?.mergedAt),
      url: String(pr?.url || ""),
    })),
    (pr) => String(pr.number || ""),
  );

  const gitCommits = uniqueBy(
    asArray(collected?.git?.commits).map((commit) => ({
      sha: String(commit?.sha || ""),
      subject: String(commit?.subject || ""),
      author: String(commit?.author || ""),
      committed_at: toIsoOrEmpty(commit?.committed_at || commit?.committedAt),
    })),
    (commit) => commit.sha,
  );

  const runs = uniqueBy(
    asArray(collected?.hatch_runs?.runs).map((run) => ({
      run_id: String(run?.run_id || run?.runId || ""),
      status: String(run?.status || "unknown"),
      node: String(run?.node || run?.current_node || ""),
      updated_at: toIsoOrEmpty(run?.updated_at || run?.updatedAt),
    })),
    (run) => run.run_id,
  );

  const supervisorTicks = uniqueBy(
    asArray(collected?.supervisor?.ticks).map((tick) => ({
      run_id: String(tick?.run_id || tick?.runId || ""),
      status: String(tick?.status || "unknown"),
      node: String(tick?.node || ""),
      updated_at: toIsoOrEmpty(tick?.updated_at || tick?.updatedAt),
    })),
    (tick) => tick.run_id,
  );

  const traceCostTotal = langfuseTraces.reduce((sum, trace) => sum + toNumber(trace.cost_usd, 0), 0);
  const traceDurationTotal = langfuseTraces.reduce((sum, trace) => sum + toNumber(trace.duration_ms, 0), 0);
  const mergedPrs = pullRequests.filter((pr) => Boolean(pr.merged_at)).length;
  const failedRuns = runs.filter((run) => run.status !== "completed").length;

  const missingSources = {
    missing_langfuse: langfuseTraces.length === 0,
    missing_github: issues.length === 0 && pullRequests.length === 0,
    missing_git: gitCommits.length === 0,
    missing_hatch_runs: runs.length === 0,
    missing_supervisor_state: supervisorTicks.length === 0,
  };

  const executiveSummary = [
    `Throughput: merged_prs=${mergedPrs}, issues_observed=${issues.length}, commits=${gitCommits.length}.`,
    `Reliability: runs_observed=${runs.length}, non_completed_runs=${failedRuns}.`,
    `Coverage: missing_sources=${Object.entries(missingSources).filter(([, missing]) => missing).map(([key]) => key).join(", ") || "none"}.`,
  ];

  const domains = {
    delivery: [
      {
        title: "Merged pull requests in window",
        summary: `${mergedPrs} pull requests merged during the analysis window.`,
        evidence: topEvidenceFromPullRequests(pullRequests),
      },
      {
        title: "Issue activity",
        summary: `${issues.length} issues were created or closed in the analysis window.`,
        evidence: topEvidenceFromIssues(issues),
      },
      {
        title: "Commit velocity",
        summary: `${gitCommits.length} commits landed in the repository during the analysis window.`,
        evidence: topEvidenceFromCommits(gitCommits),
      },
    ],
    reliability: [
      {
        title: "Run outcomes",
        summary: `${failedRuns} of ${runs.length} runs were not completed.`,
        evidence: topEvidenceFromRuns(runs),
      },
      {
        title: "Supervisor tick activity",
        summary: `${supervisorTicks.length} supervisor ticks were observed in the window.`,
        evidence: topEvidenceFromSupervisorTicks(supervisorTicks),
      },
      {
        title: "Most active run node",
        summary: `Latest run node=${String(runs[0]?.node || "unknown")}.`,
        evidence: topEvidenceFromRuns(runs),
      },
    ],
    observability: [
      {
        title: "Langfuse trace volume",
        summary: `${langfuseTraces.length} traces available for analysis.`,
        evidence: topEvidenceFromTraces(langfuseTraces),
      },
      {
        title: "Trace cost",
        summary: `Total trace cost=${traceCostTotal.toFixed(4)} USD.`,
        evidence: topEvidenceFromTraces(langfuseTraces),
      },
      {
        title: "Trace duration",
        summary: `Total trace duration=${traceDurationTotal} ms.`,
        evidence: topEvidenceFromTraces(langfuseTraces),
      },
    ],
  };

  const anomalies = [];
  if (failedRuns > 0) {
    anomalies.push({
      title: "Non-completed hatch runs detected",
      summary: `${failedRuns} run(s) did not reach completed status.`,
      evidence: topEvidenceFromRuns(runs.filter((run) => run.status !== "completed")),
    });
  }
  if (mergedPrs === 0) {
    anomalies.push({
      title: "No merged pull requests",
      summary: "No pull requests merged in the analysis window.",
      evidence: topEvidenceFromPullRequests(pullRequests),
    });
  }
  for (const [flag, missing] of Object.entries(missingSources)) {
    if (missing) {
      anomalies.push({
        title: `Missing source coverage: ${flag}`,
        summary: `${flag}=true for this report window.`,
        evidence: [],
      });
    }
  }

  const opportunities = [];
  if (missingSources.missing_langfuse) {
    opportunities.push({
      title: "Restore Langfuse ingestion",
      summary: "Backfill trace export to unblock cost and latency analysis coverage.",
      evidence: [],
    });
  }
  if (failedRuns > 0) {
    opportunities.push({
      title: "Reduce non-completed run rate",
      summary: "Prioritize remediation for repeatedly failing run nodes.",
      evidence: topEvidenceFromRuns(runs.filter((run) => run.status !== "completed")),
    });
  }
  if (mergedPrs === 0) {
    opportunities.push({
      title: "Increase shipping throughput",
      summary: "Inspect blocked waves and unmerged PRs to restore daily merge cadence.",
      evidence: topEvidenceFromPullRequests(pullRequests),
    });
  }

  return {
    date,
    repo,
    analysis_window: {
      start: analysisStart,
      end: analysisEnd,
    },
    analysisWindow: {
      start: analysisStart,
      end: analysisEnd,
    },
    executive_summary: executiveSummary,
    metrics_snapshot: {
      traces: langfuseTraces.length,
      trace_cost_total_usd: Number(traceCostTotal.toFixed(4)),
      trace_duration_total_ms: traceDurationTotal,
      issues: issues.length,
      pull_requests: pullRequests.length,
      merged_pull_requests: mergedPrs,
      git_commits: gitCommits.length,
      hatch_runs: runs.length,
      hatch_runs_non_completed: failedRuns,
      supervisor_ticks: supervisorTicks.length,
    },
    domains,
    anomalies,
    opportunities,
    self_improvement: {
      learnings: [
        `The report used a strict previous-day window: ${analysisStart} to ${analysisEnd}.`,
        `Observed source counts: traces=${langfuseTraces.length}, issues=${issues.length}, prs=${pullRequests.length}, runs=${runs.length}, commits=${gitCommits.length}.`,
      ],
      questions: Object.entries(missingSources)
        .filter(([, missing]) => missing)
        .map(([flag]) => `Why was ${flag}=true for date ${date}?`),
      improvement_suggestions: [
        "Keep collector payload shape stable; add contract tests when new fields are introduced.",
        "Prefer deterministic source IDs in findings to improve downstream traceability.",
      ],
      predictions: [
        failedRuns > 0
          ? "If failing run nodes remain unaddressed, anomaly counts will persist in the next report."
          : "If run completion remains healthy, reliability anomalies should stay low in the next report.",
      ],
    },
    sources: {
      langfuse_traces: langfuseTraces,
      issues,
      pull_requests: pullRequests,
      runs,
      git_commits: gitCommits,
      supervisor_ticks: supervisorTicks,
    },
    missing_sources: missingSources,
    meta: {
      generated_at: new Date().toISOString(),
      report_date: date,
      repo,
      analysis_start: analysisStart,
      analysis_end: analysisEnd,
      trace_cost_total_usd: Number(traceCostTotal.toFixed(4)),
      trace_duration_total_ms: traceDurationTotal,
      source_counts: {
        langfuse_traces: langfuseTraces.length,
        github_issues: issues.length,
        github_pull_requests: pullRequests.length,
        hatch_runs: runs.length,
        git_commits: gitCommits.length,
        supervisor_ticks: supervisorTicks.length,
      },
      collector_errors: collectorErrors,
      log_level: String(logLevel || "info"),
    },
  };
}

function topEvidenceFromTraces(traces) {
  return asArray(traces)
    .slice(0, 3)
    .map((trace) => buildEvidence("trace", trace.id, {
      cost_usd: trace.cost_usd,
      duration_ms: trace.duration_ms,
    }))
    .filter(Boolean);
}

function topEvidenceFromIssues(issues) {
  return asArray(issues)
    .slice(0, 3)
    .map((issue) => buildEvidence("issue", issue.number ? `#${issue.number}` : "", {}))
    .filter(Boolean);
}

function topEvidenceFromPullRequests(pullRequests) {
  return asArray(pullRequests)
    .slice(0, 3)
    .map((pr) => buildEvidence("pull_request", pr.number ? `#${pr.number}` : "", {}))
    .filter(Boolean);
}

function topEvidenceFromRuns(runs) {
  return asArray(runs)
    .slice(0, 3)
    .map((run) => buildEvidence("run", run.run_id, {}))
    .filter(Boolean);
}

function topEvidenceFromSupervisorTicks(ticks) {
  return asArray(ticks)
    .slice(0, 3)
    .map((tick) => buildEvidence("supervisor_tick", tick.run_id, {}))
    .filter(Boolean);
}

function topEvidenceFromCommits(commits) {
  return asArray(commits)
    .slice(0, 3)
    .map((commit) => buildEvidence("git_commit", commit.sha, {}))
    .filter(Boolean);
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
    collectDailyInsightData: runtimeOverrides.collectDailyInsightData || collectDailyInsightData,
    renderDailyInsight: runtimeOverrides.renderDailyInsight || renderDailyInsight,
  };
}

export function setAnalysisDailyReportRuntimeForTest(overrides = {}) {
  runtimeOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
}

export function resetAnalysisDailyReportRuntimeForTest() {
  runtimeOverrides = {};
}

export async function runAnalysisDailyReport({
  date = "",
  repo = "",
  outputDir = "reports/daily",
  langfuseRetries = 2,
  runsDir = ".hatch/runs",
  repoPath = ".",
  logLevel = "info",
} = {}) {
  if (!String(date || "").trim()) {
    throw new Error("missing_date: --date is required");
  }
  if (!String(repo || "").trim()) {
    throw new Error("missing_repo: --repo is required");
  }

  const { analysisStart, analysisEnd, date: normalizedDate } = computePreviousDayWindow(date);
  const runtime = resolveRuntimeDeps();

  let collected = {};
  const collectorErrors = [];
  try {
    collected = await runtime.collectDailyInsightData({
      date: normalizedDate,
      repo,
      analysisStart,
      analysisEnd,
      langfuseRetries,
      runsDir,
      repoPath,
    });
  } catch (error) {
    collectorErrors.push(`collector_bundle_failed: ${String(error?.message || error)}`);
    collected = {};
  }

  const sourceErrors = [
    collected?.langfuse?.meta?.error,
    collected?.github?.meta?.error,
    collected?.git?.meta?.error,
    collected?.hatch_runs?.meta?.error,
    collected?.supervisor?.meta?.error,
  ].filter(Boolean);

  const payload = buildNormalizedPayload({
    date: normalizedDate,
    repo,
    analysisStart,
    analysisEnd,
    collected,
    collectorErrors: [...collectorErrors, ...sourceErrors],
    logLevel,
  });

  const rendered = runtime.renderDailyInsight(payload);

  const markdownPath = join(outputDir, `${normalizedDate}.md`);
  const jsonPath = join(outputDir, `${normalizedDate}.json`);

  try {
    await runtime.fs.mkdir(outputDir, { recursive: true });
    await runtime.fs.writeFile(markdownPath, `${rendered.markdown}\n`, "utf8");
    await runtime.fs.writeFile(jsonPath, `${JSON.stringify(rendered.json, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(`daily_report_write_failed: output_dir=${outputDir} date=${normalizedDate} message=${String(error?.message || error)}`);
  }

  return {
    ok: true,
    repo,
    date: normalizedDate,
    analysis_start: analysisStart,
    analysis_end: analysisEnd,
    markdown_path: markdownPath,
    json_path: jsonPath,
    missing_sources: rendered.json?.missing_sources || {},
  };
}

export class AnalysisDailyReportCommand extends Command {
  static paths = [["analysis", "daily-report"]];

  date = Option.String("--date", "");
  repo = Option.String("--repo", "");
  outputDir = Option.String("--output-dir", "reports/daily");
  langfuseRetries = Option.String("--langfuse-retries", "2");
  logLevel = Option.String("--log-level", "info");

  async execute() {
    try {
      const out = await runAnalysisDailyReport({
        date: this.date,
        repo: this.repo,
        outputDir: this.outputDir,
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
