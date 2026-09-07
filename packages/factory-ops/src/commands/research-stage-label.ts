import { trim, gh } from "../lib/cli-helpers.ts";

const RESEARCH_STAGE_LABEL_BY_VALUE = Object.freeze({
  hypothesis_formulation: "research:stage/hypothesis_formulation",
  data_infrastructure: "research:stage/data_infrastructure",
  feature_engineering_eda: "research:stage/feature_engineering_eda",
  strategy_design: "research:stage/strategy_design",
  backtesting: "research:stage/backtesting",
  verification_red_team: "research:stage/verification_red_team",
  synthesis: "research:stage/synthesis",
});

const RESEARCH_STAGE_VALUES = Object.freeze(Object.keys(RESEARCH_STAGE_LABEL_BY_VALUE));
const RESEARCH_STAGE_LABELS = Object.freeze(Object.values(RESEARCH_STAGE_LABEL_BY_VALUE));
const RESEARCH_APPROVAL_LABELS = Object.freeze({
  pending: "research:approval/pending",
  approved: "research:approval/approved",
  rejected: "research:approval/rejected",
});


function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseApproved(value) {
  if (typeof value === "boolean") return value;
  const normalized = trim(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function runGh(args = [], { input = "" } = {}) {
  return gh(args, String(input || "").length > 0 ? { input: String(input) } : undefined);
}

function runGhJson(args = [], { ghExec = runGh } = {}) {
  const out = ghExec(args);
  if (!out?.ok) {
    return {
      ok: false,
      status: out?.status ?? 1,
      data: null,
      error: String(out?.stderr || out?.stdout || "gh_failed"),
    };
  }
  try {
    return {
      ok: true,
      status: out.status ?? 0,
      data: JSON.parse(String(out.stdout || "{}")),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: out.status ?? 1,
      data: null,
      error: String(error?.message || error || "json_parse_failed"),
    };
  }
}

function looksLikeLabelNotFound(text = "") {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("label") && normalized.includes("not found");
}

function stageLabelKey(stage = "") {
  return RESEARCH_STAGE_LABEL_BY_VALUE[trim(stage)] || "";
}

function collectKnownStageRemoveKeys(labels = [], keepLabel = "") {
  const names = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    const name = trim(label?.name || label || "");
    if (!RESEARCH_STAGE_LABELS.includes(name)) continue;
    if (name === keepLabel) continue;
    names.push(name);
  }
  return names;
}

function buildLabelEditArgs({ repo = "", issueNumber = 0, addLabels = [], removeLabels = [] } = {}) {
  return [
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    ...addLabels.flatMap((label) => ["--add-label", label]),
    ...removeLabels.flatMap((label) => ["--remove-label", label]),
  ];
}

export function setResearchStageLabel({
  repo = "",
  hypothesisIssue = "",
  stage = "",
  ghExec = runGh,
  ghJsonExec,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return { ok: false, code: "missing_repo", error: "repo is required" };
  }

  const issueNumber = toPositiveInt(hypothesisIssue);
  if (issueNumber <= 0) {
    return { ok: false, code: "invalid_hypothesis_issue", error: "hypothesisIssue must be a positive integer" };
  }

  const normalizedStage = trim(stage);
  if (!RESEARCH_STAGE_VALUES.includes(normalizedStage)) {
    return {
      ok: false,
      code: "invalid_stage",
      stage: normalizedStage,
      valid_stages: [...RESEARCH_STAGE_VALUES],
      error: "stage must be one of research pipeline stages",
    };
  }

  const label = stageLabelKey(normalizedStage);
  if (!label) {
    return {
      ok: false,
      code: "invalid_stage",
      stage: normalizedStage,
      valid_stages: [...RESEARCH_STAGE_VALUES],
      error: "stage label contract missing",
    };
  }

  const execJson = typeof ghJsonExec === "function"
    ? ghJsonExec
    : (args) => runGhJson(args, { ghExec });

  const viewed = execJson(["issue", "view", String(issueNumber), "--repo", normalizedRepo, "--json", "labels"]);
  if (!viewed?.ok) {
    return {
      ok: false,
      code: "issue_view_failed",
      stage: normalizedStage,
      label,
      issueNumber,
      error: String(viewed?.error || "gh issue view failed"),
    };
  }

  const labels = Array.isArray(viewed?.data?.labels) ? viewed.data.labels : [];
  const removeLabels = collectKnownStageRemoveKeys(labels, label);
  if (removeLabels.length > 0) {
    const removeArgs = buildLabelEditArgs({
      repo: normalizedRepo,
      issueNumber,
      removeLabels,
    });
    const removed = ghExec(removeArgs);
    if (!removed?.ok) {
      return {
        ok: false,
        code: "remove_stage_labels_failed",
        stage: normalizedStage,
        label,
        issueNumber,
        error: String(removed?.stderr || removed?.stdout || "gh issue edit remove failed"),
      };
    }
  }

  const addArgs = buildLabelEditArgs({
    repo: normalizedRepo,
    issueNumber,
    addLabels: [label],
  });
  const added = ghExec(addArgs);
  if (!added?.ok) {
    const detail = String(added?.stderr || added?.stdout || "gh issue edit add failed");
    if (looksLikeLabelNotFound(detail)) {
      return {
        ok: false,
        code: "label_not_found",
        stage: normalizedStage,
        label,
        issueNumber,
        error: detail,
      };
    }
    return {
      ok: false,
      code: "set_stage_label_failed",
      stage: normalizedStage,
      label,
      issueNumber,
      error: detail,
    };
  }

  return {
    ok: true,
    code: "ok",
    stage: normalizedStage,
    label,
    issueNumber,
  };
}

export function setResearchApprovalLabel({
  repo = "",
  hypothesisIssue = "",
  approved = "",
  approvalContext = {},
  ghExec = runGh,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return { ok: false, code: "missing_repo", error: "repo is required" };
  }

  const issueNumber = toPositiveInt(hypothesisIssue);
  if (issueNumber <= 0) {
    return { ok: false, code: "invalid_hypothesis_issue", error: "hypothesisIssue must be a positive integer" };
  }

  const approvedBool = parseApproved(approved);
  if (approvedBool === null) {
    return { ok: false, code: "invalid_approved", error: "approved must be true/false" };
  }

  const approvalState = trim(approvalContext?.approval_state || "").toLowerCase();
  const label = approvalState === "pending"
    ? RESEARCH_APPROVAL_LABELS.pending
    : (approvedBool ? RESEARCH_APPROVAL_LABELS.approved : RESEARCH_APPROVAL_LABELS.rejected);
  const removeLabels = Object.values(RESEARCH_APPROVAL_LABELS).filter((candidate) => candidate !== label);

  const editArgs = buildLabelEditArgs({
    repo: normalizedRepo,
    issueNumber,
    addLabels: [label],
    removeLabels,
  });

  const edited = ghExec(editArgs);
  if (!edited?.ok) {
    const detail = String(edited?.stderr || edited?.stdout || "gh issue edit failed");
    if (looksLikeLabelNotFound(detail)) {
      return {
        ok: false,
        code: "label_not_found",
        label,
        issueNumber,
        error: detail,
        comment_posted: false,
      };
    }
    return {
      ok: false,
      code: "set_approval_label_failed",
      label,
      issueNumber,
      error: detail,
      comment_posted: false,
    };
  }

  const contextObject = approvalContext && typeof approvalContext === "object" && !Array.isArray(approvalContext)
    ? approvalContext
    : {};
  const commentBody = [
    "<!-- research-approval-context -->",
    "```json",
    JSON.stringify({
      ...contextObject,
      approved: approvedBool,
      approval_label: label,
      hypothesis_issue: issueNumber,
      updated_at: new Date().toISOString(),
    }, null, 2),
    "```",
  ].join("\n");

  const commented = ghExec(["issue", "comment", String(issueNumber), "--repo", normalizedRepo, "--body", commentBody]);
  if (!commented?.ok) {
    return {
      ok: false,
      code: "comment_failed",
      label,
      issueNumber,
      error: String(commented?.stderr || commented?.stdout || "gh issue comment failed"),
      comment_posted: false,
    };
  }

  return {
    ok: true,
    code: "ok",
    label,
    issueNumber,
    comment_posted: true,
  };
}
