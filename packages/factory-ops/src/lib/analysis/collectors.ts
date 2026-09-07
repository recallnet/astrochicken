import { runGhCli } from "@hatch/github-adapter";

import { collectManagedFleetData } from "./fleet-lens-collector.ts";
import {
  collectLangfuse,
  collectLangfuseMetrics,
  collectGithubState,
  collectGitHistory,
  collectRunsArtifacts,
  collectSupervisorStatus,
} from "./index.ts";
import { MissingDataReason, missingDataErrorText } from "./types.ts";
import { buildStateSnapshot, evaluateOpenBugGate } from "../../commands/supervisor-state-snapshot.ts";

export const COLLECTOR_TIMEOUT_MS = 120_000;

export function withTimeout(promise, label, timeoutMs = COLLECTOR_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        source: label,
        missing_data: [{ reason: MissingDataReason.SOURCE_MISSING, detail: `${label} timed out after ${timeoutMs}ms` }],
        _timed_out: true,
      });
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function toWindow({ analysisStart = "", analysisEnd = "", windowStart = "", windowEnd = "" } = {}) {
  return {
    windowStart: String(windowStart || analysisStart || ""),
    windowEnd: String(windowEnd || analysisEnd || ""),
  };
}

function toLegacyMeta(missingData = []) {
  return {
    error: missingDataErrorText(missingData),
  };
}

// @context:integration !critical Uses runGhCli from github-adapter instead of
// ghJson from cli-helpers, which violates the github_adapter_boundary gate.
// This is the injection default — callers can override with their own ghJsonFn.
function defaultGhJson(args, fallback = []) {
  const result = runGhCli(args);
  if (!result.ok) throw new Error("gh_json_failed");
  try {
    return JSON.parse(result.stdout || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export async function collectLangfuseBundle({
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  langfuseUrl,
  langfuseKey,
  langfuseRetries,
  fetchFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectLangfuse({
    ...window,
    langfuseUrl,
    langfuseKey,
    retries: langfuseRetries,
    ...(fetchFn ? { fetchFn } : {}),
  });
  return {
    ...out,
    traces: out.traces || [],
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectGitHubBundle({
  repo = "",
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  runsDir,
  ghJsonFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectGithubState({
    ...window,
    repo,
    ghJsonFn: ghJsonFn || defaultGhJson,
    buildStateSnapshotFn: buildStateSnapshot,
    evaluateOpenBugGateFn: evaluateOpenBugGate,
    ...(runsDir ? { runsDir } : {}),
  });

  return {
    ...out,
    issues: out.issues || [],
    pull_requests: out.pull_requests || [],
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectGitBundle({
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  repoPath = process.cwd(),
  gitLogFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectGitHistory({
    ...window,
    repoPath,
    ...(gitLogFn ? { gitLogFn } : {}),
  });

  return {
    ...out,
    commits: out.commits || [],
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectTaxiRunsBundle({
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  runsDir,
  readFileFn,
  readdirFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectRunsArtifacts({
    ...window,
    ...(runsDir ? { runsDir } : {}),
    ...(readFileFn ? { readFileFn } : {}),
    ...(readdirFn ? { readdirFn } : {}),
  });

  return {
    ...out,
    runs: out.runs || [],
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectLangfuseMetricsBundle({
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  langfuseUrl,
  langfuseKey,
  fetchFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectLangfuseMetrics({
    ...window,
    langfuseUrl,
    langfuseKey,
    ...(fetchFn ? { fetchFn } : {}),
  });
  return {
    ...out,
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectSupervisorBundle({
  analysisStart = "",
  analysisEnd = "",
  windowStart = "",
  windowEnd = "",
  execFileFn,
} = {}) {
  const window = toWindow({ analysisStart, analysisEnd, windowStart, windowEnd });
  const out = await collectSupervisorStatus({
    ...window,
    ...(execFileFn ? { execFileFn } : {}),
  });

  return {
    ...out,
    ticks: out.ticks || [],
    meta: toLegacyMeta(out.missing_data),
  };
}

export async function collectDailyInsightData({
  repo = "",
  analysisStart = "",
  analysisEnd = "",
  runsDir = ".hatch/runs",
  repoPath = process.cwd(),
  ghJsonFn,
  gitLogFn,
  readFileFn,
  readdirFn,
  execFileFn,
  fetchFn,
  langfuseUrl,
  langfuseKey,
  langfuseRetries,
} = {}) {
  const window = {
    windowStart: String(analysisStart || ""),
    windowEnd: String(analysisEnd || ""),
  };

  const [langfuse, langfuseMetrics, github, git, taxiRuns, supervisor, managedFleet] = await Promise.all([
    withTimeout(collectLangfuseBundle({
      ...window,
      langfuseUrl,
      langfuseKey,
      langfuseRetries,
      ...(fetchFn ? { fetchFn } : {}),
    }), "langfuse"),
    withTimeout(collectLangfuseMetricsBundle({
      ...window,
      langfuseUrl,
      langfuseKey,
      ...(fetchFn ? { fetchFn } : {}),
    }), "langfuse_metrics"),
    withTimeout(collectGitHubBundle({ ...window, repo, runsDir, ...(ghJsonFn ? { ghJsonFn } : {}) }), "github"),
    withTimeout(collectGitBundle({ ...window, repoPath, ...(gitLogFn ? { gitLogFn } : {}) }), "git"),
    withTimeout(collectTaxiRunsBundle({ ...window, runsDir, ...(readFileFn ? { readFileFn } : {}), ...(readdirFn ? { readdirFn } : {}) }), "hatch_runs"),
    withTimeout(collectSupervisorBundle({ ...window, ...(execFileFn ? { execFileFn } : {}) }), "supervisor"),
    withTimeout(collectManagedFleetData({ ...window, repoPath }), "managed_fleet"),
  ]);

  return {
    langfuse,
    langfuse_metrics: langfuseMetrics,
    github,
    git,
    hatch_runs: taxiRuns,
    supervisor,
    managed_fleet: managedFleet,
  };
}
