import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";

const RESEARCH_APPROVAL_STAGES = Object.freeze([
  "hypothesis_formulation",
  "feature_engineering_eda",
  "backtesting",
  "verification_red_team",
]);


function resolvePath(pathValue = "", fallback = "") {
  const raw = trim(pathValue) || trim(fallback);
  if (!raw) return "";
  return normalize(isAbsolute(raw) ? raw : resolve(process.cwd(), raw));
}

function parseApprovedValue(value) {
  if (typeof value === "boolean") return value;
  const raw = trim(value).toLowerCase();
  if (["true", "1", "yes"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  return null;
}

function approvalFilePath({ approvalsDir = "", hypothesisId = "", stage = "" } = {}) {
  const root = resolvePath(approvalsDir, ".hatch/research/approvals");
  if (!root) return "";
  return join(root, `hyp-${trim(hypothesisId)}-${trim(stage)}.json`);
}

export function approveResearchStage({
  hypothesisId = "",
  stage = "",
  approved = "",
  reviewerId = "",
  reviewerNote = "",
  approvalsDir = "",
} = {}) {
  const normalizedHypothesisId = trim(hypothesisId);
  if (!normalizedHypothesisId) {
    return {
      ok: false,
      error: "missing_hypothesis_id",
      message: "hypothesisId is required",
    };
  }

  const normalizedStage = trim(stage);
  if (!normalizedStage) {
    return {
      ok: false,
      error: "missing_stage",
      message: "stage is required",
      valid_stages: [...RESEARCH_APPROVAL_STAGES],
    };
  }

  if (!RESEARCH_APPROVAL_STAGES.includes(normalizedStage)) {
    return {
      ok: false,
      error: "invalid_stage",
      message: `unsupported stage: ${normalizedStage}`,
      stage: normalizedStage,
      valid_stages: [...RESEARCH_APPROVAL_STAGES],
    };
  }

  const normalizedApproved = parseApprovedValue(approved);
  if (normalizedApproved === null) {
    return {
      ok: false,
      error: "invalid_approved",
      message: "approved must be true/false",
      approved: trim(approved),
    };
  }

  const targetPath = approvalFilePath({
    approvalsDir,
    hypothesisId: normalizedHypothesisId,
    stage: normalizedStage,
  });

  if (!targetPath) {
    return {
      ok: false,
      error: "invalid_approvals_dir",
      message: "approvalsDir could not be resolved",
    };
  }

  const payload = {
    approved: normalizedApproved,
    reviewer_id: trim(reviewerId),
    reviewer_note: trim(reviewerNote),
    stage: normalizedStage,
    hypothesis_id: normalizedHypothesisId,
    timestamp: new Date().toISOString(),
  };

  const encoded = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, encoded, "utf8");
    renameSync(tmpPath, targetPath);
  } catch (error) {
    return {
      ok: false,
      error: "approvals_write_failed",
      message: String(error?.message || error),
      approval_path: targetPath,
      hypothesis_id: normalizedHypothesisId,
      stage: normalizedStage,
    };
  }

  return {
    ok: true,
    approval_path: targetPath,
    ...payload,
  };
}
