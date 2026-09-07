import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { analyzeGiveUp } from "./milestone-postmortem.ts";
import { buildIssueExecutionStyleComment } from "./wave-handle-review-failures.ts";
import { resolveDisposableWorktreeRoot } from "../lib/canonical-worktree.ts";
import { trim, parseJson, gh } from "../lib/cli-helpers.ts";


function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}



function run(args, cwd = process.cwd()) {
  const p = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd });
  return {
    ok: p.status === 0,
    code: p.status ?? 1,
    stdout: String(p.stdout || "").trim(),
    stderr: String(p.stderr || "").trim(),
  };
}

function runNode(args, cwd = process.cwd()) {
  return run(["node", ...args], cwd);
}

function loadEvidence(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) return { ok: false, code: "review_evidence_path_missing", path: "", evidence: null };
  if (!existsSync(resolved)) return { ok: false, code: "review_evidence_not_found", path: resolved, evidence: null };
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
    }
    return { ok: true, code: "ok", path: resolved, evidence: parsed };
  } catch {
    return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
  }
}

function isOwnerRepoSlug(value = "") {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || "").trim());
}

function parseGitHubRepoFromRemoteUrl(remoteUrl = "") {
  const raw = trim(remoteUrl);
  if (!raw) return "";
  const patterns = [
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return trim(match[1]);
  }
  return "";
}

function resolveGitHubRepoSlug({ repo = "", worktreeDir = "", cwd = process.cwd(), runFn = run } = {}) {
  const explicit = trim(repo);
  if (isOwnerRepoSlug(explicit) && !explicit.startsWith("/") && !explicit.startsWith(".")) return explicit;

  const candidates = [explicit, trim(worktreeDir), trim(cwd)].filter(Boolean);
  for (const candidate of candidates) {
    const remote = runFn(["git", "-C", candidate, "remote", "get-url", "origin"], candidate);
    if (remote.code !== 0) continue;
    const parsed = parseGitHubRepoFromRemoteUrl(remote.stdout);
    if (parsed) return parsed;
  }

  return "";
}

function defaultEvidencePathForIssue({ worktreeDir = "", issueNumber = "" } = {}) {
  const wd = trim(worktreeDir);
  const issue = trim(issueNumber);
  if (!wd || !issue) return "";
  return join(wd, ".hatch", "review", `${issue}.json`);
}

function buildEvidenceCandidatePaths({ issueNumber = "", branch = "", repo = "", cwd = process.cwd() } = {}) {
  const issue = trim(issueNumber);
  const branchName = trim(branch);
  const repoValue = trim(repo);
  if (!issue) return [];

  const candidates = [
    defaultEvidencePathForIssue({ worktreeDir: cwd, issueNumber: issue }),
  ];

  if (repoValue && isAbsolute(repoValue)) {
    candidates.push(defaultEvidencePathForIssue({ worktreeDir: repoValue, issueNumber: issue }));
    if (branchName) {
      candidates.push(join(dirname(repoValue), ".hatch-worktrees", branchName, ".hatch", "review", `${issue}.json`));
    }
  }

  if (branchName) {
    candidates.push(resolve(cwd, "..", ".hatch-worktrees", branchName, ".hatch", "review", `${issue}.json`));
  }

  return [...new Set(candidates.map((entry) => trim(entry)).filter(Boolean))];
}

function loadDiscoveredEvidence({ reviewEvidencePath = "", issueNumber = "", branch = "", repo = "", cwd = process.cwd() } = {}) {
  const explicit = resolvePath(reviewEvidencePath);
  if (explicit) return loadEvidence(explicit);

  const candidates = buildEvidenceCandidatePaths({ issueNumber, branch, repo, cwd });
  for (const candidate of candidates) {
    const loaded = loadEvidence(candidate);
    if (loaded.ok) return loaded;
  }

  return {
    ok: false,
    code: candidates.length > 0 ? "review_evidence_not_found" : "review_evidence_path_missing",
    path: candidates[0] || "",
    evidence: null,
  };
}

function resolveWorktreeDir({ branch = "", issueNumber = "", reviewEvidence = {}, repo = "", cwd = process.cwd() } = {}) {
  const fromEvidence = trim(reviewEvidence?.worktree_dir);
  if (fromEvidence) return fromEvidence;

  const issue = trim(issueNumber);
  const repoValue = trim(repo);
  const cwdEvidence = defaultEvidencePathForIssue({ worktreeDir: cwd, issueNumber: issue });
  if (cwdEvidence && existsSync(cwdEvidence)) return cwd;

  if (repoValue && isAbsolute(repoValue)) {
    const repoEvidence = defaultEvidencePathForIssue({ worktreeDir: repoValue, issueNumber: issue });
    if (repoEvidence && existsSync(repoEvidence)) return repoValue;
  }

  const branchName = trim(branch) || (issue ? `wave/${issue}` : "");
  if (!branchName) return "";
  if (repoValue && isAbsolute(repoValue)) {
    const root = resolveDisposableWorktreeRoot({ repoPath: repoValue, kind: "wave" })
      || join(dirname(repoValue), ".hatch-worktrees", "wave");
    return join(root, branchName);
  }
  return resolve(cwd, "..", ".hatch-worktrees", "wave", branchName);
}

function readJudgeScenario(reviewEvidence = {}) {
  const jc = reviewEvidence?.judge_context;
  if (jc && typeof jc === "object") {
    const direct = trim(jc.scenario);
    if (direct) return direct;
    const selector = trim(jc.scenario_selector);
    if (selector) return selector;
    const basis = jc.scenario_basis && typeof jc.scenario_basis === "object" ? jc.scenario_basis : {};
    const ids = Array.isArray(basis.scenario_ids) ? basis.scenario_ids.map((entry) => trim(entry)).filter(Boolean) : [];
    if (ids.length > 0) return ids.join(", ");
    const selected = Array.isArray(basis.selected_scenarios) ? basis.selected_scenarios : [];
    const selectedIds = selected.map((entry) => trim(entry?.scenario_id)).filter(Boolean);
    if (selectedIds.length > 0) return selectedIds.join(", ");
  }
  return "";
}

function resolveQaCommandFromEvidence(reviewEvidence = {}, rerunPayload = {}) {
  const payloadQaCommand = trim(rerunPayload?.qa_command);
  if (payloadQaCommand) return payloadQaCommand;

  const qa = reviewEvidence?.qa && typeof reviewEvidence.qa === "object" ? reviewEvidence.qa : {};
  const directQaCommand = trim(qa.command);
  if (directQaCommand) return directQaCommand;

  const persistedReviewQaCommand = trim(reviewEvidence?.review_qa_command);
  if (persistedReviewQaCommand) return persistedReviewQaCommand;

  return trim(reviewEvidence?.integration_command);
}

function resolveQaCommandSource(reviewEvidence = {}, rerunPayload = {}) {
  const payloadQaCommandSource = trim(rerunPayload?.qa_command_source);
  if (payloadQaCommandSource) return payloadQaCommandSource;

  const qa = reviewEvidence?.qa && typeof reviewEvidence.qa === "object" ? reviewEvidence.qa : {};
  if (trim(qa.command)) return "review_evidence.qa.command";
  if (trim(reviewEvidence?.review_qa_command)) return "review_evidence.review_qa_command";
  if (trim(reviewEvidence?.integration_command)) return "review_evidence.integration_command";
  return "";
}

function isFallbackRerun(reviewEvidence = {}) {
  const qa = reviewEvidence?.qa && typeof reviewEvidence.qa === "object" ? reviewEvidence.qa : {};
  return trim(qa.command) === "";
}

function excerpt(value = "", limit = 500) {
  const text = trim(value);
  if (!text) return "(empty)";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function quoteBlock(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildQaCommandCommentLines({ reviewEvidence = {}, qaCommand = "", qaCommandSource = "" } = {}) {
  if (isFallbackRerun(reviewEvidence)) {
    return [
      `- Missing qa.command triggered persisted fallback rerun before resolving triage.`,
      `- Fallback command: \`${trim(qaCommand) || "(missing)"}\``,
      `- Fallback source: \`${trim(qaCommandSource) || "(missing)"}\``,
    ];
  }

  return [
    `- QA command: \`${trim(qaCommand) || "(missing)"}\``,
    `- QA command source: \`${trim(qaCommandSource) || "(missing)"}\``,
  ];
}

function buildSuccessComment({
  attemptCount = "",
  scenario = "",
  qaCommand = "",
  qaCommandSource = "",
  rerunStdout = "",
  rerunStderr = "",
  reviewEvidence = {},
  reviewEvidencePath = "",
} = {}) {
  const lines = [
    `QA infrastructure rerun cleared on attempt ${trim(attemptCount) || "1"}.`,
    "",
    `- Scenario: ${trim(scenario) || "(missing judge_context.scenario)"}`,
    `- Review evidence: ${trim(reviewEvidencePath) || "(unknown)"}`,
    ...buildQaCommandCommentLines({ reviewEvidence, qaCommand, qaCommandSource }),
    "",
    "Stdout excerpt:",
    quoteBlock(excerpt(rerunStdout, 700)),
    "",
    "Stderr excerpt:",
    quoteBlock(excerpt(rerunStderr, 700)),
  ];
  return buildIssueExecutionStyleComment("QA infrastructure block cleared:", lines.join("\n"));
}

function buildFailureComment({
  attemptCount = "",
  scenario = "",
  rerunCommand = "",
  qaCommand = "",
  qaCommandSource = "",
  qaExitCode = "",
  rerunStdout = "",
  rerunStderr = "",
  bugUrl = "",
  reviewEvidence = {},
  reviewEvidencePath = "",
} = {}) {
  const lines = [
    `QA infrastructure rerun is still failing after attempt ${trim(attemptCount) || "1"}.`,
    "",
    `- Scenario: ${trim(scenario) || "(missing judge_context.scenario)"}`,
    `- Review evidence: ${trim(reviewEvidencePath) || "(unknown)"}`,
    `- Rerun command: \`${trim(rerunCommand) || "(missing)"}\``,
    ...buildQaCommandCommentLines({ reviewEvidence, qaCommand, qaCommandSource }),
    `- Exit code: ${trim(qaExitCode) || "(missing)"}`,
  ];
  if (trim(bugUrl)) lines.push(`- Fast-tracked bug: ${trim(bugUrl)}`);
  lines.push("", "Stdout excerpt:", quoteBlock(excerpt(rerunStdout, 700)), "", "Stderr excerpt:", quoteBlock(excerpt(rerunStderr, 700)));
  return buildIssueExecutionStyleComment("QA infrastructure rerun still blocked:", lines.join("\n"));
}

function postIssueComment({ repo = "", issueNumber = "", body = "" } = {}) {
  if (!trim(repo) || !trim(issueNumber) || !trim(body)) {
    return { ok: false, code: 1, stdout: "", stderr: "missing_comment_fields" };
  }
  const out = gh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
  return {
    ok: out.ok,
    code: out.ok ? 0 : 1,
    stdout: String(out.stdout || "").trim(),
    stderr: String(out.stderr || "").trim(),
  };
}

export function triageQaInfrastructure({ repo = "", issueNumber = "", branch = "", reviewEvidencePath = "" } = {}, deps = {}) {
  const cwd = typeof deps.cwd === "string" && trim(deps.cwd) ? trim(deps.cwd) : process.cwd();
  const runner = typeof deps.run === "function" ? deps.run : run;
  const requestedIssue = trim(issueNumber);
  const requestedBranch = trim(branch);

  const nodeRun = typeof deps.runNode === "function"
    ? deps.runNode
    : (args, runCwd) => runNode(args, runCwd);
  const issueComment = typeof deps.issueComment === "function"
    ? deps.issueComment
    : ({ repo: issueRepo, issueNumber: targetIssue, body }) => postIssueComment({ repo: issueRepo, issueNumber: targetIssue, body });
  const analyzeGiveUpFn = typeof deps.analyzeGiveUp === "function" ? deps.analyzeGiveUp : analyzeGiveUp;

  let loaded = loadDiscoveredEvidence({ reviewEvidencePath, issueNumber: requestedIssue, branch: requestedBranch, repo, cwd });
  const evidence = loaded.ok && loaded.evidence ? loaded.evidence : {};
  const effectiveIssue = requestedIssue || trim(evidence?.issue_number);
  const effectiveBranch = requestedBranch || trim(evidence?.branch);
  if ((!loaded.ok || !loaded.evidence) && !trim(reviewEvidencePath) && (effectiveIssue || effectiveBranch)) {
    loaded = loadDiscoveredEvidence({ reviewEvidencePath, issueNumber: effectiveIssue, branch: effectiveBranch, repo, cwd });
  }

  const resolvedEvidencePath = loaded.path || resolvePath(reviewEvidencePath);
  const currentEvidence = loaded.ok && loaded.evidence ? loaded.evidence : {};
  const scenario = readJudgeScenario(currentEvidence);
  const worktreeDir = resolveWorktreeDir({ branch: effectiveBranch, issueNumber: effectiveIssue, reviewEvidence: currentEvidence, repo, cwd });
  const githubRepo = resolveGitHubRepoSlug({ repo, worktreeDir, cwd, runFn: runner })
    || (isOwnerRepoSlug(trim(repo)) ? trim(repo) : "")
    || process.env.FACTORY_REPO
    || process.env.GH_REPO
    || "recallnet/astrochicken";

  if (!loaded.ok || !loaded.evidence) {
    return {
      ok: false,
      exit_code: 2,
      issue_number: effectiveIssue,
      branch: effectiveBranch,
      repo: githubRepo,
      review_evidence_path: resolvedEvidencePath,
      review_evidence_error: loaded.code || "review_evidence_load_failed",
      judge_context_scenario: scenario,
      comment_posted: false,
      comment_post_error: "review_evidence_load_failed",
      qa_rerun_command: "",
      qa_rerun_exit_code: "",
      qa_rerun_count: "0",
    };
  }

  const cliArgs = [
    "packages/factory-ops/src/cli.ts",
    "wave-issue",
    "rerun-review-qa",
    "--review-evidence-path",
    resolvedEvidencePath,
  ];
  if (worktreeDir) cliArgs.push("--worktree-dir", worktreeDir);
  if (githubRepo) cliArgs.push("--repo", githubRepo);

  const rerun = nodeRun(cliArgs, cwd);
  const rerunPayload = parseJson(rerun.stdout || "{}", {});
  const attemptCount = trim(rerunPayload.qa_rerun_count);
  const rerunOk = trim(rerunPayload.qa_rerun_ok) === "true" && rerun.code === 0;
  const rerunCommand = `node ${cliArgs.join(" ")}`;
  const rerunStdout = trim(rerunPayload.qa_stdout_excerpt) || rerun.stdout;
  const rerunStderr = trim(rerunPayload.qa_stderr_excerpt) || rerun.stderr;
  const effectiveQaCommand = resolveQaCommandFromEvidence(currentEvidence, rerunPayload);
  const effectiveQaCommandSource = resolveQaCommandSource(currentEvidence, rerunPayload);

  const commentBody = rerunOk
    ? buildSuccessComment({
        attemptCount,
        scenario,
        qaCommand: effectiveQaCommand,
        qaCommandSource: effectiveQaCommandSource,
        rerunStdout,
        rerunStderr,
        reviewEvidence: currentEvidence,
        reviewEvidencePath: rerunPayload.review_evidence_path || resolvedEvidencePath,
      })
    : (() => {
        const bug = analyzeGiveUpFn({
          repo: githubRepo,
          issueNumber: effectiveIssue,
          branch: effectiveBranch,
          reviewNotes: `QA_EVIDENCE_REQUIRED: qa.status=${trim(rerunPayload.qa_status) || "fail"}`,
          worktreeDir,
          reviewEvidencePath: rerunPayload.review_evidence_path || resolvedEvidencePath,
        });
        return {
          body: buildFailureComment({
            attemptCount,
            scenario,
            rerunCommand,
            qaCommand: effectiveQaCommand,
            qaCommandSource: effectiveQaCommandSource,
            qaExitCode: rerunPayload.qa_exit_code || String(rerun.code),
            rerunStdout,
            rerunStderr,
            bugUrl: bug?.bug_url || "",
            reviewEvidence: currentEvidence,
            reviewEvidencePath: rerunPayload.review_evidence_path || resolvedEvidencePath,
          }),
          bug,
        };
      })();

  const issueCommentBody = typeof commentBody === "string" ? commentBody : commentBody.body;
  const failureBug = typeof commentBody === "string" ? { bug_url: "", bug_filed: false } : (commentBody.bug || { bug_url: "", bug_filed: false });
  const commentResult = issueComment({
    repo: githubRepo,
    issueNumber: effectiveIssue,
    body: issueCommentBody,
  });

  return {
    ok: rerunOk,
    exit_code: rerunOk ? 0 : 2,
    issue_number: effectiveIssue,
    branch: effectiveBranch,
    repo: githubRepo,
    review_evidence_path: rerunPayload.review_evidence_path || resolvedEvidencePath,
    review_evidence_error: trim(rerunPayload.review_evidence_error),
    judge_context_scenario: scenario,
    qa_rerun_command: rerunCommand,
    qa_command: effectiveQaCommand,
    qa_command_source: effectiveQaCommandSource,
    qa_rerun_ok: trim(rerunPayload.qa_rerun_ok),
    qa_rerun_exit_code: rerunPayload.qa_exit_code || String(rerun.code),
    qa_rerun_count: attemptCount || "0",
    qa_status: trim(rerunPayload.qa_status),
    comment_posted: Boolean(commentResult?.ok),
    comment_post_error: commentResult?.ok ? "" : trim(commentResult?.stderr || commentResult?.stdout || "issue_comment_failed"),
    bug_url: rerunOk ? "" : trim(failureBug?.bug_url),
    bug_filed: rerunOk ? false : Boolean(failureBug?.bug_filed),
    rerun_stdout_excerpt: excerpt(rerunStdout, 700),
    rerun_stderr_excerpt: excerpt(rerunStderr, 700),
  };
}
