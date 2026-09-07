import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command, Option } from "clipanion";

import { runAnalysisLens } from "./lens.ts";
import { parsePositiveNumber } from "../../../cli/helpers.ts";
import { postLensToSlack } from "../../../commands/analysis/post-lens-to-slack.ts";
import { DEFAULT_LEARNING_LOG_JSON_PATH } from "../../analysis/learning-log.ts";
import { publishLensCandidates } from "../../analysis/lens-candidates.ts";
import { buildLensSlackPayload } from "../../analysis/lens-slack-blocks.ts";
import { gh, ghJson, trim } from "../../cli-helpers.ts";
import { emitLensNarrativeDocument } from "../../narrative-document/emit-lens-document.ts";

const REQUIRED_ISSUE_LABELS = ["daily-lens"];
const GITHUB_BODY_MAX_CHARS = 65536;

let runtimeOverrides = {};

function asString(value) {
  return String(value ?? "").trim();
}

function parseIssueNumberFromUrl(url = "") {
  const match = asString(url).match(/\/(\d+)\/?$/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function resolveIssueLabels(issueLabels = []) {
  const normalizedInput = Array.isArray(issueLabels)
    ? issueLabels.map((label) => asString(label)).filter(Boolean)
    : [];
  return [...new Set([...REQUIRED_ISSUE_LABELS, ...normalizedInput])];
}

export function resolveFactoryConfigSlackWebhookUrl(factoryId = "") {
  const id = asString(factoryId);
  if (!id) return "";
  const configPath = join("factories", id, "factory.config.json");
  if (!existsSync(configPath)) return "";
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return asString(config?.slack_webhook_url || "");
  } catch {
    return "";
  }
}

function resolveRuntime() {
  return {
    runAnalysisLens: runtimeOverrides.runAnalysisLens || runAnalysisLens,
    ghFn: runtimeOverrides.ghFn || gh,
    ghJsonFn: runtimeOverrides.ghJsonFn || ghJson,
    postLensToSlack: runtimeOverrides.postLensToSlack || postLensToSlack,
    addSubIssueFn: runtimeOverrides.addSubIssueFn,
    publishLensCandidates: runtimeOverrides.publishLensCandidates || publishLensCandidates,
    emitLensNarrativeDocument: runtimeOverrides.emitLensNarrativeDocument || emitLensNarrativeDocument,
  };
}

export function setAnalysisPublishLensRuntimeForTest(overrides = {}) {
  runtimeOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
}

export function resetAnalysisPublishLensRuntimeForTest() {
  runtimeOverrides = {};
}

function readJsonFile(filePath = "") {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveIssueTitle({ reportDate = "" } = {}) {
  return `Daily Lens Report — ${reportDate}`;
}

function resolveIssueUrl({ repo = "", number = 0, url = "" } = {}) {
  const normalizedUrl = asString(url);
  if (normalizedUrl) return normalizedUrl;
  const normalizedRepo = asString(repo);
  const issueNumber = Number(number || 0);
  if (!normalizedRepo || !Number.isFinite(issueNumber) || issueNumber <= 0) return "";
  return `https://github.com/${normalizedRepo}/issues/${issueNumber}`;
}

export function ensureBodyFitsGitHubLimit(markdownPath = "", { repo = "" } = {}) {
  const body = readFileSync(markdownPath, "utf8");
  if (body.length <= GITHUB_BODY_MAX_CHARS) return markdownPath;

  const truncationNote = [
    "",
    "---",
    `> **Note:** This report was truncated to fit GitHub's ${GITHUB_BODY_MAX_CHARS}-character issue body limit.`,
    `> Full report is committed to the repository at \`${markdownPath.replace(/^.*\/reports\//, "reports/")}\`.`,
  ].join("\n");

  const budget = GITHUB_BODY_MAX_CHARS - truncationNote.length - 100;
  const lastNewline = body.lastIndexOf("\n", budget);
  const cutPoint = lastNewline > 0 ? lastNewline : budget;
  const truncatedBody = body.slice(0, cutPoint) + truncationNote;

  const truncatedPath = join(tmpdir(), `lens-issue-body-${process.pid}-${Date.now()}.md`);
  writeFileSync(truncatedPath, truncatedBody, "utf8");
  return truncatedPath;
}

function runGhCommandOrThrow({ ghFn = gh, args = [], errorCode = "gh_command_failed" } = {}) {
  const result = ghFn(args);
  if (!result?.ok) {
    throw new Error(`${errorCode}: ${trim(result?.stderr || result?.stdout || errorCode)}`);
  }
  return result;
}

function findExistingLensIssue({
  repo = "",
  title = "",
  ghJsonFn = ghJson,
} = {}) {
  const issues = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    title,
    "--json",
    "number,title,state,url,labels",
  ], []);

  const matches = (Array.isArray(issues) ? issues : []).filter((issue) => asString(issue?.title) === title);
  const sortByIssueNumberDesc = (a, b) => Number(b?.number || 0) - Number(a?.number || 0);

  const open = matches
    .filter((issue) => asString(issue?.state).toUpperCase() === "OPEN")
    .sort(sortByIssueNumberDesc)[0];
  if (open) return open;

  return matches
    .filter((issue) => asString(issue?.state).toUpperCase() === "CLOSED")
    .sort(sortByIssueNumberDesc)[0] || null;
}

function createLensIssue({
  repo = "",
  title = "",
  markdownPath = "",
  labels = [],
  ghFn = gh,
} = {}) {
  const safeMarkdownPath = ensureBodyFitsGitHubLimit(markdownPath, { repo });
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body-file",
    safeMarkdownPath,
  ];
  for (const label of labels) {
    args.push("--label", label);
  }
  const result = runGhCommandOrThrow({ ghFn, args, errorCode: "issue_create_failed" });
  const url = trim(result.stdout);
  const number = parseIssueNumberFromUrl(url);
  if (!url || number <= 0) {
    throw new Error("issue_create_failed: unable_to_resolve_issue_identity");
  }
  return { number, url };
}

function reopenLensIssue({ repo = "", issueNumber = 0, ghFn = gh } = {}) {
  const normalizedIssueNumber = Number(issueNumber || 0);
  if (!Number.isFinite(normalizedIssueNumber) || normalizedIssueNumber <= 0) {
    throw new Error("issue_reopen_failed: invalid_issue_number");
  }
  runGhCommandOrThrow({
    ghFn,
    args: ["issue", "reopen", String(normalizedIssueNumber), "--repo", repo],
    errorCode: "issue_reopen_failed",
  });
}

function updateLensIssue({
  repo = "",
  issueNumber = 0,
  title = "",
  markdownPath = "",
  labels = [],
  ghFn = gh,
} = {}) {
  const normalizedIssueNumber = Number(issueNumber || 0);
  if (!Number.isFinite(normalizedIssueNumber) || normalizedIssueNumber <= 0) {
    throw new Error("issue_update_failed: invalid_issue_number");
  }

  const safeMarkdownPath = ensureBodyFitsGitHubLimit(markdownPath, { repo });
  const args = [
    "issue",
    "edit",
    String(normalizedIssueNumber),
    "--repo",
    repo,
    "--title",
    title,
    "--body-file",
    safeMarkdownPath,
  ];
  for (const label of labels) {
    args.push("--add-label", label);
  }

  runGhCommandOrThrow({ ghFn, args, errorCode: "issue_update_failed" });
}

async function maybeCommitLensArtifacts({
  artifactPaths = [],
  reportDate = "",
} = {}) {
  const pathsToCommit = artifactPaths.filter((p) => p && existsSync(p));
  if (pathsToCommit.length === 0) return false;

  try {
    execFileSync("git", ["add", "--", ...pathsToCommit], { encoding: "utf8", stdio: "pipe" });
    let hasStagedChanges = false;
    try {
      execFileSync("git", ["diff", "--cached", "--quiet"], { stdio: "pipe" });
    } catch {
      hasStagedChanges = true;
    }
    if (!hasStagedChanges) return false;
    execFileSync("git", ["commit", "-m", `Update ${asString(reportDate) || new Date().toISOString().slice(0, 10)} Daily Lens artifacts`], { encoding: "utf8", stdio: "pipe" });
    execFileSync("git", ["push"], { encoding: "utf8", stdio: "pipe", timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

export async function publishLensArtifacts({
  date = "",
  repo = "",
  factoryId = "mothership",
  lensJson = {},
  artifacts = {},
  notifySlack = false,
  issueLabels = ["daily-lens"],
  slackWebhookUrl = "",
  factoryConfigWebhookUrl = "",
} = {}) {
  const normalizedDate = asString(date);
  const normalizedRepo = asString(repo);
  if (!normalizedDate) throw new Error("missing_date: --date is required");
  if (!normalizedRepo) throw new Error("missing_repo: --repo is required");

  const runtime = resolveRuntime();
  const title = resolveIssueTitle({ reportDate: normalizedDate });
  const normalizedLabels = resolveIssueLabels(issueLabels);
  const existing = findExistingLensIssue({
    repo: normalizedRepo,
    title,
    ghJsonFn: runtime.ghJsonFn,
  });

  const markdownPath = artifacts?.markdown_path;
  const jsonPath = artifacts?.json_path;
  const lensJsonPayload = lensJson && typeof lensJson === "object" && !Array.isArray(lensJson)
    ? lensJson
    : readJsonFile(jsonPath);

  let issueAction = "created";
  let issueNumber = Number(existing?.number || 0);
  let issueUrl = asString(existing?.url);

  if (existing) {
    const wasClosed = asString(existing?.state).toUpperCase() === "CLOSED";
    if (wasClosed) {
      reopenLensIssue({ repo: normalizedRepo, issueNumber, ghFn: runtime.ghFn });
      issueAction = "reopened";
    } else {
      issueAction = "updated";
    }
    updateLensIssue({
      repo: normalizedRepo,
      issueNumber,
      title,
      markdownPath,
      labels: normalizedLabels,
      ghFn: runtime.ghFn,
    });
  } else {
    const created = createLensIssue({
      repo: normalizedRepo,
      title,
      markdownPath,
      labels: normalizedLabels,
      ghFn: runtime.ghFn,
    });
    issueNumber = created.number;
    issueUrl = created.url;
  }

  issueUrl = resolveIssueUrl({ repo: normalizedRepo, number: issueNumber, url: issueUrl });
  if (issueNumber <= 0 || !issueUrl) {
    throw new Error("issue_publish_failed: unable_to_resolve_issue_identity");
  }

  let slack = { ok: true, delivered: false, status: "not_requested" };
  if (notifySlack) {
    const payload = buildLensSlackPayload({
      reportDate: normalizedDate,
      repo: normalizedRepo,
      issueUrl,
      findings: lensJsonPayload?.findings,
      metaReflection: lensJsonPayload?.meta_reflection,
    });
    slack = await runtime.postLensToSlack({
      payload,
      webhookUrl: slackWebhookUrl,
      factoryConfigWebhookUrl,
    });
  }

  const narrativeDocument = await runtime.emitLensNarrativeDocument({
    reportDate: normalizedDate,
    issueUrl,
    lensJson: lensJsonPayload,
    repo: normalizedRepo,
    factoryId,
    outputDir: artifacts?.output_dir,
    artifacts,
  });

  const committed = await maybeCommitLensArtifacts({
    artifactPaths: [
      artifacts?.json_path,
      artifacts?.markdown_path,
      artifacts?.insights_latest_path,
      narrativeDocument?.json_path,
      narrativeDocument?.markdown_path,
      DEFAULT_LEARNING_LOG_JSON_PATH,
    ],
    reportDate: normalizedDate,
  });

  return {
    issue: {
      action: issueAction,
      created: issueAction === "created",
      title,
      number: issueNumber,
      url: issueUrl,
    },
    narrative_document: narrativeDocument,
    slack,
    committed,
    lens_json: lensJsonPayload,
    factory_id: factoryId,
  };
}

export async function runAnalysisPublishLens({
  date = "",
  repo = "",
  factoryId = "mothership",
  outputDir = "reports/lens",
  runsDir = ".hatch/runs",
  repoPath = ".",
  windowStart = "",
  windowEnd = "",
  notifySlack = false,
  issueLabels = ["daily-lens"],
  slackWebhookUrl = "",
  langfuseRetries = 2,
  model = "claude-sonnet-4-6",
  logLevel = "info",
  factoryConfigWebhookUrl = "",
} = {}) {
  const normalizedDate = asString(date);
  const normalizedRepo = asString(repo);
  if (!normalizedDate) throw new Error("missing_date: --date is required");
  if (!normalizedRepo) throw new Error("missing_repo: --repo is required");
  if (!asString(windowStart) || !asString(windowEnd)) {
    throw new Error("missing_window: --window-start and --window-end are required");
  }

  const runtime = resolveRuntime();
  const lensResult = await runtime.runAnalysisLens({
    date: normalizedDate,
    repo: normalizedRepo,
    factoryId,
    outputDir,
    runsDir,
    repoPath,
    windowStart,
    windowEnd,
    model,
    logLevel,
    langfuseRetries,
  });

  const jsonPath = lensResult?.artifacts?.json_path;
  const lensJson = readJsonFile(jsonPath);
  const publication = await publishLensArtifacts({
    date: normalizedDate,
    repo: normalizedRepo,
    factoryId,
    lensJson,
    artifacts: lensResult.artifacts,
    notifySlack,
    issueLabels,
    slackWebhookUrl,
    factoryConfigWebhookUrl,
  });

  const candidates = runtime.publishLensCandidates({
    repo: normalizedRepo,
    reportIssueNumber: publication.issue.number,
    reportDate: normalizedDate,
    lensJson,
    ghFn: runtime.ghFn,
    ghJsonFn: runtime.ghJsonFn,
    ...(typeof runtime.addSubIssueFn === "function" ? { addSubIssueFn: runtime.addSubIssueFn } : {}),
  });

  return {
    ok: true,
    date: normalizedDate,
    repo: normalizedRepo,
    factory_id: factoryId,
    window: { start: windowStart, end: windowEnd },
    artifacts: {
      ...lensResult.artifacts,
      narrative_json_path: publication?.narrative_document?.json_path || "",
      narrative_markdown_path: publication?.narrative_document?.markdown_path || "",
    },
    issue: publication.issue,
    narrative_document: publication.narrative_document,
    candidates,
    slack: publication.slack,
    committed: publication.committed,
  };
}

export class AnalysisPublishLensCommand extends Command {
  static paths = [["analysis", "publish-lens"]];

  date = Option.String("--date", "");
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  outputDir = Option.String("--output-dir", "reports/lens");
  windowStart = Option.String("--window-start", "");
  windowEnd = Option.String("--window-end", "");
  notifySlack = Option.Boolean("--notify-slack", false);
  slackWebhookUrl = Option.String("--slack-webhook-url", "");
  langfuseRetries = Option.String("--langfuse-retries", "2");
  model = Option.String("--model", "claude-sonnet-4-6");
  logLevel = Option.String("--log-level", "info");

  async execute() {
    try {
      const out = await runAnalysisPublishLens({
        date: this.date,
        repo: this.repo,
        factoryId: this.factoryId,
        outputDir: this.outputDir,
        windowStart: this.windowStart,
        windowEnd: this.windowEnd,
        notifySlack: this.notifySlack,
        slackWebhookUrl: this.slackWebhookUrl,
        factoryConfigWebhookUrl: resolveFactoryConfigSlackWebhookUrl(this.factoryId),
        langfuseRetries: parsePositiveNumber(this.langfuseRetries, 2),
        model: this.model,
        logLevel: this.logLevel,
      });
      this.context.stdout.write(JSON.stringify(out, null, 2));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      if (String(error?.message || "").startsWith("missing_")) return 2;
      return 1;
    }
  }
}
