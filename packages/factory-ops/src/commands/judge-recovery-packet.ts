import { trim, gh } from "../lib/cli-helpers.ts";
import { persistRemediationPacket, buildRemediationPacket } from "../lib/remediation-packet.ts";


function asIssueCommand(repo = "", issueNumber = "") {
  const resolvedRepo = trim(repo);
  const resolvedIssue = trim(issueNumber);
  if (!resolvedRepo || !resolvedIssue) return "";
  return `gh issue view ${resolvedIssue} --repo ${resolvedRepo} --json number,title,state,labels,milestone,body`;
}

function asFileInspect(path = "") {
  const resolved = trim(path);
  return resolved ? `cat '${resolved}'` : "";
}

function asGitStatus(repo = "") {
  const resolved = trim(repo);
  return resolved ? `git -C '${resolved}' status --short --branch` : "";
}

export function buildJudgeRecoveryPacket({
  repo = "",
  packetType = "",
  judgeKind = "",
  milestoneTitle = "",
  readyIssueNumber = "",
  gateCode = "",
  routeCode = "",
  errorText = "",
  judgeContextPath = "",
  judgeEvidencePath = "",
  scenarioRegistryRoot = "",
  judgeContextScopeIdentity = "",
  branch = "",
  worktreeDir = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const resolvedRepo = trim(repo);
  const resolvedPacketType = trim(packetType);
  const resolvedMilestone = trim(milestoneTitle);
  const resolvedIssueNumber = trim(readyIssueNumber);
  const resolvedJudgeKind = trim(judgeKind);
  const resolvedGateCode = trim(gateCode);
  const resolvedRouteCode = trim(routeCode);
  const resolvedErrorText = trim(errorText);
  const resolvedScenarioRegistryRoot = trim(scenarioRegistryRoot);
  const resolvedScopeIdentity = trim(judgeContextScopeIdentity);
  const resolvedBranch = trim(branch);
  const resolvedWorktreeDir = trim(worktreeDir);

  const packet = buildRemediationPacket({
    packetType: resolvedPacketType,
    intent: `Recover a failed ${resolvedJudgeKind || "judge"} ${resolvedPacketType.includes("context") ? "context" : "evidence"} contract and restore the wave to a valid pre-merge state.`,
    inspectionCommands: [
      asGitStatus(resolvedRepo),
      asIssueCommand(targetRepo || resolvedRepo, resolvedIssueNumber),
      asFileInspect(judgeContextPath),
      asFileInspect(judgeEvidencePath),
      resolvedScenarioRegistryRoot ? `find '${resolvedScenarioRegistryRoot}' -maxdepth 3 -type f | sort` : "",
    ].filter(Boolean),
    executionCommands: [
      "Use the referenced contract files and scenario registry to identify the missing or invalid judge inputs.",
      "Patch the repo if the judge contract generator or registry metadata is wrong, then rerun the affected judge contract build/validate steps.",
      "If the contract is not safely repairable from repo and GitHub state, escalate with the packet context instead of guessing.",
    ],
    verifyCommands: [
      "Re-run the affected judge contract build and validation commands for this wave.",
      asGitStatus(resolvedRepo),
    ].filter(Boolean),
    expectedPostconditions: [
      "judge contract build/validation passes for the affected wave",
      "the wave can proceed without losing ownership, branch context, or review evidence",
    ],
    retryPolicy: {
      max_attempts: 1,
      on_failure: "escalate_with_packet_context",
      recheck_after: "after_repo_fix",
    },
    requiresRepoFix: true,
    resourceRefs: {
      repo: resolvedRepo,
      target_repo: trim(targetRepo || resolvedRepo),
      control_plane_repo: trim(controlPlaneRepo),
      milestone_title: resolvedMilestone,
      ready_issue_number: resolvedIssueNumber,
      judge_kind: resolvedJudgeKind,
      gate_code: resolvedGateCode,
      route_code: resolvedRouteCode,
      error_text: resolvedErrorText,
      judge_context_path: trim(judgeContextPath),
      judge_evidence_path: trim(judgeEvidencePath),
      scenario_registry_root: resolvedScenarioRegistryRoot,
      judge_context_scope_identity: resolvedScopeIdentity,
      branch: resolvedBranch,
      worktree_dir: resolvedWorktreeDir,
    },
    preserveWork: {
      preserve_work_required: true,
      cleanup_blocked_until_preserved: true,
      preserve_actions: [
        "Do not delete the wave worktree or release branch context until contract repair or escalation is complete.",
      ],
    },
    operatorPrompt: [
      `Start with the persisted packet and repair the ${resolvedJudgeKind || "judge"} contract failure for milestone '${resolvedMilestone || "unknown"}'.`,
      `Use repo '${resolvedRepo || "."}' plus GitHub repo '${trim(targetRepo || resolvedRepo)}'.`,
      resolvedScopeIdentity ? `Scope identity: ${resolvedScopeIdentity}.` : "",
      resolvedScenarioRegistryRoot ? `Scenario registry root: ${resolvedScenarioRegistryRoot}.` : "",
      trim(judgeContextPath) ? `Judge context artifact: ${trim(judgeContextPath)}.` : "",
      trim(judgeEvidencePath) ? `Judge evidence artifact: ${trim(judgeEvidencePath)}.` : "",
      resolvedErrorText ? `Failure signal: ${resolvedErrorText}.` : "",
      "Correct outcome: the affected judge contract validates successfully or you escalate with this packet as the durable handoff.",
    ].filter(Boolean).join(" "),
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persisted = persistRemediationPacket({ repo: resolvedRepo, packet });
  return {
    packet_path: persisted.packet_path,
    packet_id: packet.packet_id,
    packet_schema_version: packet.schema_version,
    packet_storage_class: persisted.storage_class,
    packet_type: packet.packet_type,
  };
}
