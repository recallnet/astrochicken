import { existsSync, readFileSync } from "node:fs";

import { parseJson } from "../cli-helpers.ts";

function trim(value) {
  return String(value ?? "").trim();
}

// Imported inline to avoid circular dependency with merge-item-ops.
function resolveMergeTelemetryFilePath({ factoryId = "", runsDir = "" } = {}) {
  const resolvedFactoryId = trim(factoryId);
  const resolvedRunsDir = trim(runsDir);
  const dir = resolvedRunsDir || `.hatch/${resolvedFactoryId}/runs`;
  return {
    factoryId: resolvedFactoryId,
    filePath: `${dir}/.merge-resolution-failures.jsonl`,
  };
}

export function countResolutionFailures({
  recurrenceKey = "",
  lookbackHours = 24,
  factoryId = "",
  runsDir = "",
} = {}) {
  const paths = resolveMergeTelemetryFilePath({ factoryId, runsDir });
  const resolvedKey = trim(recurrenceKey);
  const parsedLookback = Number(lookbackHours);
  const lookbackWindowHours = Number.isFinite(parsedLookback) && parsedLookback > 0 ? parsedLookback : 24;
  const cutoffMs = Date.now() - (lookbackWindowHours * 60 * 60 * 1000);
  if (!existsSync(paths.filePath)) {
    return {
      recurrence_key: resolvedKey,
      count_24h: 0,
      last_occurrence: null,
    };
  }
  const lines = String(readFileSync(paths.filePath, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let count = 0;
  let lastOccurrenceMs = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (trim(parsed.recurrence_key) !== resolvedKey) continue;
    const timestamp = trim(parsed.timestamp);
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    if (timestampMs < cutoffMs) continue;
    count += 1;
    if (timestampMs > lastOccurrenceMs) {
      lastOccurrenceMs = timestampMs;
    }
  }
  return {
    recurrence_key: resolvedKey,
    count_24h: count,
    last_occurrence: Number.isFinite(lastOccurrenceMs)
      ? new Date(lastOccurrenceMs).toISOString()
      : null,
  };
}

export function buildGoalScopedMergeMessage({ milestoneTitle = "", goalIssueNumber = "", goalIssueTitle = "", mergeCandidatesRaw = "[]" } = {}) {
  const goalNumber = String(goalIssueNumber || "").trim()
    || (() => {
      const m = String(milestoneTitle || "").match(/^goal-(\d+)/);
      return m ? m[1] : "";
    })();
  if (!goalNumber) return { merge_commit_message: "" };
  const title = String(goalIssueTitle || "").trim() || String(milestoneTitle || "").trim();
  const candidates = parseJson(String(mergeCandidatesRaw || "[]"), []);
  const issueNumbers = (Array.isArray(candidates) ? candidates : [])
    .map((c) => String(c?.issue_number || "").trim())
    .filter(Boolean);
  const closesLine = issueNumbers.length > 0
    ? `Closes ${issueNumbers.map((n) => `#${n}`).join(", ")}`
    : "";
  const subject = `feat(goal-${goalNumber}): ${title} (#${goalNumber})`;
  const body = [closesLine, `Issues: ${issueNumbers.length} merged`].filter(Boolean).join("\n");
  return {
    merge_commit_message: body ? `${subject}\n\n${body}` : subject,
  };
}
