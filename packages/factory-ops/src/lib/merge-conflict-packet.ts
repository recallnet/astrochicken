import { trim } from "./cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  makePacketId,
  persistNamedPacket,
  validatePacketTakeoverContract,
  validateNamedPacketBase,
} from "./packet-core.ts";

export const MERGE_CONFLICT_PACKET_SCHEMA_VERSION = "merge_conflict_packet/v1";
export const MERGE_CONFLICT_PACKET_TYPE = "merge_conflict_packet";

export function buildMergeConflictPacket({
  repo = "",
  branch = "",
  issueNumber = "",
  worktreeDir = "",
  conflictFiles = [],
  branchCommits = [],
  mainCommitsTouchingConflicts = [],
  mergeCandidateIssues = [],
  mergeStderr = "",
  notes = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const resolvedRepo = trim(repo);
  const resolvedBranch = trim(branch);
  const resolvedIssueNumber = trim(issueNumber);
  const resolvedWorktreeDir = trim(worktreeDir);
  const commandRoot = resolvedWorktreeDir || resolvedRepo;
  const scopeLabel = resolvedWorktreeDir ? "wave worktree" : "repo root";
  const identity = {
    repo: resolvedRepo,
    branch: resolvedBranch,
    issue_number: resolvedIssueNumber,
    run_id: trim(runId),
    pipeline: trim(pipeline),
    node_id: trim(nodeId),
  };
  const packetId = makePacketId({
    packetType: MERGE_CONFLICT_PACKET_TYPE,
    identity,
  });

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: MERGE_CONFLICT_PACKET_SCHEMA_VERSION,
      packetType: MERGE_CONFLICT_PACKET_TYPE,
      packetId,
      factoryId,
      runId,
      pipeline,
      nodeId,
      targetRepo: targetRepo || repo,
      controlPlaneRepo,
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "supervisor",
      handoffKind: "merge_conflict_recovery",
      resourceRefs: {
        repo: resolvedRepo,
        branch: resolvedBranch,
        issue_number: resolvedIssueNumber,
        worktree_dir: resolvedWorktreeDir,
      },
      inspectionCommands: [
        commandRoot ? `git -C '${commandRoot}' status --short --branch` : "",
        commandRoot ? `git -C '${commandRoot}' diff --name-only --diff-filter=U` : "",
      ],
      executionCommands: [
        `Resolve every conflicted file in the ${scopeLabel} without dropping intended branch changes.`,
        `If rebase/merge is paused, stage the resolved files and continue the in-progress merge or rebase before leaving the ${scopeLabel}.`,
      ],
      verifyCommands: [
        commandRoot ? `git -C '${commandRoot}' diff --name-only --diff-filter=U` : "",
        commandRoot ? `git -C '${commandRoot}' status --short` : "",
      ],
      expectedOutcomes: [
        `No unresolved conflict markers remain in the ${scopeLabel}.`,
        "The in-progress merge or rebase is either completed or cleanly aborted with preserved evidence.",
      ],
      preserveWork: {
        preserve_work_required: true,
        worktree_dir: resolvedWorktreeDir,
        branch: resolvedBranch,
      },
      operatorPrompt: `Start in the referenced ${scopeLabel}, inspect the conflicted files, preserve the branch state, resolve the conflicts, and only complete the merge if verification shows the ${scopeLabel} is clean.`,
    }),
    issue_number: resolvedIssueNumber,
    branch: resolvedBranch,
    repo: resolvedRepo,
    worktree_dir: resolvedWorktreeDir,
    conflict_files: Array.isArray(conflictFiles) ? conflictFiles.map((item) => trim(item)).filter(Boolean) : [],
    branch_commits: Array.isArray(branchCommits) ? branchCommits : [],
    main_commits_touching_conflicts: Array.isArray(mainCommitsTouchingConflicts) ? mainCommitsTouchingConflicts : [],
    merge_candidate_issues: (Array.isArray(mergeCandidateIssues) ? mergeCandidateIssues : []).map((n) => String(n)).filter(Boolean),
    merge_stderr: String(mergeStderr || ""),
    notes: trim(notes),
  };
}

export function validateMergeConflictPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const errors = [...base.errors];
  if (trim(packet?.schema_version) !== MERGE_CONFLICT_PACKET_SCHEMA_VERSION) {
    errors.push(`invalid_schema_version:${trim(packet?.schema_version) || "(empty)"}`);
  }
  if (trim(packet?.packet_type) !== MERGE_CONFLICT_PACKET_TYPE) {
    errors.push(`invalid_packet_type:${trim(packet?.packet_type) || "(empty)"}`);
  }
  if (!Object.prototype.hasOwnProperty.call(packet || {}, "conflict_files") || !Array.isArray(packet.conflict_files)) {
    errors.push("missing_required_field:conflict_files");
  }
  if (!Object.prototype.hasOwnProperty.call(packet || {}, "branch_commits") || !Array.isArray(packet.branch_commits)) {
    errors.push("missing_required_field:branch_commits");
  }
  if (!Object.prototype.hasOwnProperty.call(packet || {}, "main_commits_touching_conflicts") || !Array.isArray(packet.main_commits_touching_conflicts)) {
    errors.push("missing_required_field:main_commits_touching_conflicts");
  }
  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistMergeConflictPacket({ repo = "", packet = {} } = {}) {
  const validation = validateMergeConflictPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_merge_conflict_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}
