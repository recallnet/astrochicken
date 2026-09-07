import { Command, Option } from "clipanion";

export class JudgeBuildEvidenceContractCommand extends Command {
  static paths = [["judge", "build-evidence-contract"]];
  judgeKind = Option.String("--judge-kind", "");
  judgeContext = Option.String("--judge-context", { required: false });
  judgeContextB64 = Option.String("--judge-context-b64", { required: false });
  worktreeDir = Option.String("--worktree-dir", "");
  requireQaMarkers = Option.String("--require-qa-markers", "");
  subjectId = Option.String("--subject-id", { required: false });
  subjectIdB64 = Option.String("--subject-id-b64", { required: false });

  async execute() {
    const { buildAndPersistJudgeEvidenceContract } = await import("../../commands/judge-evidence-contract.ts");
    const { decodeBase64Utf8, readStdin } = await import("../helpers.ts");
    const stdin = await readStdin();
    const judgeContextRaw = this.judgeContextB64 !== undefined
      ? decodeBase64Utf8(this.judgeContextB64)
      : (this.judgeContext ?? stdin ?? "{}");
    const subjectId = this.subjectIdB64 !== undefined ? decodeBase64Utf8(this.subjectIdB64) : (this.subjectId ?? "");
    const out = buildAndPersistJudgeEvidenceContract({
      judgeKind: this.judgeKind,
      judgeContextRaw,
      worktreeDir: this.worktreeDir,
      requireQaMarkers: this.requireQaMarkers,
      subjectId,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class JudgeBuildContextContractCommand extends Command {
  static paths = [["judge", "build-context-contract"]];
  judgeKind = Option.String("--judge-kind", "");
  judgeContext = Option.String("--judge-context", { required: false });
  judgeContextB64 = Option.String("--judge-context-b64", { required: false });
  scenarioSelector = Option.String("--scenario-selector", "");
  scenarioContext = Option.String("--scenario-context", "");
  scope = Option.String("--scope", "");
  scenarioRegistryRoot = Option.String("--scenario-registry-root", "");
  objectiveId = Option.String("--objective-id", "");
  judgeRubric = Option.String("--judge-rubric", "");
  judgeEvidencePath = Option.String("--judge-evidence-path", "");
  judgeEvidenceSha256 = Option.String("--judge-evidence-sha256", "");
  subjectId = Option.String("--subject-id", { required: false });
  subjectIdB64 = Option.String("--subject-id-b64", { required: false });
  issueNumber = Option.String("--issue-number", "");
  goalNumber = Option.String("--goal-number", "");
  milestoneTitle = Option.String("--milestone-title", "");
  ghRepo = Option.String("--gh-repo", "");
  judgeContextScopeIdentity = Option.String("--judge-context-scope-identity", "");
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { buildAndPersistJudgeContextContract } = await import("../../commands/judge-context-contract.ts");
    const { decodeBase64Utf8, readStdin } = await import("../helpers.ts");
    const stdin = await readStdin();
    const judgeContextRaw = this.judgeContextB64 !== undefined
      ? decodeBase64Utf8(this.judgeContextB64)
      : (this.judgeContext ?? stdin ?? "{}");
    const subjectId = this.subjectIdB64 !== undefined ? decodeBase64Utf8(this.subjectIdB64) : (this.subjectId ?? "");
    const out = buildAndPersistJudgeContextContract({
      judgeKind: this.judgeKind,
      judgeContextRaw,
      scenarioSelector: this.scenarioSelector,
      scenarioContext: this.scenarioContext,
      scope: this.scope,
      scenarioRegistryRoot: this.scenarioRegistryRoot,
      objectiveId: this.objectiveId,
      judgeRubric: this.judgeRubric,
      judgeEvidencePath: this.judgeEvidencePath,
      judgeEvidenceSha256: this.judgeEvidenceSha256,
      subjectId,
      issueNumber: this.issueNumber,
      goalNumber: this.goalNumber,
      milestoneTitle: this.milestoneTitle,
      ghRepo: this.ghRepo,
      judgeContextScopeIdentity: this.judgeContextScopeIdentity,
      worktreeDir: this.worktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class JudgeValidateContextContractCommand extends Command {
  static paths = [["judge", "validate-context-contract"]];
  judgeContextPath = Option.String("--judge-context-path", "");
  judgeContextSha256 = Option.String("--judge-context-sha256", "");
  judgeContextValid = Option.String("--judge-context-valid", "");
  judgeContextError = Option.String("--judge-context-error", "");
  judgeKind = Option.String("--judge-kind", "");
  judgeContext = Option.String("--judge-context", { required: false });
  judgeContextB64 = Option.String("--judge-context-b64", { required: false });
  scenarioSelector = Option.String("--scenario-selector", "");
  scenarioContext = Option.String("--scenario-context", "");
  scope = Option.String("--scope", "");
  scenarioRegistryRoot = Option.String("--scenario-registry-root", "");
  objectiveId = Option.String("--objective-id", "");
  judgeRubric = Option.String("--judge-rubric", "");
  judgeContextScopeIdentity = Option.String("--judge-context-scope-identity", "");
  judgeEvidencePath = Option.String("--judge-evidence-path", "");
  judgeEvidenceSha256 = Option.String("--judge-evidence-sha256", "");

  async execute() {
    const { validateJudgeContextCompleteness } = await import("../../commands/judge-context-contract.ts");
    const { decodeBase64Utf8, readStdin } = await import("../helpers.ts");
    const stdin = await readStdin();
    const judgeContextRaw = this.judgeContextB64 !== undefined
      ? decodeBase64Utf8(this.judgeContextB64)
      : (this.judgeContext ?? stdin ?? "");
    const out = validateJudgeContextCompleteness({
      judgeContextPath: this.judgeContextPath,
      judgeContextSha256: this.judgeContextSha256,
      judgeContextValid: this.judgeContextValid,
      judgeContextError: this.judgeContextError,
      judgeKind: this.judgeKind,
      judgeContextRaw,
      scenarioSelector: this.scenarioSelector,
      scenarioContext: this.scenarioContext,
      scope: this.scope,
      scenarioRegistryRoot: this.scenarioRegistryRoot,
      objectiveId: this.objectiveId,
      judgeRubric: this.judgeRubric,
      judgeContextScopeIdentity: this.judgeContextScopeIdentity,
      judgeEvidencePath: this.judgeEvidencePath,
      judgeEvidenceSha256: this.judgeEvidenceSha256,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class JudgeValidateEvidenceContractCommand extends Command {
  static paths = [["judge", "validate-evidence-contract"]];
  judgeKind = Option.String("--judge-kind", "");
  judgeContext = Option.String("--judge-context", { required: false });
  judgeContextB64 = Option.String("--judge-context-b64", { required: false });
  judgeEvidencePath = Option.String("--judge-evidence-path", "");
  judgeEvidenceSha256 = Option.String("--judge-evidence-sha256", "");
  judgeEvidenceValid = Option.String("--judge-evidence-valid", "");
  judgeEvidenceError = Option.String("--judge-evidence-error", "");
  requireQaMarkers = Option.String("--require-qa-markers", "");

  async execute() {
    const { validateJudgeEvidenceCompleteness } = await import("../../commands/judge-evidence-contract.ts");
    const { decodeBase64Utf8, readStdin } = await import("../helpers.ts");
    const stdin = await readStdin();
    const judgeContextRaw = this.judgeContextB64 !== undefined
      ? decodeBase64Utf8(this.judgeContextB64)
      : (this.judgeContext ?? stdin ?? "");
    const out = validateJudgeEvidenceCompleteness({
      judgeKind: this.judgeKind,
      judgeContextRaw,
      judgeEvidencePath: this.judgeEvidencePath,
      judgeEvidenceSha256: this.judgeEvidenceSha256,
      judgeEvidenceValid: this.judgeEvidenceValid,
      judgeEvidenceError: this.judgeEvidenceError,
      requireQaMarkers: this.requireQaMarkers,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class JudgeBuildRecoveryPacketCommand extends Command {
  static paths = [["judge", "build-recovery-packet"]];
  repo = Option.String("--repo", "");
  packetType = Option.String("--packet-type", "");
  judgeKind = Option.String("--judge-kind", "");
  goalNumber = Option.String("--goal-number", "");
  milestoneTitle = Option.String("--milestone-title", "");
  readyIssueNumber = Option.String("--ready-issue-number", "");
  gateCode = Option.String("--gate-code", "");
  routeCode = Option.String("--route-code", "");
  errorText = Option.String("--error-text", "");
  judgeContextPath = Option.String("--judge-context-path", "");
  judgeEvidencePath = Option.String("--judge-evidence-path", "");
  scenarioRegistryRoot = Option.String("--scenario-registry-root", "");
  judgeContextScopeIdentity = Option.String("--judge-context-scope-identity", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  factoryId = Option.String("--factory-id", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");
  nodeId = Option.String("--node-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");

  async execute() {
    const { buildJudgeRecoveryPacket } = await import("../../commands/judge-recovery-packet.ts");
    const out = buildJudgeRecoveryPacket({
      repo: this.repo,
      packetType: this.packetType,
      judgeKind: this.judgeKind,
      goalNumber: this.goalNumber,
      milestoneTitle: this.milestoneTitle,
      readyIssueNumber: this.readyIssueNumber,
      gateCode: this.gateCode,
      routeCode: this.routeCode,
      errorText: this.errorText,
      judgeContextPath: this.judgeContextPath,
      judgeEvidencePath: this.judgeEvidencePath,
      scenarioRegistryRoot: this.scenarioRegistryRoot,
      judgeContextScopeIdentity: this.judgeContextScopeIdentity,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
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

export const judgeCommands = [
  JudgeBuildEvidenceContractCommand,
  JudgeBuildContextContractCommand,
  JudgeValidateContextContractCommand,
  JudgeValidateEvidenceContractCommand,
  JudgeBuildRecoveryPacketCommand,
];
