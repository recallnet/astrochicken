import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";
import { parseVerdictEnvelopeRaw, validateVerdictEnvelope } from "../lib/verdict-envelope.ts";



function asInteger(value) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function findLatestRecord(state = {}, nodeId = "") {
  const records = Array.isArray(state?.records) ? state.records : [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const row = records[index];
    if (trim(row?.nodeId) === nodeId) return row;
  }
  return null;
}

function deriveTriggerReason({ context = {}, disposition = "" } = {}) {
  const explicit = trim(context?.trigger_reason);
  if (explicit) return explicit;

  const normalized = trim(disposition).toLowerCase();
  if (normalized && normalized !== "approve") {
    const retryReview = trim(context?.retry_review).toLowerCase();
    const attempt = asInteger(context?.review_attempt);
    const maxAttempts = asInteger(context?.max_review_attempts);
    const reviewFailed = trim(context?.review_failed).toLowerCase() === "true";

    if (retryReview === "false") {
      if (attempt !== null && maxAttempts !== null && attempt >= maxAttempts) {
        return "retry_exhausted";
      }
      if (reviewFailed) return "retry_exhausted";
    }
  }

  return "";
}

export function inspectReviewVerdictFromRunState({ runId = "", runsDir = ".hatch/runs" } = {}) {
  const resolvedRunId = trim(runId);
  const resolvedRunsDir = trim(runsDir) || ".hatch/runs";
  const statePath = join(resolvedRunsDir, resolvedRunId, "state.json");

  if (!resolvedRunId || !existsSync(statePath)) {
    return {
      ok: false,
      error: "run_not_found",
      run_id: resolvedRunId,
    };
  }

  const state = parseJson(readFileSync(statePath, "utf8"), null);
  if (!state || typeof state !== "object") {
    return {
      ok: false,
      error: "run_state_invalid",
      run_id: resolvedRunId,
    };
  }

  const reviewRecord = findLatestRecord(state, "review");
  const routeRecord = findLatestRecord(state, "resolve_review_route");

  const rawReviewerOutput = trim(reviewRecord?.outcome?.output || "");
  const parsedReview = parseVerdictEnvelopeRaw(rawReviewerOutput) || parseJson(rawReviewerOutput, null);

  const routeOutputRaw = trim(routeRecord?.outcome?.output || "");
  const parsedRoute = parseJson(routeOutputRaw, null);

  const context = state?.context && typeof state.context === "object" ? state.context : {};

  const routeVerdict = parseVerdictEnvelopeRaw(JSON.stringify(parsedRoute || {}));
  const reviewVerdict = trim(
    routeVerdict?.disposition
      || parsedReview?.disposition
      || context?.disposition
      || "",
  );

  const reviewRouteReason = trim(
    parsedRoute?.route_reason
      || context?.route_reason
      || "",
  );

  return {
    ok: true,
    run_id: resolvedRunId,
    disposition: reviewVerdict,
    route_reason: reviewRouteReason,
    raw_reviewer_output: rawReviewerOutput,
    trigger_reason: deriveTriggerReason({ context, disposition: reviewVerdict }),
  };
}
