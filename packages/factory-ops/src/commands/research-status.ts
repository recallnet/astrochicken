import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";

import { trim, parseJson, ghJson } from "../lib/cli-helpers.ts";

const STAGES = Object.freeze([
  "hypothesis_formulation",
  "data_infrastructure",
  "feature_engineering_eda",
  "strategy_design",
  "backtesting",
  "verification_red_team",
  "synthesis",
]);


function normalizePath(pathValue = "", fallback = "") {
  const raw = trim(pathValue) || trim(fallback);
  if (!raw) return "";
  return normalize(isAbsolute(raw) ? raw : resolve(process.cwd(), raw));
}


function parseIsoMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function findRunStartedMs(state = {}, fallbackMtimeMs = 0) {
  const candidates = [
    state?.startedAt,
    state?.createdAt,
    state?.created_at,
    state?.updatedAt,
    state?.updated_at,
  ];

  for (const candidate of candidates) {
    const parsed = parseIsoMs(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Number.isFinite(fallbackMtimeMs) ? fallbackMtimeMs : Number.NaN;
}

function runStatusFromState(state = {}) {
  return trim(state?.status || "unknown") || "unknown";
}

function currentStageFromContext(context = {}, currentNode = "") {
  const direct = trim(context.current_stage || context.stage_id || context.pending_stage_id);
  if (direct) return direct;

  const node = trim(currentNode).toLowerCase();
  for (const stage of STAGES) {
    if (node.includes(stage)) return stage;
  }
  return "";
}

function approvalPendingFromContext(context = {}, currentNode = "") {
  const pending = trim(context.approval_state).toLowerCase();
  if (pending === "pending") return true;
  if (trim(currentNode) === "approval_pending_terminal") return true;
  return false;
}

function approvalPendingStageFromContext(context = {}, currentNode = "") {
  return trim(
    context.pending_stage_id
      || context.stage_id
      || context.current_stage
      || (trim(currentNode) === "approval_pending_terminal" ? context.stage_id : ""),
  );
}

function collectStageStatus(context = {}) {
  const status = {};
  for (const stage of STAGES) {
    status[stage] = trim(context[`stage_${stage}_status`] || "");
  }
  return status;
}

function collectArtifactRefs(context = {}) {
  const refs = {};
  for (const stage of STAGES) {
    refs[stage] = trim(context[`stage_${stage}_artifact_ref`] || "");
  }
  return refs;
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stageFromLabels(labels = []) {
  for (const label of Array.isArray(labels) ? labels : []) {
    const name = trim(label?.name || label || "");
    if (!name.startsWith("research:stage/")) continue;
    return name.slice("research:stage/".length);
  }
  return "";
}

function loadGithubStage({ repo = "", hypothesisIssue = "" } = {}) {
  const normalizedRepo = trim(repo);
  const issueNumber = toPositiveInt(hypothesisIssue);
  if (!normalizedRepo || issueNumber <= 0) {
    return {
      ok: false,
      code: "missing_github_args",
      stage: "",
      source: "unknown",
    };
  }

  const parsed = ghJson([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    normalizedRepo,
    "--json",
    "labels",
  ], null);
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      code: "github_read_failed",
      stage: "",
      source: "unknown",
      error: "gh issue view failed",
    };
  }
  const labels = Array.isArray(parsed?.labels) ? parsed.labels : [];
  const stage = stageFromLabels(labels);
  if (!stage) {
    return {
      ok: false,
      code: "stage_not_found",
      stage: "",
      source: "unknown",
    };
  }

  return {
    ok: true,
    code: "ok",
    stage,
    source: "github_label",
  };
}

function latestRunForHypothesis({ hypothesisId = "", runsDir = "", runId = "" } = {}) {
  const normalizedHypothesisId = trim(hypothesisId);
  const resolvedRunsDir = normalizePath(runsDir, ".hatch/research/runs");

  let entries = [];
  try {
    entries = readdirSync(resolvedRunsDir, { withFileTypes: true });
  } catch (error) {
    const code = trim(error?.code || "");
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "no_runs_found",
        hypothesis_id: normalizedHypothesisId,
        runs_dir: resolvedRunsDir,
      };
    }
    return {
      ok: false,
      code: "runs_dir_unreadable",
      hypothesis_id: normalizedHypothesisId,
      runs_dir: resolvedRunsDir,
      error: String(error?.message || error),
    };
  }

  const matchingRuns = [];
  const requestedRunId = trim(runId);

  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const candidateRunId = trim(entry.name);
    if (!candidateRunId) continue;
    if (requestedRunId && candidateRunId !== requestedRunId) continue;

    const statePath = join(resolvedRunsDir, candidateRunId, "state.json");
    let raw = "";
    try {
      raw = readFileSync(statePath, "utf8");
    } catch {
      continue;
    }

    const parsed = parseJson(raw, null);
    if (!parsed || typeof parsed !== "object") continue;
    const context = parsed.context && typeof parsed.context === "object" ? parsed.context : {};
    const runHypothesisId = trim(context.hypothesis_id || "");
    if (runHypothesisId !== normalizedHypothesisId) continue;

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(statePath).mtimeMs;
    } catch {
      mtimeMs = 0;
    }

    matchingRuns.push({
      run_id: candidateRunId,
      state: parsed,
      context,
      started_ms: findRunStartedMs(parsed, mtimeMs),
      mtime_ms: mtimeMs,
    });
  }

  if (matchingRuns.length === 0) {
    return {
      ok: false,
      code: "no_runs_found",
      hypothesis_id: normalizedHypothesisId,
      runs_dir: resolvedRunsDir,
    };
  }

  matchingRuns.sort((left, right) => {
    const leftStarted = Number.isFinite(left.started_ms) ? left.started_ms : left.mtime_ms;
    const rightStarted = Number.isFinite(right.started_ms) ? right.started_ms : right.mtime_ms;
    if (leftStarted !== rightStarted) return rightStarted - leftStarted;
    return right.run_id.localeCompare(left.run_id);
  });

  return {
    ok: true,
    code: "ok",
    runs_dir: resolvedRunsDir,
    latest: matchingRuns[0],
  };
}

export function researchStatus({
  hypothesisId = "",
  runsDir = "",
  repo = "",
  hypothesisIssue = "",
  runId = "",
  useGithub = false,
} = {}) {
  const normalizedHypothesisId = trim(hypothesisId);
  if (!normalizedHypothesisId) {
    return {
      ok: false,
      error: "missing_hypothesis_id",
      message: "hypothesisId is required",
    };
  }

  if (useGithub) {
    const githubStage = loadGithubStage({ repo, hypothesisIssue });
    if (githubStage.ok) {
      return {
        ok: true,
        hypothesis_id: normalizedHypothesisId,
        stage: githubStage.stage,
        source: "github_label",
      };
    }
  }

  const runLookup = latestRunForHypothesis({
    hypothesisId: normalizedHypothesisId,
    runsDir,
    runId,
  });

  if (!runLookup.ok) {
    if (useGithub) {
      return {
        ok: true,
        hypothesis_id: normalizedHypothesisId,
        stage: null,
        source: "unknown",
      };
    }
    return {
      ok: false,
      error: runLookup.code,
      hypothesis_id: normalizedHypothesisId,
      runs_dir: runLookup.runs_dir,
      message: trim(runLookup.error || ""),
    };
  }

  const latest = runLookup.latest;
  const currentNode = trim(latest.state.currentNode || "");
  const currentStage = currentStageFromContext(latest.context, currentNode);
  const approvalPending = approvalPendingFromContext(latest.context, currentNode);

  return {
    ok: true,
    hypothesis_id: normalizedHypothesisId,
    runs_dir: runLookup.runs_dir,
    latest_run_id: latest.run_id,
    run_status: runStatusFromState(latest.state),
    current_stage: currentStage,
    approval_pending: approvalPending,
    approval_pending_stage: approvalPending ? approvalPendingStageFromContext(latest.context, currentNode) : "",
    stage_status: collectStageStatus(latest.context),
    artifact_refs: collectArtifactRefs(latest.context),
    source: "run_state",
  };
}
