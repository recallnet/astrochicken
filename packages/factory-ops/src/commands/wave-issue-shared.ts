import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";

export function run(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd });
  return { code: p.status ?? 1, stdout: String(p.stdout || "").trim(), stderr: String(p.stderr || "").trim() };
}
export function sha256Hex(input = "") {
  return createHash("sha256").update(String(input)).digest("hex");
}
export function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return resolve(process.cwd(), raw);
}

export function persistReviewEvidence({ evidence, outPath } = {}) {
  const target = String(outPath || "").trim();
  if (!target) {
    return { review_evidence_path: "", review_evidence_sha256: "", review_evidence_valid: "false", review_evidence_error: "review_evidence_path_missing" };
  }
  mkdirSync(dirname(target), { recursive: true });
  const encoded = `${JSON.stringify(evidence ?? {}, null, 2)}\n`;
  writeFileSync(target, encoded, "utf8");
  return {
    review_evidence_path: target,
    review_evidence_sha256: sha256Hex(encoded),
    review_evidence_valid: "true",
    review_evidence_error: "",
  };
}
export function loadReviewEvidenceArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) return { ok: false, code: "review_evidence_path_missing", path: "", evidence: null };
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
    }
    return { ok: true, code: "ok", path: resolved, evidence: parsed };
  } catch (error) {
    if (String(error?.code || "") === "ENOENT") {
      return { ok: false, code: "review_evidence_not_found", path: resolved, evidence: null };
    }
    return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
  }
}
function normalizeReviewQaCommand(command = "", worktreeDir = "", repo = "") {
  let qaCmd = trim(command);
  if (!qaCmd) return "";
  if (qaCmd.startsWith("./node_modules/.bin/turbo")) {
    const localTurbo = join(worktreeDir, "node_modules", ".bin", "turbo");
    const fallbackTurbo = join(String(repo || "."), "node_modules", ".bin", "turbo");
    const exists = run(["bash", "-lc", `[ -x \"${localTurbo}\" ] && echo yes || echo no`]).stdout === "yes";
    if (!exists) qaCmd = qaCmd.replace("./node_modules/.bin/turbo", fallbackTurbo);
  }
  return qaCmd;
}
export function resolvePersistedQaCommands({ qaCommand = "", reviewQaCommand = "", integrationCommand = "", worktreeDir = "", repo = "" } = {}) {
  const normalizedQaCommand = normalizeReviewQaCommand(qaCommand, worktreeDir, repo);
  const normalizedIntegrationCommand = normalizeReviewQaCommand(integrationCommand, worktreeDir, repo);
  const normalizedReviewQaCommand = normalizeReviewQaCommand(
    reviewQaCommand || normalizedIntegrationCommand || normalizedQaCommand,
    worktreeDir,
    repo,
  );
  const persistedIntegrationCommand = normalizedIntegrationCommand || normalizedReviewQaCommand || normalizedQaCommand;
  const persistedReviewQaCommand = normalizedReviewQaCommand || persistedIntegrationCommand;
  const effectiveQaCommand = normalizedQaCommand || persistedReviewQaCommand || persistedIntegrationCommand;
  let qaCommandSource = "";
  if (normalizedQaCommand) qaCommandSource = "review_evidence.qa.command";
  else if (trim(reviewQaCommand)) qaCommandSource = "review_evidence.review_qa_command";
  else if (trim(integrationCommand)) qaCommandSource = "review_evidence.integration_command";
  return {
    review_qa_command: persistedReviewQaCommand,
    integration_command: persistedIntegrationCommand,
    qa_command: effectiveQaCommand,
    qa_command_source: qaCommandSource,
  };
}
export function runQaCommand({ command = "", worktreeDir = "" } = {}) {
  const qaCmd = trim(command);
  if (!qaCmd) {
    return {
      status: "fail",
      command: "",
      exit_code: 2,
      stdout: "",
      stderr: "QA command missing: provide review_qa_command or integration_command.",
    };
  }
  const p = spawnSync("sh", ["-c", qaCmd], { encoding: "utf8", cwd: worktreeDir });
  return {
    status: (p.status ?? 1) === 0 ? "pass" : "fail",
    command: qaCmd,
    exit_code: p.status ?? 1,
    stdout: String(p.stdout || "").slice(-4000),
    stderr: String(p.stderr || "").slice(-4000),
  };
}

// Shared multi-issue branches carry commits from sibling issues and must never
// be reset when the current issue's commits are not found.
// Recognised patterns:
//   wave/<milestone-title>  — non-numeric suffix (e.g. "wave/goal-333-wave-3")
//   goal/<issue-number>     — goal-scoped branch (e.g. "goal/2102")
// Per-issue branches are "wave/<issue-number>" (purely numeric after "wave/").
export function isSharedWaveBranch(branch = "") {
  const b = String(branch || "").trim();
  if (b.startsWith("goal/")) return true;
  if (!b.startsWith("wave/")) return false;
  const suffix = b.slice(5); // after "wave/"
  return suffix.length > 0 && !/^\d+$/.test(suffix);
}

export function commitSubjectMatchesIssue(issueNumber = "", subject = "") {
  const issue = String(issueNumber || "").trim();
  const line = String(subject || "");
  if (!issue || !line) return false;
  return line.includes(`#${issue}`) || line.includes(`(#${issue})`) || line.includes(`-${issue}:`);
}
function collectIssueScopedDeltaFromHistory({ worktreeDir = "", issueNumber = "" } = {}) {
  const wd = String(worktreeDir || ".").trim();
  const issue = String(issueNumber || "").trim();
  if (!wd || !issue) {
    return { issue_commits: "0", issue_changed_files: [] };
  }
  const log = run(["git", "-C", wd, "log", "main..HEAD", "--format=%H%x09%s"], wd);
  if (log.code !== 0) {
    return { issue_commits: "0", issue_changed_files: [] };
  }
  const commits = String(log.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subjectParts] = line.split("\t");
      return { sha: String(sha || "").trim(), subject: subjectParts.join("\t") };
    })
    .filter((entry) => entry.sha && commitSubjectMatchesIssue(issue, entry.subject));
  if (commits.length === 0) {
    return { issue_commits: "0", issue_changed_files: [] };
  }
  const files = new Set();
  for (const entry of commits) {
    const diff = run(["git", "-C", wd, "show", "--pretty=format:", "--name-only", entry.sha], wd);
    const changed = String(diff.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const file of changed) files.add(file);
  }
  return {
    issue_commits: String(commits.length),
    issue_changed_files: [...files].sort((a, b) => a.localeCompare(b)),
  };
}
export function resolveIssueScopedDelta({ worktreeDir = "", issueNumber = "", branch = "", snapshotSha = "", changedFiles = [], commitsAhead = "0", issueChangedFiles = [], issueCommits = "" } = {}) {
  const wd = trim(worktreeDir);
  const issue = trim(issueNumber);
  const branchName = trim(branch);
  const snap = trim(snapshotSha);
  const allChangedFiles = Array.isArray(changedFiles)
    ? [...new Set(changedFiles.map((file) => trim(file)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
  const providedIssueFiles = Array.isArray(issueChangedFiles)
    ? [...new Set(issueChangedFiles.map((file) => trim(file)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
  const branchCommitCount = Number.parseInt(trim(commitsAhead), 10) || 0;
  const providedIssueCommitCount = Number.parseInt(trim(issueCommits), 10);
  const sharedBranch = isSharedWaveBranch(branchName);
  let resolvedIssueFiles = [...providedIssueFiles];
  let resolvedIssueCommitCount = Number.isFinite(providedIssueCommitCount) ? providedIssueCommitCount : (snap ? 0 : branchCommitCount);
  let snapshotScopeStatus = snap ? "snapshot_scoped" : "snapshot_missing";
  if (snap && wd) {
    const issueFiles = run(["git", "-C", wd, "diff", "--name-only", `${snap}...HEAD`]).stdout;
    const countedCommits = run(["git", "-C", wd, "rev-list", "--count", `${snap}..HEAD`]).stdout || "0";
    const issueFilesList = String(issueFiles || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const issueCommitCount = Number.parseInt(String(countedCommits || "0"), 10) || 0;
    resolvedIssueFiles = issueFilesList;
    resolvedIssueCommitCount = issueCommitCount;
    if (sharedBranch && issueFilesList.length === 0) {
      const fromHistory = collectIssueScopedDeltaFromHistory({ worktreeDir: wd, issueNumber: issue });
      const historyCommitCount = Number.parseInt(String(fromHistory.issue_commits || "0"), 10) || 0;
      const historyFiles = Array.isArray(fromHistory.issue_changed_files) ? fromHistory.issue_changed_files : [];
      if (historyCommitCount > 0) {
        resolvedIssueCommitCount = historyCommitCount;
        resolvedIssueFiles = [...new Set(historyFiles.map((file) => String(file || "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        if (resolvedIssueFiles.length > 0) {
          snapshotScopeStatus = "snapshot_history_fallback";
        }
      }
    }
    if (resolvedIssueFiles.length === 0 && resolvedIssueCommitCount > 0) {
      snapshotScopeStatus = "snapshot_empty_fallback";
    }
  }
  const scopedFiles = snap ? resolvedIssueFiles : allChangedFiles;
  const scopedCommits = snap ? resolvedIssueCommitCount : branchCommitCount;
  return {
    commits_ahead: String(branchCommitCount),
    changed_files: allChangedFiles,
    issue_commits: String(scopedCommits),
    issue_changed_files: scopedFiles,
    snapshot_scope_status: snapshotScopeStatus,
    scope_mode: snap ? "issue_scoped" : "branch_scoped",
  };
}
export const WAVE_ISSUE_EXECUTE_GRAPH_PATH = "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs";
export function buildReviewEvidenceDiagnostics({ issueNumber = "", branch = "", snapshotSha = "", delta = {} } = {}) {
  const snapshotScopeStatus = trim(delta?.snapshot_scope_status);
  if (snapshotScopeStatus !== "snapshot_empty_fallback") return [];
  const changedFiles = Array.isArray(delta?.changed_files) ? delta.changed_files : [];
  const issueChangedFiles = Array.isArray(delta?.issue_changed_files) ? delta.issue_changed_files : [];
  const commitsAhead = Number.parseInt(trim(delta?.commits_ahead), 10) || 0;
  const issueCommits = Number.parseInt(trim(delta?.issue_commits), 10) || 0;
  return [{
    code: "review_evidence_snapshot_empty_fallback",
    severity: "warning",
    action: "rerun_history_scan_before_stale_branch",
    issue_number: trim(issueNumber),
    branch: trim(branch),
    snapshot_sha: trim(snapshotSha),
    snapshot_scope_status: snapshotScopeStatus,
    commits_ahead: String(commitsAhead),
    issue_commits: String(issueCommits),
    changed_files_count: String(changedFiles.length),
    issue_changed_files_count: String(issueChangedFiles.length),
    message: "snapshot_scope_status=snapshot_empty_fallback; rerun history scanning before stale-branch classification.",
  }];
}
export function summaryIndicatesZeroDelta(summary = "") {
  const normalized = trim(summary).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("no commits ahead of main")
    || normalized.includes("no issue-scoped file delta")
    || normalized.includes("zero issue diff")
    || normalized.includes("zero-delta")
    || normalized.includes("no code changes");
}
function buildReviewEvidenceRerunCommand({ worktreeDir = "", repo = "", issueNumber = "", branch = "", snapshotSha = "" } = {}) {
  const worktree = trim(worktreeDir) || "<worktree-dir>";
  const repository = trim(repo) || "<repo>";
  const issue = trim(issueNumber) || "<issue-number>";
  const branchName = trim(branch) || "<branch>";
  const snapshot = trim(snapshotSha) || "<snapshot-sha>";
  return `node packages/factory-ops/src/cli.ts wave-issue write-review-evidence --worktree-dir ${worktree} --repo ${repository} --issue ${issue} --branch ${branchName} --snapshot-sha ${snapshot}`;
}
export function buildReviewEvidenceScopeDiagnostics({
  snapshotScopeStatus = "",
  commitsAhead = "0",
  issueCommits = "0",
  issueChangedFilesCount = "0",
  worktreeDir = "",
  repo = "",
  issueNumber = "",
  branch = "",
  snapshotSha = "",
} = {}) {
  if (trim(snapshotScopeStatus) !== "snapshot_empty_fallback") return [];
  const diagnostic = {
    code: "STALE_BRANCH_MISSING_COMMIT",
    commits_ahead: String(Number.parseInt(trim(commitsAhead), 10) || 0),
    issue_commits: String(Number.parseInt(trim(issueCommits), 10) || 0),
    issue_changed_files_count: String(Number.parseInt(trim(issueChangedFilesCount), 10) || 0),
    graph_path: WAVE_ISSUE_EXECUTE_GRAPH_PATH,
    message: `STALE_BRANCH_MISSING_COMMIT: snapshot-scoped issue delta is empty or mismatched; review evidence fell back to branch-scoped files. See ${WAVE_ISSUE_EXECUTE_GRAPH_PATH}.`,
    rerun_command: buildReviewEvidenceRerunCommand({ worktreeDir, repo, issueNumber, branch, snapshotSha }),
  };
  return [diagnostic];
}
export function buildReviewEvidenceNote(scopeDiagnostics = []) {
  if (!Array.isArray(scopeDiagnostics) || scopeDiagnostics.length === 0) return "";
  const primary = scopeDiagnostics[0] || {};
  return `${trim(primary.message)} commits_ahead=${trim(primary.commits_ahead)} issue_commits=${trim(primary.issue_commits)} issue_changed_files_count=${trim(primary.issue_changed_files_count)}. Rerun: ${trim(primary.rerun_command)}`.trim();
}
