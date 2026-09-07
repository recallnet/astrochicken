import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim } from "../lib/cli-helpers.ts";

function normalizeReadyIssueNumber(value = "") {
  return trim(value).replace(/^#/, "");
}

function resolveDemoContent({ demoArtifactPath = "", demoArtifactContent = "" } = {}, { readFileSyncFn = readFileSync } = {}) {
  const inline = String(demoArtifactContent || "");
  if (trim(inline)) {
    return { ok: true, content: inline, source: "inline", error: "" };
  }

  const normalizedPath = trim(demoArtifactPath);
  if (!normalizedPath) {
    return { ok: false, content: "", source: "", error: "missing_demo_artifact_content" };
  }

  try {
    const content = String(readFileSyncFn(normalizedPath, "utf8") || "");
    if (!trim(content)) {
      return { ok: false, content: "", source: normalizedPath, error: "empty_demo_artifact_content" };
    }
    return { ok: true, content, source: normalizedPath, error: "" };
  } catch (error) {
    return {
      ok: false,
      content: "",
      source: normalizedPath,
      error: `demo_artifact_read_failed:${String(error?.message || error || "unknown_error")}`,
    };
  }
}

function extractMergedIssueNumbers(demoContent = "") {
  const matches = String(demoContent || "").matchAll(/(^|\s)-\s*(?:issue\s+)?#(\d+)\b/gi);
  const numbers = new Set();
  for (const match of matches) {
    const issue = trim(match?.[2]);
    if (issue) numbers.add(issue);
  }
  return [...numbers].sort((left, right) => Number(left) - Number(right));
}

function buildStablePublishSummary({ milestoneTitle = "", readyIssueNumber = "", demoStrategy = "terminal" } = {}) {
  const milestone = trim(milestoneTitle) || "wave";
  const readyIssue = normalizeReadyIssueNumber(readyIssueNumber);
  return `Wave demo (${trim(demoStrategy) || "terminal"}) for ${milestone}${readyIssue ? ` #${readyIssue}` : ""}`;
}

function buildStablePublishEvidence({
  milestoneTitle = "",
  readyIssueNumber = "",
  demoStrategy = "terminal",
  demoContent = "",
  demoArtifactPath = "",
} = {}) {
  return JSON.stringify({
    schema_version: "wave_demo_publish.v1",
    demo_strategy: trim(demoStrategy) || "terminal",
    milestone_title: trim(milestoneTitle),
    ready_issue_number: normalizeReadyIssueNumber(readyIssueNumber),
    merged_issue_numbers: extractMergedIssueNumbers(demoContent),
    demo_artifact_name: trim(demoArtifactPath) ? basename(trim(demoArtifactPath)) : "inline",
  });
}

export function publishWaveDemoArtifact({
  repo = "",
  runId = "",
  pipeline = "wave_execute",
  milestoneTitle = "",
  readyIssueNumber = "",
  demoArtifactPath = "",
  demoArtifactContent = "",
  demoStrategy = "terminal",
} = {}, {
  emitSupervisorArtifactFn = emitSupervisorArtifact,
  readFileSyncFn = readFileSync,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return {
      ok: false,
      artifact_url: "",
      demo_artifact_url: "",
      demo_publish_status: "failed",
      demo_publish_error: "missing_repo",
    };
  }

  const content = resolveDemoContent(
    { demoArtifactPath, demoArtifactContent },
    { readFileSyncFn },
  );
  if (!content.ok) {
    return {
      ok: false,
      artifact_url: "",
      demo_artifact_url: "",
      demo_publish_status: "failed",
      demo_publish_error: content.error || "missing_demo_artifact_content",
    };
  }

  const summary = buildStablePublishSummary({
    milestoneTitle,
    readyIssueNumber,
    demoStrategy,
  });

  const evidence = buildStablePublishEvidence({
    milestoneTitle,
    readyIssueNumber,
    demoStrategy,
    demoContent: content.content,
    demoArtifactPath,
  });

  const artifact = emitSupervisorArtifactFn({
    repo: normalizedRepo,
    runId: trim(runId),
    pipeline: trim(pipeline) || "wave_execute",
    artifactType: "wave-demo-terminal",
    summary,
    evidence,
    goalIngest: true,
  });

  const issueUrl = trim(artifact?.issue_url || "");
  if (artifact?.ok && issueUrl.startsWith("http")) {
    return {
      ok: true,
      artifact_url: issueUrl,
      demo_artifact_url: issueUrl,
      demo_publish_status: "published",
      demo_publish_error: "",
    };
  }

  return {
    ok: false,
    artifact_url: "",
    demo_artifact_url: "",
    demo_publish_status: "failed",
    demo_publish_error: trim(artifact?.error || "demo_artifact_publish_failed"),
  };
}
