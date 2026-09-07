import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { buildIncidentPacket, persistIncidentPacket } from "../lib/incident-packet.ts";

const SCOPE_MISMATCH_PATTERNS = [
  /scope mismatch/i,
  /wrong issue/i,
  /unrelated changes/i,
  /branch changes are focused on/i,
  /not related to.*#\d+/i,
];

const QA_INFRA_PATTERNS = [
  /QA_EVIDENCE_REQUIRED/i,
  /EVIDENCE_MISSING/i,
  /qa\.status.*fail/i,
  /qa\.command.*missing/i,
];

const STALE_BRANCH_PATTERNS = [
  /no commits ahead/i,
  /no code changes/i,
  /stale branch/i,
];


function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function loadReviewEvidence({ worktreeDir = "", issueNumber = "", reviewEvidencePath = "" } = {}) {
  const explicit = resolvePath(reviewEvidencePath);
  const issue = trim(issueNumber);
  const worktree = resolvePath(worktreeDir);
  const candidate = explicit || (issue && worktree ? join(worktree, ".hatch", "review", `${issue}.json`) : "");
  const resolvedCandidate = candidate ? resolve(candidate) : "";

  if (!candidate) {
    return {
      ok: false,
      code: "review_evidence_path_missing",
      path: "",
      data: null,
    };
  }

  if (!existsSync(candidate)) {
    return {
      ok: false,
      code: "review_evidence_not_found",
      path: resolvedCandidate || candidate,
      data: null,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(candidate, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        code: "review_evidence_invalid_json",
        path: resolvedCandidate || candidate,
        data: null,
      };
    }
    return {
      ok: true,
      code: "ok",
      path: resolvedCandidate || candidate,
      data: parsed,
    };
  } catch {
    return {
      ok: false,
      code: "review_evidence_invalid_json",
      path: resolvedCandidate || candidate,
      data: null,
    };
  }
}

function extractQaEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object") {
    return {
      qa_status: "",
      qa_command: "",
      qa_exit_code: "",
    };
  }
  const qa = evidence.qa && typeof evidence.qa === "object" ? evidence.qa : {};
  const command = trim(qa.command) || trim(evidence.review_qa_command) || trim(evidence.integration_command);
  if (!command) {
    return {
      qa_status: "",
      qa_command: "",
      qa_exit_code: "",
    };
  }
  const exitCode = qa.exit_code;
  const normalizedExit = Number.isFinite(Number(exitCode)) ? String(exitCode) : "";

  return {
    qa_status: trim(qa.status).toLowerCase(),
    qa_command: command,
    qa_exit_code: normalizedExit,
  };
}

function extractDiffEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object") {
    return {
      issue_commits: "",
      issue_changed_files_count: "",
      issue_changed_files: [],
    };
  }

  const issueCommits = Number.parseInt(trim(evidence.issue_commits), 10);
  const commits = Number.isFinite(issueCommits)
    ? String(issueCommits)
    : trim(evidence.commits_ahead) || "";
  const issueFiles = Array.isArray(evidence.issue_changed_files) ? evidence.issue_changed_files : [];
  const changedFiles = Array.isArray(evidence.changed_files) ? evidence.changed_files : [];
  const scopedFiles = issueFiles.length > 0 || Object.prototype.hasOwnProperty.call(evidence, "issue_changed_files")
    ? issueFiles
    : changedFiles;

  return {
    issue_commits: commits,
    issue_changed_files_count: String(scopedFiles.length),
    issue_changed_files: scopedFiles,
  };
}

function buildQaInfrastructureEvidence({ worktreeDir = "", issueNumber = "", reviewEvidencePath = "" } = {}) {
  const loaded = loadReviewEvidence({ worktreeDir, issueNumber, reviewEvidencePath });
  if (!loaded.ok || !loaded.data) {
    return {
      review_evidence_loaded: "false",
      review_evidence_error: loaded.code,
      review_evidence_path: loaded.path,
    };
  }

  const qa = extractQaEvidence(loaded.data);
  const diff = extractDiffEvidence(loaded.data);

  return {
    review_evidence_loaded: "true",
    review_evidence_error: "",
    review_evidence_path: loaded.path,
    review_evidence_snapshot_sha: trim(loaded.data?.snapshot_sha),
    ...qa,
    ...diff,
  };
}

export function classifyGiveUp({ reviewNotes = "" } = {}) {
  const notes = String(reviewNotes || "").trim();
  if (!notes) return "unknown";

  for (const p of SCOPE_MISMATCH_PATTERNS) {
    if (p.test(notes)) return "scope_mismatch";
  }
  for (const p of STALE_BRANCH_PATTERNS) {
    if (p.test(notes)) return "stale_branch";
  }
  for (const p of QA_INFRA_PATTERNS) {
    if (p.test(notes)) return "qa_infrastructure";
  }
  return "legitimate_revise";
}

export function analyzeGiveUp({ repo, issueNumber, branch, reviewNotes, worktreeDir = "", reviewEvidencePath = "" } = {}) {
  // Classify the give-up reason for diagnostics/telemetry only.
  // Bug auto-filing is disabled: review failures are expected and must not
  // create recursive bug→decompose→build→fail→bug loops. The issue stays
  // open for retry in the next wave.
  const classification = classifyGiveUp({ reviewNotes });
  const qaEvidence = buildQaInfrastructureEvidence({ worktreeDir, issueNumber, reviewEvidencePath });

  const normalizedIssueNumber = Number.parseInt(String(issueNumber || "").trim(), 10);
  const normalizedRunId = Number.isFinite(normalizedIssueNumber) && normalizedIssueNumber > 0
    ? `wave_postmortem_issue_${normalizedIssueNumber}`
    : "wave_postmortem_issue_unknown";
  const reviewNotesText = trim(reviewNotes);
  const signatureHash = `sha256:${createHash("sha256")
    .update(JSON.stringify({
      issue_number: trim(issueNumber),
      branch: trim(branch),
      classification,
      review_notes_excerpt: reviewNotesText.slice(0, 500),
    }))
    .digest("hex")}`;

  const incidentPacket = buildIncidentPacket({
    factory_id: "mothership",
    source_repo: trim(repo),
    control_plane_repo: trim(repo),
    run_id: normalizedRunId,
    pipeline: "wave_execute",
    node: "postmortem",
    phase: "review_failure_giveup",
    instance_id: "mothership",
    kind_id: "mothership",
    host_id: "unknown_host",
    classification: "local",
    severity: "informational",
    crash_type: "unknown",
    affected_node: "postmortem",
    error_excerpt: reviewNotesText ? reviewNotesText.slice(0, 500) : "review_notes_missing",
    runtime_version: trim(qaEvidence?.review_evidence_snapshot_sha) || "unknown_runtime",
    kind_version: "unknown_kind_version",
    observed_behavior: `Issue #${trim(issueNumber) || "unknown"} exhausted review attempts with classification=${classification}.`,
    expected_behavior: "Wave postmortem should preserve durable incident context before continuing recovery/cleanup flow.",
    remediation_attempts: reviewNotesText ? reviewNotesText.slice(0, 1000) : "review_notes_missing",
    ownership_hint: "local_factory",
    next_step_hint: "Use this durable incident packet as the canonical postmortem handoff before any downstream cleanup/escalation.",
    signature_hash: signatureHash,
    evidence: {
      issue_number: trim(issueNumber),
      branch: trim(branch),
      classification,
      review_notes_excerpt: reviewNotesText.slice(0, 500),
      review_evidence: qaEvidence,
      packet_reason: "wave_postmortem_giveup",
    },
  });

  let packetPersisted = false;
  let packetPath = "";
  let packetPersistError = "";
  const persistenceRepo = trim(worktreeDir) || trim(repo);
  if (persistenceRepo && existsSync(resolve(persistenceRepo))) {
    try {
      const persisted = persistIncidentPacket({
        repo: resolve(persistenceRepo),
        packet: incidentPacket,
      });
      packetPersisted = true;
      packetPath = trim(persisted?.packet_path || "");
    } catch (error) {
      packetPersistError = String(error?.message || error || "incident_packet_persist_failed");
    }
  } else {
    packetPersistError = "incident_packet_persist_repo_unavailable";
  }

  return {
    classification,
    bug_filed: false,
    bug_url: "",
    incident_packet_id: trim(incidentPacket?.packet_id || ""),
    incident_packet_path: packetPath,
    incident_packet_persisted: packetPersisted,
    incident_packet_persist_error: packetPersistError,
  };
}
