import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload } from "../helpers.ts";
import { goalHardPlanCommands } from "./goal-hard-plan.ts";
import { goalHardPlanningCommands } from "./goal-hard-planning-cli.ts";
import { goalRationaleCommands } from "./goal-rationale-cli.ts";
async function resolveRepoOrExit(command, rawRepo = "") {
  try {
    const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
    return resolveGhRepo(rawRepo);
  } catch (error) {
    command.context.stderr.write(String(error?.message || error) + "\n");
    return "";
  }
}
export class GoalFinalStateReviewCommand extends Command {
  static paths = [["goal", "final-state-review"]];
  repo = Option.String("--repo", ""); goalNumber = Option.String("--goal-number", ""); mode = Option.String("--mode", "issue");
  repoRoot = Option.String("--repo-root", ".");
  directGoalResult = Option.String("--direct-goal-result", ""); directGoalOutcomeNotes = Option.String("--direct-goal-outcome-notes", { required: false });
  directGoalOutcomeNotesB64 = Option.String("--direct-goal-outcome-notes-b64", { required: false }); runId = Option.String("--run-id", ""); runsDir = Option.String("--runs-dir", ".hatch/runs");
  allSubIssueExecutionsCompleted = Option.Boolean("--all-sub-issue-executions-completed", false);
  async execute() {
    const { reconcileGoalFinalState } = await import("../../commands/goal-final-state-review.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const directGoalOutcomeNotes = resolveB64OrRaw(this.directGoalOutcomeNotes, this.directGoalOutcomeNotesB64, "direct-goal-outcome-notes");
    const out = await reconcileGoalFinalState({ repo, repoRoot: this.repoRoot, goalNumber: this.goalNumber, mode: this.mode, directGoalResult: this.directGoalResult, directGoalOutcomeNotes, runId: this.runId, runsDir: this.runsDir, allSubIssueExecutionsCompleted: this.allSubIssueExecutionsCompleted });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalFetchGoalIssueCommand extends Command {
  static paths = [["goal", "fetch-goal-issue"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  async execute() {
    const { fetchGoalIssue } = await import("../../commands/milestone-fetch-goal-issue.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = fetchGoalIssue({ repo, goalNumber: this.goalNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalAutoReadyArtifactsCommand extends Command {
  static paths = [["goal", "auto-ready-artifacts"]];
  repo = Option.String("--repo", "");
  async execute() {
    const { autoReadyArtifactGoals } = await import("../../commands/goal-auto-ready-artifacts.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = autoReadyArtifactGoals({ repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalSanitizeDuplicatesCommand extends Command {
  static paths = [["goal", "sanitize-duplicates"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_queue");
  dryRun = Option.Boolean("--dry-run", false);
  async execute() {
    const { sanitizeGoalDuplicates } = await import("../../commands/goal-sanitize-duplicates.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = sanitizeGoalDuplicates({ repo, runId: this.runId, pipeline: this.pipeline, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalListReadyCommand extends Command {
  static paths = [["goal", "list-ready"]];
  repo = Option.String("--repo", "");
  async execute() {
    const { listReadyGoals } = await import("../../commands/goal-queue-ops.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = listReadyGoals({ repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalDecomposeBackpressureCommand extends Command {
  static paths = [["goal", "decompose-backpressure"]];
  repo = Option.String("--repo", "");
  maxConcurrentGoals = Option.String("--max-concurrent-goals", "");
  maxConcurrentWaves = Option.String("--max-concurrent-waves", "");
  async execute() {
    const { evaluateGoalDecomposeBackpressure } = await import("../../commands/goal-queue-ops.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = evaluateGoalDecomposeBackpressure({
      repo,
      maxConcurrentGoals: this.maxConcurrentGoals,
      maxConcurrentWaves: this.maxConcurrentWaves,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalApplyDecisionsCommand extends Command {
  static paths = [["goal", "apply-decisions"]];
  repo = Option.String("--repo", "");
  decisions = Option.String("--decisions", { required: false });
  decisionsB64 = Option.String("--decisions-b64", { required: false });
  async execute() {
    const { applyGoalDecisions } = await import("../../commands/goal-queue-ops.ts");
    let decisionsRaw;
    try {
      decisionsRaw = await resolveJsonPayload({
        flag: this.decisions,
        flagB64: this.decisionsB64,
        flagName: "decisions",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = applyGoalDecisions({ repo, decisionsRaw });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalValidateDecisionsCommand extends Command {
  static paths = [["goal", "validate-decisions"]];
  goalIssues = Option.String("--goal-issues", "[]");
  decisions = Option.String("--decisions", "");
  async execute() {
    const { validateGoalDecisions } = await import("../../commands/goal-validate-decisions.ts");
    const out = validateGoalDecisions({
      goalIssuesRaw: this.goalIssues,
      decisionsRaw: this.decisions,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
export class GoalFilterKeptCommand extends Command {
  static paths = [["goal", "filter-kept"]];
  issues = Option.String("--issues", { required: false });
  issuesB64 = Option.String("--issues-b64", { required: false });
  decisions = Option.String("--decisions", { required: false });
  decisionsB64 = Option.String("--decisions-b64", { required: false });
  async execute() {
    const { filterKeptGoals } = await import("../../commands/goal-queue-ops.ts");
    let issuesRaw;
    let decisionsRaw;
    try {
      issuesRaw = await resolveJsonPayload({
        flag: this.issues,
        flagB64: this.issuesB64,
        flagName: "issues",
        allowStdin: true,
      });
      decisionsRaw = await resolveJsonPayload({
        flag: this.decisions,
        flagB64: this.decisionsB64,
        flagName: "decisions",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const out = filterKeptGoals({ issuesRaw: issuesRaw || "[]", decisionsRaw: decisionsRaw || "" });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalLimitKeptCommand extends Command {
  static paths = [["goal", "limit-kept"]];
  keptGoals = Option.String("--kept-goals", { required: false });
  keptGoalsB64 = Option.String("--kept-goals-b64", { required: false });
  maxGoalsPerTick = Option.String("--max-goals-per-tick", "2");
  async execute() {
    const { limitKeptGoalsForTick } = await import("../../commands/goal-queue-ops.ts");
    let keptGoalsRaw;
    try {
      keptGoalsRaw = await resolveJsonPayload({
        flag: this.keptGoals,
        flagB64: this.keptGoalsB64,
        flagName: "kept-goals",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const out = limitKeptGoalsForTick({ keptGoalsRaw, maxGoalsPerTick: this.maxGoalsPerTick });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalCheckDecomposedCommand extends Command {
  static paths = [["goal", "check-decomposed"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  repoRoot = Option.String("--repo-root", ".");
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { checkGoalAlreadyDecomposedWithPackets } = await import("../../commands/goal-check-decomposed.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    this.context.stdout.write(checkGoalAlreadyDecomposedWithPackets({
      repo,
      issueNumber: this.issueNumber,
      repoRoot: this.repoRoot,
      factoryId: this.factoryId,
    }));
    return 0;
  }
}
export class GoalPersistDecompositionPacketCommand extends Command {
  static paths = [["goal", "persist-decomposition-packet"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  goalContext = Option.String("--goal-context", { required: false });
  goalContextB64 = Option.String("--goal-context-b64", { required: false });
  approvedFeatures = Option.String("--approved-features", { required: false });
  approvedFeaturesB64 = Option.String("--approved-features-b64", { required: false });
  issueUrls = Option.String("--issue-urls", { required: false });
  issueUrlsB64 = Option.String("--issue-urls-b64", { required: false });
  goalIssueNumber = Option.String("--goal-issue-number", "");
  goalIssueTitle = Option.String("--goal-issue-title", "");
  goalIssueUrl = Option.String("--goal-issue-url", "");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_run");
  nodeId = Option.String("--node-id", "persist_decomposition_packet");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  async execute() {
    const { persistGoalDecompositionLedger } = await import("../../commands/goal-decomposition-packet.ts");
    let goalIssueRaw;
    let goalContextRaw;
    let approvedFeaturesRaw;
    let issueUrlsRaw;
    try {
      goalIssueRaw = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: false,
      });
      goalContextRaw = await resolveJsonPayload({
        flag: this.goalContext,
        flagB64: this.goalContextB64,
        flagName: "goal-context",
        allowStdin: false,
      });
      approvedFeaturesRaw = await resolveJsonPayload({
        flag: this.approvedFeatures,
        flagB64: this.approvedFeaturesB64,
        flagName: "approved-features",
        allowStdin: false,
      });
      issueUrlsRaw = await resolveJsonPayload({
        flag: this.issueUrls,
        flagB64: this.issueUrlsB64,
        flagName: "issue-urls",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const out = persistGoalDecompositionLedger({
      repo: this.repoRoot,
      goalIssueRaw: goalIssueRaw || "",
      goalContextRaw: goalContextRaw || "",
      approvedFeaturesRaw: approvedFeaturesRaw || "",
      issueUrlsRaw: issueUrlsRaw || "",
      goalIssueNumber: this.goalIssueNumber,
      goalIssueTitle: this.goalIssueTitle,
      goalIssueUrl: this.goalIssueUrl,
      factoryId: this.factoryId,
      runId: this.runId,
      pipeline: this.pipeline,
      nodeId: this.nodeId,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalAdmissionCheckCommand extends Command {
  static paths = [["goal", "admission-check"]];
  repoRoot = Option.String("--repo-root", "."); goalIssueNumber = Option.String("--goal-issue-number", "");
  goalExecutionPath = Option.String("--goal-execution-path", ""); goalRoutingState = Option.String("--goal-routing-state", "{}");
  goalRoutingStateB64 = Option.String("--goal-routing-state-b64", { required: false });
  goalLabels = Option.String("--goal-labels", { required: false }); goalLabelsB64 = Option.String("--goal-labels-b64", { required: false });
  hardGoal = Option.String("--hard-goal", { required: false }); hardGoalState = Option.String("--hard-goal-state", { required: false });
  hardGoalStateReason = Option.String("--hard-goal-state-reason", { required: false });
  readyLabelPresent = Option.String("--ready-label-present", { required: false });
  awaitingHumanLabelPresent = Option.String("--awaiting-human-label-present", { required: false });
  hardPlanPacketPresent = Option.String("--hard-plan-packet-present", { required: false });
  hardPlanPacketId = Option.String("--hard-plan-packet-id", { required: false });
  hardPlanPacketPath = Option.String("--hard-plan-packet-path", { required: false });
  hardPlanCommentMarker = Option.String("--hard-plan-comment-marker", { required: false });
  hardPlanCommentId = Option.String("--hard-plan-comment-id", { required: false });
  hardPlanCommentUrl = Option.String("--hard-plan-comment-url", { required: false });
  hardPlanArtifactCount = Option.String("--hard-plan-artifact-count", { required: false });
  hardPlanArtifactRefs = Option.String("--hard-plan-artifact-refs", { required: false });
  hardPlanArtifactRefsB64 = Option.String("--hard-plan-artifact-refs-b64", { required: false });
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { inspectGoalRunAdmission } = await import("../../commands/goal-run-admission.ts");
    let goalRoutingStateRaw = this.goalRoutingState;
    if (this.goalRoutingStateB64 !== undefined) {
      try { goalRoutingStateRaw = Buffer.from(this.goalRoutingStateB64, "base64").toString("utf8"); } catch (error) {
        this.context.stderr.write(String(error?.message || error) + "\n"); return 2;
      }
    }
    let goalLabelsRaw = ""; let hardPlanArtifactRefsRaw = "";
    try {
      goalLabelsRaw = await resolveJsonPayload({ flag: this.goalLabels, flagB64: this.goalLabelsB64, flagName: "goal-labels", allowStdin: false }) || "";
      hardPlanArtifactRefsRaw = await resolveJsonPayload({
        flag: this.hardPlanArtifactRefs,
        flagB64: this.hardPlanArtifactRefsB64,
        flagName: "hard-plan-artifact-refs",
        allowStdin: false,
      }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    try {
      const out = inspectGoalRunAdmission({
        repo: this.repoRoot,
        goalIssueNumber: this.goalIssueNumber,
        goalExecutionPath: this.goalExecutionPath,
        goalRoutingStateRaw,
        goalLabelsRaw,
        goalLabels: goalLabelsRaw,
        hardGoal: this.hardGoal,
        hardGoalState: this.hardGoalState,
        hardGoalStateReason: this.hardGoalStateReason,
        readyLabelPresent: this.readyLabelPresent,
        awaitingHumanLabelPresent: this.awaitingHumanLabelPresent,
        hardPlanPacketPresent: this.hardPlanPacketPresent,
        hardPlanPacketId: this.hardPlanPacketId,
        hardPlanPacketPath: this.hardPlanPacketPath,
        hardPlanCommentMarker: this.hardPlanCommentMarker,
        hardPlanCommentId: this.hardPlanCommentId,
        hardPlanCommentUrl: this.hardPlanCommentUrl,
        hardPlanArtifactCount: this.hardPlanArtifactCount,
        hardPlanArtifactRefsRaw,
        hardPlanArtifactRefs: hardPlanArtifactRefsRaw,
        factoryId: this.factoryId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}
export class GoalAdmissionFailCommand extends Command {
  static paths = [["goal", "admission-fail"]];
  goalIssueNumber = Option.String("--goal-issue-number", "");
  goalAdmissionDecision = Option.String("--goal-admission-decision", "");
  goalAdmissionReason = Option.String("--goal-admission-reason", "");
  goalAdmissionErrorCode = Option.String("--goal-admission-error-code", "");
  decompositionPacketPresent = Option.String("--decomposition-packet-present", "");
  planningLocked = Option.String("--planning-locked", "");
  async execute() {
    const { buildGoalRunAdmissionFailure } = await import("../../commands/goal-run-admission.ts");
    const out = buildGoalRunAdmissionFailure({
      goalIssueNumber: this.goalIssueNumber,
      goalAdmissionDecision: this.goalAdmissionDecision,
      goalAdmissionReason: this.goalAdmissionReason,
      goalAdmissionErrorCode: this.goalAdmissionErrorCode,
      decompositionPacketPresent: this.decompositionPacketPresent,
      planningLocked: this.planningLocked,
    });
    this.context.stdout.write(JSON.stringify(out));
    this.context.stderr.write(`${out.error}\n`);
    return 1;
  }
}
export class GoalDuplicateDecomposeGuardCommand extends Command {
  static paths = [["goal", "duplicate-decompose-guard"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  repoRoot = Option.String("--repo-root", ".");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_run");
  nodeId = Option.String("--node-id", "duplicate_decompose_guard");
  async execute() {
    const { guardDuplicateGoalDecomposition } = await import("../../commands/goal-duplicate-decompose-guard.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    try {
      const out = guardDuplicateGoalDecomposition({
        repo,
        repoRoot: this.repoRoot,
        issueNumber: this.issueNumber,
        factoryId: this.factoryId,
        runId: this.runId,
        pipeline: this.pipeline,
        nodeId: this.nodeId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      const message = String(error?.message || error);
      this.context.stderr.write(`${message}\n`);
      return 1;
    }
  }
}
export class GoalAdmissionResetCommand extends Command {
  static paths = [["goal", "admission-reset"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  reason = Option.String("--reason", "");
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { resetGoalRunAdmissionLocks } = await import("../../commands/goal-run-admission.ts");
    try {
      const out = resetGoalRunAdmissionLocks({
        repo: this.repoRoot,
        goalIssueNumber: this.goalIssueNumber,
        reason: this.reason,
        factoryId: this.factoryId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}
export class GoalHardStateInspectCommand extends Command {
  static paths = [["goal", "hard-state"]];
  repo = Option.String("--repo", ""); repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", ""); goalExecutionPath = Option.String("--goal-execution-path", "");
  goalRoutingState = Option.String("--goal-routing-state", "{}"); goalRoutingStateB64 = Option.String("--goal-routing-state-b64", { required: false });
  goalLabels = Option.String("--goal-labels", { required: false }); goalLabelsB64 = Option.String("--goal-labels-b64", { required: false });
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { inspectHardGoalState } = await import("../../commands/goal-hard-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    let goalRoutingStateRaw = this.goalRoutingState;
    if (this.goalRoutingStateB64 !== undefined) {
      try { goalRoutingStateRaw = Buffer.from(this.goalRoutingStateB64, "base64").toString("utf8"); } catch (error) {
        this.context.stderr.write(String(error?.message || error) + "\n"); return 2;
      }
    }
    let goalLabelsRaw = "";
    try {
      goalLabelsRaw = await resolveJsonPayload({ flag: this.goalLabels, flagB64: this.goalLabelsB64, flagName: "goal-labels", allowStdin: false }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    try {
      const out = inspectHardGoalState({
        repo,
        repoRoot: this.repoRoot,
        goalIssueNumber: this.goalIssueNumber,
        goalExecutionPath: this.goalExecutionPath,
        goalRoutingStateRaw,
        goalRoutingState: goalRoutingStateRaw,
        goalLabelsRaw,
        goalLabels: goalLabelsRaw,
        factoryId: this.factoryId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}
export class GoalExecutionPathClassifyCommand extends Command {
  static paths = [["goal", "execution-path", "classify"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  executionPath = Option.String("--execution-path", "");
  routingContractVersion = Option.String("--routing-contract-version", "");
  classificationVersion = Option.String("--classification-version", "");
  decompositionState = Option.String("--decomposition-state", "");
  planningState = Option.String("--planning-state", "");
  classifiedAt = Option.String("--classified-at", "");
  classifiedBy = Option.String("--classified-by", "");
  classificationReason = Option.String("--classification-reason", "");
  planningArtifactPath = Option.String("--planning-artifact-path", "");
  understandingRisk = Option.String("--understanding-risk", "");
  rationaleRequired = Option.String("--rationale-required", "");
  classificationSignals = Option.String("--classification-signals", { required: false });
  classificationSignalsB64 = Option.String("--classification-signals-b64", { required: false });
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_run");
  nodeId = Option.String("--node-id", "persist_execution_path_packet");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  async execute() {
    const { classifyGoalExecutionPath } = await import("../../commands/goal-execution-path.ts");
    let classificationSignalsRaw;
    try {
      classificationSignalsRaw = await resolveJsonPayload({
        flag: this.classificationSignals,
        flagB64: this.classificationSignalsB64,
        flagName: "classification-signals",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const { parseJson } = await import("../../lib/cli-helpers.ts");
    const classificationSignals = parseJson(classificationSignalsRaw || "", null);
    const out = classifyGoalExecutionPath({
      repo: this.repoRoot,
      goalIssueNumber: this.goalIssueNumber,
      executionPath: this.executionPath,
      routingContractVersion: this.routingContractVersion,
      classificationVersion: this.classificationVersion,
      decompositionState: this.decompositionState,
      planningState: this.planningState,
      planningArtifactPath: this.planningArtifactPath,
      understandingRisk: this.understandingRisk,
      rationaleRequired: this.rationaleRequired,
      classifiedAt: this.classifiedAt,
      classifiedBy: this.classifiedBy,
      classificationReason: this.classificationReason,
      classificationSignalsRaw: classificationSignalsRaw || "",
      classificationSignals,
      factoryId: this.factoryId,
      runId: this.runId,
      pipeline: this.pipeline,
      nodeId: this.nodeId,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalExecutionPathInspectCommand extends Command {
  static paths = [["goal", "execution-path", "inspect"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { inspectGoalExecutionPath } = await import("../../commands/goal-execution-path.ts");
    const out = inspectGoalExecutionPath({
      repo: this.repoRoot,
      goalIssueNumber: this.goalIssueNumber,
      factoryId: this.factoryId,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalExecutionPathEnsureCommand extends Command {
  static paths = [["goal", "execution-path", "ensure"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", { required: false });
  goalIssues = Option.String("--goal-issues", { required: false });
  goalIssuesB64 = Option.String("--goal-issues-b64", { required: false });
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const {
      ensureGoalExecutionPath,
      ensureGoalExecutionPaths,
    } = await import("../../commands/goal-execution-path.ts");
    let goalIssuesRaw = "";
    try {
      goalIssuesRaw = await resolveJsonPayload({
        flag: this.goalIssues,
        flagB64: this.goalIssuesB64,
        flagName: "goal-issues",
        allowStdin: false,
      }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    try {
      const out = goalIssuesRaw
        ? ensureGoalExecutionPaths({
          repo: this.repoRoot,
          goalIssueNumbersRaw: goalIssuesRaw,
          factoryId: this.factoryId,
        })
        : ensureGoalExecutionPath({
          repo: this.repoRoot,
          goalIssueNumber: this.goalIssueNumber || "",
          factoryId: this.factoryId,
        });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}
export class GoalExecutionPathResolveCommand extends Command {
  static paths = [["goal", "execution-path", "resolve"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  goalExecutionPaths = Option.String("--goal-execution-paths", { required: false });
  goalExecutionPathsB64 = Option.String("--goal-execution-paths-b64", { required: false });
  factoryId = Option.String("--factory-id", "mothership");
  async execute() {
    const { resolveGoalExecutionPath } = await import("../../commands/goal-execution-path.ts");
    let goalExecutionPathsRaw = "";
    try {
      goalExecutionPathsRaw = await resolveJsonPayload({
        flag: this.goalExecutionPaths,
        flagB64: this.goalExecutionPathsB64,
        flagName: "goal-execution-paths",
        allowStdin: false,
      }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    try {
      const out = resolveGoalExecutionPath({
        repo: this.repoRoot,
        goalIssueNumber: this.goalIssueNumber,
        goalExecutionPathsRaw,
        factoryId: this.factoryId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}
export class GoalComputeCloseConditionCommand extends Command {
  static paths = [["goal", "compute-close-condition"]];
  issueCount = Option.String("--issue-count", "0");
  approvedFeatureCount = Option.String("--approved-feature-count", "");
  async execute() {
    const { computeGoalRunCloseCondition } = await import("../../commands/goal-queue-ops.ts");
    this.context.stdout.write(computeGoalRunCloseCondition({
      issueCount: this.issueCount,
      approvedFeatureCount: this.approvedFeatureCount,
    }));
    return 0;
  }
}
export class GoalCountDecomposeAttemptsCommand extends Command {
  static paths = [["goal", "count-decompose-attempts"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  async execute() {
    const { countDecomposeAttemptsFromGitHub } = await import("../../commands/goal-queue-ops.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    this.context.stdout.write(countDecomposeAttemptsFromGitHub({ repo, issueNumber: this.issueNumber }));
    return 0;
  }
}
export class GoalExhaustDecomposeRetriesCommand extends Command {
  static paths = [["goal", "exhaust-decompose-retries"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  decomposeRetryCount = Option.String("--decompose-retry-count", "0");
  async execute() {
    const { exhaustDecomposeRetries } = await import("../../commands/goal-run-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = exhaustDecomposeRetries({
      repo,
      issueNumber: this.issueNumber,
      decomposeRetryCount: this.decomposeRetryCount,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
export class GoalMarkDispatchedCommand extends Command {
  static paths = [["goal", "mark-dispatched"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  async execute() {
    const { markGoalDispatched } = await import("../../commands/goal-run-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = markGoalDispatched({ repo, issueNumber: this.issueNumber });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
export class GoalPostDecomposeAttemptCommand extends Command {
  static paths = [["goal", "post-decompose-attempt"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  decomposeAttemptNumber = Option.String("--decompose-attempt-number", "1");
  async execute() {
    const { postDecomposeAttemptMarker } = await import("../../commands/goal-run-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = postDecomposeAttemptMarker({
      repo,
      issueNumber: this.issueNumber,
      decomposeAttemptNumber: this.decomposeAttemptNumber,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
export class GoalPostRetryCommentCommand extends Command {
  static paths = [["goal", "post-retry-comment"]];
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  approvedFeatureCount = Option.String("--approved-feature-count", "0");
  issueCount = Option.String("--issue-count", "0");
  decomposeApproved = Option.String("--decompose-approved", "");
  decomposeAttempts = Option.String("--decompose-attempts", "0");
  decomposeParseStatus = Option.String("--decompose-parse-status", "");
  decomposeParseSource = Option.String("--decompose-parse-source", "");
  async execute() {
    const { postGoalRetryComment } = await import("../../commands/goal-run-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = postGoalRetryComment({
      repo,
      issueNumber: this.issueNumber,
      approvedFeatureCount: this.approvedFeatureCount,
      issueCount: this.issueCount,
      decomposeApproved: this.decomposeApproved,
      decomposeAttempts: this.decomposeAttempts,
      decomposeParseStatus: this.decomposeParseStatus,
      decomposeParseSource: this.decomposeParseSource,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
export class GoalSweepCompletedCommand extends Command {
  static paths = [["goal", "sweep-completed"]];
  repo = Option.String("--repo", "");
  repoRoot = Option.String("--repo-root", ".");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  async execute() {
    const { sweepCompletedGoals } = await import("../../commands/goal-sweep-completed.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = await sweepCompletedGoals({ repo, repoRoot: this.repoRoot, runsDir: this.runsDir });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalBuildFallbackFeaturesCommand extends Command {
  static paths = [["goal", "build-fallback-features"]];
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  goalNumber = Option.String("--goal-number", "");
  async execute() {
    try {
      const { buildFallbackFeatures } = await import("../../commands/goal-build-fallback-features.ts");
      const goalIssueRaw = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: true,
      });
      this.context.stdout.write(buildFallbackFeatures({ goalIssueRaw: goalIssueRaw || "{}", goalNumber: this.goalNumber }));
      return 0;
    } catch (err) {
      this.context.stderr.write(String(err?.message || err) + "\n");
      return 1;
    }
  }
}
export class GoalEmitFallbackDefectCommand extends Command {
  static paths = [["goal", "emit-fallback-defect"]];
  fallbackNode = Option.String("--fallback-node", "");
  pipeline = Option.String("--pipeline", "goal_intake_decompose");
  runId = Option.String("--run-id", "");
  triggerReason = Option.String("--trigger-reason", "");
  classification = Option.String("--classification", "");
  severity = Option.String("--severity", "");
  approved = Option.String("--approved", "");
  decomposeParseStatus = Option.String("--decompose-parse-status", "");
  preNormalizeFeatureCount = Option.String("--pre-normalize-feature-count", "");
  postNormalizeFeatureCount = Option.String("--post-normalize-feature-count", "");
  issuesCreated = Option.String("--issues-created", "");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  factoryId = Option.String("--factory-id", "");
  async execute() {
    try {
      const { emitAndPersistFallbackDefectSignal } = await import("../../commands/goal-fallback-defect.ts");
      const out = emitAndPersistFallbackDefectSignal({
        fallbackNode: this.fallbackNode,
        pipeline: this.pipeline,
        runId: this.runId,
        triggerReason: this.triggerReason,
        classification: this.classification,
        severity: this.severity,
        approved: this.approved,
        decomposeParseStatus: this.decomposeParseStatus,
        preNormalizeFeatureCount: this.preNormalizeFeatureCount,
        postNormalizeFeatureCount: this.postNormalizeFeatureCount,
        issuesCreated: this.issuesCreated,
        goalIssueNumber: this.goalIssueNumber,
        runsDir: this.runsDir,
        factoryId: this.factoryId,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}
export class GoalParseExternalBugReportCommand extends Command {
  static paths = [["goal", "parse-external-bug-report"]];
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  async execute() {
    try {
      const { parseExternalBugReport } = await import("../../commands/goal-parse-external-bug-report.ts");
      const goalIssueRaw = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: true,
      });
      this.context.stdout.write(JSON.stringify(parseExternalBugReport({ goalIssueRaw: goalIssueRaw || "{}" })));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}
// -- goal seed-state --
export class GoalSeedStateCommand extends Command {
  static paths = [["goal", "seed-state"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  runsDir = Option.String("--runs-dir", "");
  async execute() {
    const { seedGoalState } = await import("../../commands/goal-seed-state.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = seedGoalState({ repo, goalNumber: this.goalNumber, runsDir: this.runsDir || undefined });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal next-issue --
export class GoalNextIssueCommand extends Command {
  static paths = [["goal", "next-issue"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  completedRaw = Option.String("--completed", "[]");
  processedRaw = Option.String("--processed", "[]");
  candidateLimit = Option.String("--candidate-limit", "3");
  async execute() {
    const { pickNextGoalIssueFromArgs } = await import("../../commands/goal-next-issue.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = pickNextGoalIssueFromArgs({
      repo,
      goalNumber: this.goalNumber,
      completedRaw: this.completedRaw,
      processedRaw: this.processedRaw,
      candidateLimit: Number(this.candidateLimit),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal build-item --
export class GoalBuildItemCommand extends Command {
  static paths = [["goal", "build-item"]];
  issueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", "");
  async execute() {
    const { buildGoalIssueItem } = await import("../../commands/goal-build-item.ts");
    const out = buildGoalIssueItem({ issueNumber: this.issueNumber, issueTitle: this.issueTitle });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal empty-branch-context --
export class GoalEmptyBranchContextCommand extends Command {
  static paths = [["goal", "empty-branch-context"]];
  goalNumber = Option.String("--goal-number", "");
  async execute() {
    const { emptyGoalBranchContext } = await import("../../commands/goal-build-item.ts");
    const out = emptyGoalBranchContext({ goalNumber: this.goalNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalAccumulateCommand extends Command {
  static paths = [["goal", "accumulate"]];
  implResultsRaw = Option.String("--impl-results", "[]");
  completedRaw = Option.String("--completed", "[]");
  processedRaw = Option.String("--processed", "[]");
  itemRaw = Option.String("--item", "{}");
  fallbackIssueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });
  consecutiveFailCount = Option.String("--consecutive-fail-count", "0");
  async execute() {
    const { accumulateMilestoneResult } = await import("../../commands/milestone-accumulate.ts");
    const fallbackIssueTitle = this.issueTitleB64 !== undefined
      ? Buffer.from(this.issueTitleB64, "base64").toString("utf8")
      : (this.issueTitle ?? "");
    const out = accumulateMilestoneResult({
      implResultsRaw: this.implResultsRaw,
      completedRaw: this.completedRaw,
      processedRaw: this.processedRaw,
      itemRaw: this.itemRaw,
      fallbackIssueNumber: this.fallbackIssueNumber,
      fallbackIssueTitle,
      consecutiveFailCountRaw: this.consecutiveFailCount,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
export class GoalPostmortemCommand extends Command {
  static paths = [["goal", "postmortem"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  reviewNotes = Option.String("--review-notes", { required: false });
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  worktreeDir = Option.String("--worktree-dir", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");
  async execute() {
    const { analyzeGiveUp } = await import("../../commands/milestone-postmortem.ts");
    const reviewNotes = this.reviewNotesB64 !== undefined
      ? Buffer.from(this.reviewNotesB64, "base64").toString("utf8")
      : (this.reviewNotes ?? "");
    const out = analyzeGiveUp({
      repo: this.repo,
      issueNumber: this.issue,
      branch: this.branch,
      reviewNotes,
      worktreeDir: this.worktreeDir,
      reviewEvidencePath: this.reviewEvidencePath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal build-issue-context --
export class GoalBuildIssueContextCommand extends Command {
  static paths = [["goal", "build-issue-context"]];
  goalNumber = Option.String("--goal-number", "");
  issueNumber = Option.String("--issue-number", "");
  async execute() {
    const { buildGoalIssueContext } = await import("../../commands/goal-build-item.ts");
    const out = buildGoalIssueContext({ goalNumber: this.goalNumber, issueNumber: this.issueNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal add-sub-issue --
export class GoalAddSubIssueCommand extends Command {
  static paths = [["goal", "add-sub-issue"]];
  repo = Option.String("--repo", "");
  parentNumber = Option.String("--parent", "");
  childNumber = Option.String("--child", "");
  async execute() {
    const { addSubIssue } = await import("../../commands/goal-sub-issues.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = addSubIssue({ repo, parentNumber: this.parentNumber, childNumber: this.childNumber });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}
// -- goal list-sub-issues --
export class GoalListSubIssuesCommand extends Command {
  static paths = [["goal", "list-sub-issues"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  async execute() {
    const { listGoalSubIssues } = await import("../../commands/goal-sub-issues.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = listGoalSubIssues({ repo, goalNumber: this.goalNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal list-executable --
export class GoalListExecutableCommand extends Command {
  static paths = [["goal", "list-executable"]];
  repo = Option.String("--repo", "");
  backoffSeconds = Option.String("--backoff-seconds", "0");
  repoRoot = Option.String("--repo-root", "");
  factoryId = Option.String("--factory-id", "");
  maxConcurrent = Option.String("--max-concurrent", "3");
  runsDir = Option.String("--runs-dir", "");
  async execute() {
    const { listExecutableGoals } = await import("../../commands/goal-list-executable.ts");
    const { resolveRepoScopedFactoryContext, resolveFactoryRunsDir } = await import("../factory-command-helpers.ts");
    const scoped = resolveRepoScopedFactoryContext({
      repo: this.repo,
      repoRoot: this.repoRoot,
      factoryId: this.factoryId,
    });
    const repo = scoped.targetRepo || await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const resolvedRunsDir = this.runsDir || await resolveFactoryRunsDir("", scoped.factoryId);
    const out = listExecutableGoals({
      repo,
      repoRoot: scoped.repoRoot || undefined,
      factoryId: scoped.factoryId || undefined,
      runsDir: resolvedRunsDir || undefined,
      maxConcurrent: this.maxConcurrent,
      backoffSeconds: this.backoffSeconds,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal check-sub-issues-closed --
export class GoalCheckSubIssuesClosedCommand extends Command {
  static paths = [["goal", "check-sub-issues-closed"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  async execute() {
    const { checkAllSubIssuesClosed } = await import("../../commands/goal-sub-issues.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const out = checkAllSubIssuesClosed({ repo, goalNumber: this.goalNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal build-execution-plan --
export class GoalBuildExecutionPlanCommand extends Command {
  static paths = [["goal", "build-execution-plan"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  completedRaw = Option.String("--completed", "[]");
  directExecution = Option.String("--direct-execution", "");
  directExecutionPath = Option.String("--direct-execution-path", "");
  goalRoutingState = Option.String("--goal-routing-state", "{}");
  goalExecutionPathVersion = Option.String("--goal-execution-path-version", "");
  goalExecutionPathPacketId = Option.String("--goal-execution-path-packet-id", "");
  async execute() {
    const { buildExecutionPlanFromGoal } = await import("../../commands/goal-execution-plan.ts");
    const { parseJson } = await import("../../lib/cli-helpers.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    const completed = parseJson(String(this.completedRaw || "[]"), []);
    const out = buildExecutionPlanFromGoal({
      repo,
      goalNumber: this.goalNumber,
      completedIssues: completed,
      directExecution: this.directExecution,
      directExecutionPath: this.directExecutionPath,
      goalRoutingState: this.goalRoutingState,
      goalExecutionPathVersion: this.goalExecutionPathVersion,
      goalExecutionPathPacketId: this.goalExecutionPathPacketId,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal pick-plan-issue --
export class GoalPickPlanIssueCommand extends Command {
  static paths = [["goal", "pick-plan-issue"]];
  executionPlanRaw = Option.String("--execution-plan", "[]");
  planIndex = Option.String("--plan-index", "0");
  async execute() {
    const { pickPlanIssue } = await import("../../commands/goal-execution-plan.ts");
    const out = pickPlanIssue({
      executionPlanRaw: this.executionPlanRaw,
      planIndex: Number(this.planIndex),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}
// -- goal advance-plan-index --
export class GoalAdvancePlanIndexCommand extends Command {
  static paths = [["goal", "advance-plan-index"]];
  planIndex = Option.String("--plan-index", "0");
  async execute() {
    const idx = Number.parseInt(String(this.planIndex ?? "0"), 10) || 0;
    this.context.stdout.write(String(idx + 1));
    return 0;
  }
}
export class GoalValidateIntakeCommand extends Command {
  static paths = [["goal", "validate-intake"]];
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  async execute() {
    const { validateGoalIntakeEligibility } = await import("../../commands/goal-validate-intake.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(validateGoalIntakeEligibility({ goalIssueJson: payload || "" }));
    return 0;
  }
}
export const goalCommands = [
  GoalFinalStateReviewCommand,
  GoalFetchGoalIssueCommand,
  GoalAutoReadyArtifactsCommand,
  GoalSanitizeDuplicatesCommand,
  GoalSweepCompletedCommand,
  GoalListReadyCommand,
  GoalDecomposeBackpressureCommand,
  GoalApplyDecisionsCommand,
  GoalValidateDecisionsCommand,
  GoalFilterKeptCommand,
  GoalLimitKeptCommand,
  GoalCheckDecomposedCommand,
  GoalPersistDecompositionPacketCommand,
  ...goalHardPlanningCommands,
  ...goalHardPlanCommands,
  GoalAdmissionCheckCommand,
  GoalAdmissionFailCommand,
  GoalDuplicateDecomposeGuardCommand,
  GoalAdmissionResetCommand,
  GoalHardStateInspectCommand,
  GoalExecutionPathClassifyCommand,
  ...goalRationaleCommands,
  GoalExecutionPathInspectCommand,
  GoalExecutionPathEnsureCommand,
  GoalExecutionPathResolveCommand,
  GoalComputeCloseConditionCommand,
  GoalCountDecomposeAttemptsCommand,
  GoalExhaustDecomposeRetriesCommand,
  GoalMarkDispatchedCommand,
  GoalPostDecomposeAttemptCommand,
  GoalPostRetryCommentCommand,
  GoalBuildFallbackFeaturesCommand,
  GoalEmitFallbackDefectCommand,
  GoalParseExternalBugReportCommand,
  GoalValidateIntakeCommand,
  GoalSeedStateCommand,
  GoalNextIssueCommand,
  GoalBuildItemCommand,
  GoalEmptyBranchContextCommand,
  GoalAccumulateCommand,
  GoalPostmortemCommand,
  GoalBuildIssueContextCommand,
  GoalAddSubIssueCommand,
  GoalListSubIssuesCommand,
  GoalCheckSubIssuesClosedCommand,
  GoalListExecutableCommand,
  GoalBuildExecutionPlanCommand,
  GoalPickPlanIssueCommand,
  GoalAdvancePlanIndexCommand,
];
