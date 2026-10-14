import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const goalCmd = readFileSync("packages/factory-ops/src/cli/commands/goal.ts", "utf8");
const goalHardPlanCmd = readFileSync("packages/factory-ops/src/cli/commands/goal-hard-plan.ts", "utf8");
const supervisorCmd = readFileSync("packages/factory-ops/src/cli/commands/supervisor.ts", "utf8");
const indexSrc = readFileSync("packages/factory-ops/src/cli/index.ts", "utf8");
const mergeCmd = readFileSync("packages/factory-ops/src/cli/commands/merge.ts", "utf8");
const insightCmd = readFileSync("packages/factory-ops/src/cli/commands/insight.ts", "utf8");
const skillCmd = readFileSync("packages/factory-ops/src/cli/commands/skill.ts", "utf8");
const factoryCmd = readFileSync("packages/factory-ops/src/cli/commands/factory-host-cmds.ts", "utf8");
const factoryControlCmd = readFileSync("packages/factory-ops/src/cli/commands/factory-control-cmds.ts", "utf8");
const artifactCmd = readFileSync("packages/factory-ops/src/cli/commands/artifact.ts", "utf8");
const researchCmd = readFileSync("packages/factory-ops/src/cli/commands/research.ts", "utf8");

test("cli defers goal-build-fallback-features import to command execution", () => {
  assert.match(goalCmd, /GoalBuildFallbackFeaturesCommand/);
  assert.match(goalCmd, /await import\("\.\.\/\.\.\/commands\/goal-build-fallback-features\.ts"\)/);
  assert.match(goalCmd, /static paths = \[\["goal", "build-fallback-features"\]\]/);
});

test("cli defers goal hard-plan imports to command execution", () => {
  assert.match(goalHardPlanCmd, /GoalHardPlanAttachCommand/);
  assert.match(goalHardPlanCmd, /GoalHardPlanInspectCommand/);
  assert.match(goalHardPlanCmd, /static paths = \[\["goal", "hard-plan", "attach"\]\]/);
  assert.match(goalHardPlanCmd, /static paths = \[\["goal", "hard-plan", "inspect"\]\]/);
  assert.match(goalHardPlanCmd, /await import\("\.\.\/\.\.\/commands\/goal-hard-plan-packet\.ts"\)/);
  assert.match(goalCmd, /\.\.\.goalHardPlanCommands/);
  assert.match(goalCmd, /GoalHardStateInspectCommand/);
  assert.match(goalCmd, /static paths = \[\["goal", "hard-state"\]\]/);
  assert.match(goalCmd, /await import\("\.\.\/\.\.\/commands\/goal-hard-state\.ts"\)/);
});

test("cli wires supervisor validate-main-branch command", () => {
  assert.match(supervisorCmd, /SupervisorValidateMainBranchCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "validate-main-branch"\]\]/);
  assert.match(supervisorCmd, /validateMainBranchHealth/);
});

test("cli wires supervisor external-factory-lifecycle command lazily", () => {
  assert.match(supervisorCmd, /SupervisorExternalFactoryLifecycleCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "external-factory-lifecycle"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-external-factory-lifecycle\.ts"\)/);
});

test("cli wires managed supervisor shell commands lazily", () => {
  assert.match(supervisorCmd, /SupervisorManagedLoadContextCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-load-context"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-load-context\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedControlGateCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-control-gate"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-control-gate\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedActionItemGateCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-action-item-gate"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-action-item-gate\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedIntakeSelectorCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-intake-selector"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-intake-selector\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedHealthClassifierCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-health-classifier"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-health-classifier\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedFailureClassifierCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-failure-classifier"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-failure-classifier\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedEmitRunSummaryCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-emit-run-summary"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-emit-run-summary\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedPersistStateCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-persist-state"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-persist-state\.ts"\)/);

  assert.match(supervisorCmd, /SupervisorManagedDomainContractCommand/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "managed-domain-contract"\]\]/);
  assert.match(supervisorCmd, /await import\("\.\.\/\.\.\/commands\/supervisor-managed-domain-contract\.ts"\)/);

});

test("cli entrypoint uses normalizeArgv for DOT run --op compatibility", () => {
  const cliEntrypoint = readFileSync("packages/factory-ops/src/cli.ts", "utf8");
  assert.match(indexSrc, /export function normalizeArgv/,
    "normalizeArgv must be exported — DOT graphs use the `run --op` form");
  assert.match(cliEntrypoint, /normalizeArgv\(process\.argv\.slice\(2\)\)/,
    "cli.mjs must pass argv through normalizeArgv");
});

test("cli wires merge resolve-context/worktree rebase and push/verify routes", () => {
  assert.match(mergeCmd, /static paths = \[\["merge", "resolve-context"\]\]/);
  assert.match(mergeCmd, /resolveMergeContext/);
  assert.match(mergeCmd, /static paths = \[\["merge", "push-main"\]\]/);
  assert.match(mergeCmd, /pushMainBranch/);
  assert.match(mergeCmd, /static paths = \[\["merge", "verify-push-resolution"\]\]/);
  assert.match(mergeCmd, /verifyPushResolution/);
});

test("cli defers insight command imports to command execution", () => {
  assert.match(insightCmd, /InsightFailuresCommand/);
  assert.match(insightCmd, /static paths = \[\["insight", "failures"\]\]/);
  assert.match(insightCmd, /await import\("\.\.\/\.\.\/lib\/insight-projection\.ts"\)/);

  assert.match(insightCmd, /InsightRetriesCommand/);
  assert.match(insightCmd, /static paths = \[\["insight", "retries"\]\]/);

  assert.match(insightCmd, /InsightLatencyCommand/);
  assert.match(insightCmd, /static paths = \[\["insight", "latency"\]\]/);
});

test("cli defers skill scaffold/validate imports to command execution", () => {
  assert.match(skillCmd, /SkillScaffoldInterfaceCommand/);
  assert.match(skillCmd, /await import\("\.\.\/\.\.\/commands\/skill-interface-scaffold\.ts"\)/);
  assert.match(skillCmd, /static paths = \[\["skill", "scaffold-interface"\]\]/);

  assert.match(skillCmd, /SkillValidateInterfaceCommand/);
  assert.match(skillCmd, /static paths = \[\["skill", "validate-interface"\]\]/);
});

test("cli wires factory session-tail command lazily", () => {
  assert.match(factoryCmd, /FactorySessionTailCommand/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session-tail"\]\]/);
  assert.match(factoryCmd, /await import\("\.\.\/\.\.\/commands\/factory-session-tail\.ts"\)/);
});

test("cli wires factory session command lazily", () => {
  assert.match(factoryCmd, /FactorySessionNodeCommand/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session"\]\]/);
  assert.match(factoryCmd, /await import\("\.\.\/\.\.\/commands\/factory-session-node\.ts"\)/);
  assert.match(factoryCmd, /--node is required\. Use --node <node-id>/);
});

test("cli wires factory session-browser command lazily", () => {
  assert.match(factoryCmd, /FactorySessionBrowserCommand/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session-browser"\]\]/);
  assert.match(factoryCmd, /await import\("\.\.\/factory-session-browser-tui\.ts"\)/);
});

test("cli wires factory generate-instance-id command lazily", () => {
  assert.match(factoryControlCmd, /FactoryGenerateInstanceIdCommand/);
  assert.match(factoryControlCmd, /static paths = \[\["factory", "generate-instance-id"\]\]/);
  assert.match(factoryControlCmd, /await import\("\.\.\/\.\.\/commands\/factory-generate-instance-id\.ts"\)/);
});

test("cli wires artifact emit-disposition-feedback command lazily", () => {
  assert.match(artifactCmd, /ArtifactEmitDispositionFeedbackCommand/);
  assert.match(artifactCmd, /static paths = \[\["artifact", "emit-disposition-feedback"\]\]/);
  assert.match(artifactCmd, /await import\("\.\.\/\.\.\/commands\/artifact-feedback\.ts"\)/);
});

test("cli wires research approve/stage-label/approval-label/status commands lazily", () => {
  assert.match(researchCmd, /ResearchApproveStageCommand/);
  assert.match(researchCmd, /static paths = \[\["research", "approve-stage"\]\]/);
  assert.match(researchCmd, /await import\("\.\.\/\.\.\/commands\/research-approve-stage\.ts"\)/);

  assert.match(researchCmd, /ResearchSetStageLabelCommand/);
  assert.match(researchCmd, /static paths = \[\["research", "set-stage-label"\]\]/);
  assert.match(researchCmd, /await import\("\.\.\/\.\.\/commands\/research-stage-label\.ts"\)/);

  assert.match(researchCmd, /ResearchSetApprovalLabelCommand/);
  assert.match(researchCmd, /static paths = \[\["research", "set-approval-label"\]\]/);
  assert.match(researchCmd, /await import\("\.\.\/\.\.\/commands\/research-stage-label\.ts"\)/);

  assert.match(researchCmd, /ResearchStatusCommand/);
  assert.match(researchCmd, /static paths = \[\["research", "status"\]\]/);
  assert.match(researchCmd, /await import\("\.\.\/\.\.\/commands\/research-status\.ts"\)/);
});
