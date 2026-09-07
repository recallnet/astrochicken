import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseJson, trim } from "../lib/cli-helpers.ts";

function normalizeMergedResults(mergedResultsRaw = "") {
  const parsed = parseJson(String(mergedResultsRaw || "[]"), []);
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray(parsed.merged_results) ? parsed.merged_results : []);

  return rows
    .map((entry) => {
      if (entry && typeof entry === "object") return entry;
      if (typeof entry !== "string") return null;
      const decoded = parseJson(entry, null);
      return decoded && typeof decoded === "object" ? decoded : null;
    })
    .filter(Boolean)
    .map((entry) => ({
      issue_number: trim(entry.issue_number || entry.issue || entry.number),
      branch: trim(entry.branch),
      merge_status: trim(entry.merge_status || entry.status) || "merged",
    }))
    .filter((entry) => entry.issue_number || entry.branch || entry.merge_status);
}

function normalizeIssueTitles(issueTitlesRaw = "") {
  const parsed = parseJson(String(issueTitlesRaw || "{}"), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    const issue = trim(key).replace(/^#/, "");
    const title = trim(value);
    if (!issue || !title) continue;
    out[issue] = title;
  }
  return out;
}

function normalizeTranscript(value = "") {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function formatMergedIssues(markedRows = [], issueTitles = {}) {
  if (!Array.isArray(markedRows) || markedRows.length === 0) {
    return ["- _No merged issues were provided in merge context._"];
  }

  return markedRows.map((row) => {
    const issue = trim(row.issue_number).replace(/^#/, "");
    const title = issue && issueTitles[issue] ? ` — ${issueTitles[issue]}` : "";
    const branch = trim(row.branch) ? ` (branch: \`${trim(row.branch)}\`)` : "";
    const status = trim(row.merge_status) || "merged";
    const issueRef = issue ? `#${issue}` : "(no issue number)";
    return `- ${issueRef}${title} — status: \`${status}\`${branch}`;
  });
}

function buildSummary({ repo = "", milestoneTitle = "", readyIssueNumber = "", mergedCount = 0, mergeStdout = "", mergeStderr = "" } = {}) {
  const repoValue = trim(repo) || "unknown_repo";
  const milestoneValue = trim(milestoneTitle) || "(none)";
  const readyIssue = trim(readyIssueNumber).replace(/^#/, "");
  return [
    `> repo: ${repoValue}`,
    `> milestone: ${milestoneValue}`,
    `> ready_issue: ${readyIssue ? `#${readyIssue}` : "(none)"}`,
    `> merged_count: ${mergedCount}`,
    `> merge_stdout_lines: ${mergeStdout ? mergeStdout.split("\n").length : 0}`,
    `> merge_stderr_lines: ${mergeStderr ? mergeStderr.split("\n").length : 0}`,
  ].join("\n");
}

function buildTerminalDemoMarkdown({
  repo = "",
  runId = "",
  milestoneTitle = "",
  readyIssueNumber = "",
  mergedRows = [],
  issueTitles = {},
  mergeStdout = "",
  mergeStderr = "",
  generatedAt = "",
} = {}) {
  const mergedCount = mergedRows.length;
  const mergedIssueLines = formatMergedIssues(mergedRows, issueTitles);
  const summary = buildSummary({
    repo,
    milestoneTitle,
    readyIssueNumber,
    mergedCount,
    mergeStdout,
    mergeStderr,
  });

  return [
    "# Wave Terminal Demo",
    "",
    "## Metadata",
    `- repo: ${trim(repo) || "unknown_repo"}`,
    `- run_id: ${trim(runId) || "unknown_run"}`,
    `- milestone: ${trim(milestoneTitle) || "(none)"}`,
    `- ready_issue: ${trim(readyIssueNumber).replace(/^#/, "") ? `#${trim(readyIssueNumber).replace(/^#/, "")}` : "(none)"}`,
    "- demo_strategy: terminal",
    `- generated_at: ${trim(generatedAt) || new Date().toISOString()}`,
    `- merged_count: ${mergedCount}`,
    "",
    "## Compact Summary",
    summary,
    "",
    "## Merged Issues",
    ...mergedIssueLines,
    "",
    "## Merge Stdout",
    "```text",
    mergeStdout || "(empty)",
    "```",
    "",
    "## Merge Stderr",
    "```text",
    mergeStderr || "(empty)",
    "```",
    "",
  ].join("\n");
}

export function generateWaveTerminalDemo({
  runId = "",
  runsDir = ".hatch/runs",
  repo = "",
  milestoneTitle = "",
  readyIssueNumber = "",
  mergedResultsRaw = "[]",
  mergeStdout = "",
  mergeStderr = "",
  issueTitlesRaw = "{}",
  generatedAt = new Date().toISOString(),
} = {}, {
  mkdirSyncFn = mkdirSync,
  writeFileSyncFn = writeFileSync,
} = {}) {
  const normalizedRunId = trim(runId);
  if (!normalizedRunId) {
    return {
      ok: false,
      demo_generation_status: "failed",
      demo_generation_error: "missing_run_id",
      demo_artifact_path: "",
      demo_artifact_bytes: 0,
      demo_strategy: "terminal",
      merged_count: 0,
    };
  }

  const mergedRows = normalizeMergedResults(mergedResultsRaw);
  const issueTitles = normalizeIssueTitles(issueTitlesRaw);
  const normalizedStdout = normalizeTranscript(mergeStdout);
  const normalizedStderr = normalizeTranscript(mergeStderr);

  const markdown = buildTerminalDemoMarkdown({
    repo,
    runId: normalizedRunId,
    milestoneTitle,
    readyIssueNumber,
    mergedRows,
    issueTitles,
    mergeStdout: normalizedStdout,
    mergeStderr: normalizedStderr,
    generatedAt,
  });

  const artifactPath = resolve(join(runsDir, normalizedRunId, "artifacts", "wave-demo-terminal.md"));

  try {
    mkdirSyncFn(dirname(artifactPath), { recursive: true });
    writeFileSyncFn(artifactPath, markdown, "utf8");
    return {
      ok: true,
      demo_generation_status: "generated",
      demo_generation_error: "",
      demo_artifact_path: artifactPath,
      demo_artifact_bytes: Buffer.byteLength(markdown, "utf8"),
      demo_strategy: "terminal",
      merged_count: mergedRows.length,
    };
  } catch (error) {
    return {
      ok: false,
      demo_generation_status: "failed",
      demo_generation_error: `demo_artifact_write_failed:${String(error?.message || error || "unknown_error")}`,
      demo_artifact_path: artifactPath,
      demo_artifact_bytes: 0,
      demo_strategy: "terminal",
      merged_count: mergedRows.length,
    };
  }
}
