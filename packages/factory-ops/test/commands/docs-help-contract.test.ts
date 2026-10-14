import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

const waveIssueGraphPath = join(repoRoot, "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot");

const goalIssueCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/goal-issue.ts"), "utf8");
const goalRunCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/goal-run.ts"), "utf8");
const judgeCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/judge.ts"), "utf8");
const factoryCmd = [
  "factory-status-cmds.ts",
  "factory-host-cmds.ts",
  "factory-control-cmds.ts",
  "factory-lease-cmds.ts",
  "factory-release-cmds.ts",
  "factory-service-profile-cmds.ts",
  "factory-fleet-triage-cmds.ts",
  "factory-fleet-triage-queues.ts",
].map((f) => readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands", f), "utf8")).join("\n");
const factoryReviewMetricsCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/factory-dashboard.ts"), "utf8");
const factoryDashboardCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/factory-dashboard.ts"), "utf8");
const waveCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/wave.ts"), "utf8");
const labelsCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/labels.ts"), "utf8");
const scenarioCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/scenario.ts"), "utf8");
const commonCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/common.ts"), "utf8");
const brainstormCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/brainstorm.ts"), "utf8");
const goalCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/goal.ts"), "utf8");
const goalHardPlanCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/goal-hard-plan.ts"), "utf8");
const goalHardPlanningCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/goal-hard-planning-cli.ts"), "utf8");
const mergeCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/merge.ts"), "utf8");
const artifactCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/artifact.ts"), "utf8");
const skillCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/skill.ts"), "utf8");
const releaseCmd = [
  "release.ts",
  "release-context-cmds.ts",
  "release-delivery-cmds.ts",
  "release-policy-cmds.ts",
].map((f) => readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands", f), "utf8")).join("\n");
const triageCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/triage.ts"), "utf8");
const supervisorCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/supervisor.ts"), "utf8");
const insightCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/insight.ts"), "utf8");
const researchCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/research.ts"), "utf8");
const doctorCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/doctor.ts"), "utf8");
const llmCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/llm.ts"), "utf8");
const hostCmd = readFileSync(join(repoRoot, "packages/factory-ops/src/cli/commands/host.ts"), "utf8");
const cliUsage = readFileSync(join(repoRoot, "packages/factory-ops/src/lib/cli-usage.ts"), "utf8");
const opsCliEnv = {
  HOME: process.env.HOME,
  LANG: process.env.LANG || "en_US.UTF-8",
  PATH: process.env.PATH,
  PWD: repoRoot,
  TERM: process.env.TERM || "xterm",
  FACTORY_CONTEXT_REPO_PATH: repoRoot,
};

test("ops CLI usage documents goal-issue resolve-mode contract", () => {
  // goal-issue resolve-mode with --mode flag
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "resolve-mode"\]\]/);
  assert.match(goalIssueCmd, /--mode/);

  // goal-issue write-review-evidence with required flags
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "write-review-evidence"\]\]/);
  assert.match(goalIssueCmd, /--worktree-dir/);
  assert.match(goalIssueCmd, /--review-qa-command/);
  assert.match(goalIssueCmd, /--integration-command/);
  assert.match(goalIssueCmd, /--builder-notes-b64/);

  // goal-issue setup/commit helper commands
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "estimate-complexity"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "cleanup-legacy-worktree"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "setup-worktree"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "ensure-toolchain"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "commit-local"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "build-approved-result"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "build-failed-result"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "fallback-review-from-json"\]\]/);

  // goal-issue evaluate-done-elsewhere / validate-zero-delta / zero-delta-status
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "evaluate-done-elsewhere"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "validate-zero-delta"\]\]/);
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "zero-delta-status"\]\]/);
  assert.match(goalIssueCmd, /--review-evidence-path/);
  assert.match(goalIssueCmd, /--worktree-dir/);
  assert.match(goalIssueCmd, /--issue/);
  assert.match(cliUsage, /goal-issue zero-delta-status --issue <n> \[--worktree-dir <path>\] \[--review-evidence-path <path>\] \[--branch <name>\][\s\S]*deterministic error when zero-delta state or evidence is missing/);

  // goal-issue set-retry-decision
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "set-retry-decision"\]\]/);
  assert.match(goalIssueCmd, /--zero-delta/);
  assert.match(goalIssueCmd, /--issue-commits/);

  // goal-issue rerun-review-qa
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "rerun-review-qa"\]\]/);
  assert.match(goalIssueCmd, /--review-evidence-path/);

  // goal-issue build-review-context
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "build-review-context"\]\]/);

  // goal-issue validate-review-context
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "validate-review-context"\]\]/);
  assert.match(goalIssueCmd, /--review-context-path/);
  assert.match(goalIssueCmd, /--review-context-sha256/);

  // goal-issue resolve-review-route
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "verify-visual-refinement-evidence"\]\]/);
  assert.match(goalIssueCmd, /--scenario-root/);
  assert.match(goalIssueCmd, /--factory-root/);
  assert.match(cliUsage, /goal-issue verify-visual-refinement-evidence --repo <owner\/repo> --issue <n> --review-context-path <path> --review-evidence-path <path>/);

  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "resolve-review-route"\]\]/);
  assert.match(goalIssueCmd, /--review-verdict/);

  // goal-issue review-verdict-inspect
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "review-verdict-inspect"\]\]/);
  assert.match(goalIssueCmd, /--run-id/);
  assert.match(goalIssueCmd, /--runs-dir/);

  // goal-issue emit-review-verdict-telemetry
  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "emit-review-verdict-telemetry"\]\]/);
  assert.match(goalIssueCmd, /--factory-id/);
  assert.match(goalIssueCmd, /--review-reason-codes/);
  assert.match(goalIssueCmd, /--retry-attempt/);

  // judge commands
  assert.match(judgeCmd, /static paths = \[\["judge", "build-evidence-contract"\]\]/);
  assert.match(judgeCmd, /--judge-kind/);
  assert.match(judgeCmd, /--judge-context-b64/);

  assert.match(judgeCmd, /static paths = \[\["judge", "build-context-contract"\]\]/);
  assert.match(judgeCmd, /--judge-evidence-path/);
  assert.match(judgeCmd, /--judge-evidence-sha256/);
  assert.match(judgeCmd, /--scenario-selector/);

  assert.match(judgeCmd, /static paths = \[\["judge", "validate-context-contract"\]\]/);
  assert.match(judgeCmd, /--judge-context-path/);

  assert.match(judgeCmd, /static paths = \[\["judge", "validate-evidence-contract"\]\]/);
  assert.match(judgeCmd, /--judge-evidence-valid/);
});

test("ops CLI usage documents factory lease command set", () => {
  assert.match(factoryReviewMetricsCmd, /static paths = \[\["factory", "review-metrics"\]\]/);
  assert.match(factoryReviewMetricsCmd, /FactoryReviewMetricsCommand[\s\S]*--lookback-hours/);
  assert.match(factoryReviewMetricsCmd, /FactoryReviewMetricsCommand[\s\S]*--window/);
  assert.match(factoryReviewMetricsCmd, /FactoryReviewMetricsCommand[\s\S]*--json/);
  assert.match(cliUsage, /factory review-metrics \[--factory-id <id>\] \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--window 0\] \[--json\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "lease-acquire"\]\]/);
  assert.match(factoryCmd, /--tracking-issue/);
  assert.match(factoryCmd, /--factory-id/);
  assert.match(factoryCmd, /--lease-name/);

  assert.match(factoryCmd, /static paths = \[\["factory", "lease-release"\]\]/);

  assert.match(factoryCmd, /static paths = \[\["factory", "resolve-tracking-issue"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "status"\]\]/);
  assert.match(factoryDashboardCmd, /static paths = \[\["factory", "dashboard"\]\]/);
  assert.match(factoryDashboardCmd, /static paths = \[\["factory", "dashboard-tui"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session-browser"\]\]/);
  assert.match(factoryDashboardCmd, /--lookback-hours/);
  assert.match(factoryDashboardCmd, /--refresh-ms/);
  assert.match(factoryCmd, /static paths = \[\["factory", "tick-status"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "triage-queues"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "triage-blast-radius"\]\]/);
  assert.match(factoryCmd, /FactoryTriageBlastRadiusCommand[\s\S]*--fingerprint/);
  assert.match(factoryCmd, /FactoryTriageQueuesCommand[\s\S]*--format/);
  assert.match(factoryCmd, /FactoryStatusCommand[\s\S]*--factory-id/);
  assert.match(factoryCmd, /FactoryTickStatusCommand[\s\S]*--factory-id/);
  assert.match(factoryCmd, /FactoryRecoverySweepCommand[\s\S]*--factory-id/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session-tail"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "session"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "audit-records"\]\]/);
  assert.match(factoryCmd, /FactoryAuditRecordsCommand[\s\S]*--instance-id/);
  assert.match(factoryCmd, /FactoryAuditRecordsCommand[\s\S]*--since/);
  assert.match(factoryCmd, /FactoryAuditRecordsCommand[\s\S]*--action/);
  assert.match(factoryCmd, /FactoryAuditRecordsCommand[\s\S]*--json/);
  assert.match(factoryCmd, /static paths = \[\["factory", "provisioning-drift"\]\]/);
  assert.match(factoryCmd, /FactoryProvisioningDriftCommand[\s\S]*--instance-id/);
  assert.match(factoryCmd, /FactoryProvisioningDriftCommand[\s\S]*--all/);
  assert.match(factoryCmd, /FactoryProvisioningDriftCommand[\s\S]*--json/);
  assert.match(factoryCmd, /static paths = \[\["factory", "target-repo", "bootstrap"\]\]/);
  assert.match(factoryCmd, /FactoryTargetRepoBootstrapCommand[\s\S]*--target-repo/);
  assert.match(factoryCmd, /FactorySessionNodeCommand[\s\S]*--node/);
  assert.match(factoryCmd, /--run-id/);
  assert.match(factoryCmd, /--follow/);
  assert.match(factoryCmd, /static paths = \[\["factory", "service-profile", "inspect"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "service-profile", "update"\]\]/);
  assert.match(factoryCmd, /FactoryServiceProfileUpdateCommand[\s\S]*--profile/);
  assert.match(factoryCmd, /FactoryServiceProfileInspectCommand[\s\S]*--registry-path/);
  assert.match(cliUsage, /factory service-profile inspect <instance-id> \[--registry-path factory-registry\.json\]/);
  assert.match(cliUsage, /factory service-profile update <instance-id> --profile <json-file> \[--registry-path factory-registry\.json\]/);
  assert.match(cliUsage, /validates against shared registry schema and fails closed on unknown\/invalid service-profile fields/);
  assert.match(cliUsage, /factory session \[--runs-dir \.hatch\/runs\] \[--run-id <id>\] --node <node-id>/);
  assert.match(cliUsage, /factory audit-records \[--instance-id <id>\] \[--since <iso8601>\] \[--to <iso8601>\] \[--action issue_create\|issue_close\|issue_label\|comment_create\] \[--host-id <id>\] \[--host-base-dir <path>\] \[--log-path <path>\] \[--json\]/);
  assert.match(cliUsage, /reads append-only audit\.v1 records from ~\/\.hatch-hosts\/<host-id>\/audit\/audit\.v1\.log/);
  assert.match(cliUsage, /factory provisioning-drift \(--instance-id <id> \| --all\) \[--registry-path factory-registry\.json\] \[--repo-root <path>\] \[--target-repo-path <path>\] \[--target-repo-map-json <path>\] \[--labels-json-path <path>\] \[--instance-path \.hatch\/instance\.json\] \[--json\]/);
  assert.match(cliUsage, /factory target-repo bootstrap --target-repo <abs\/path\/to\/target-repo> \[--instance-path \.hatch\/instance\.json\] \[--dry-run\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "control-state"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "pause"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "quarantine"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "retry"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "unblock"\]\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "resume"\]\]/);
  assert.match(factoryCmd, /--retry-target/);
  assert.match(cliUsage, /factory control-state --factory-id <id>/);
  assert.match(cliUsage, /factory dashboard \[--factory-id <id>\] \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--json\]/);
  assert.match(cliUsage, /factory triage-queues \[--factory-id <id>\] \[--registry-path factory-registry\.json\] \[--mirror-dir <path>\] \[--host-base-dir <path>\] \[--event-limit 200\] \[--json \| --format human\|json\]/);
  assert.match(cliUsage, /factory fleet-triage-queues \[--factory-id <id>\] \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--json \| --format human\|json\]/);
  assert.match(factoryCmd, /static paths = \[\["factory", "fleet-triage-queues"\]\]/);
  assert.match(factoryCmd, /FactoryFleetTriageQueuesCommand[\s\S]*--lookback-hours/);
  assert.match(cliUsage, /factory triage-blast-radius --fingerprint <id> \[--factory-id <id>\] \[--registry-path factory-registry\.json\] \[--mirror-dir <path>\] \[--host-base-dir <path>\] \[--event-limit 200\] \[--json \| --format human\|json\]/);
  assert.match(cliUsage, /invalid\/missing fingerprint exits non-zero with structured error payload/);
  assert.match(cliUsage, /factory dashboard-tui \[--factory-id <id>\] \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--refresh-ms 2000\]/);
  assert.match(cliUsage, /factory session-browser \[--factory-id <id>\] \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--refresh-ms 2000\]/);
  assert.match(cliUsage, /factory pause --factory-id <id> --reason <txt>/);
  assert.match(factoryCmd, /static paths = \[\["factory", "resume-gate"\]\]/);
  assert.match(factoryCmd, /--rollout-channel/);
  assert.match(factoryCmd, /--policy-path/);
  assert.match(factoryCmd, /--policy-json/);
  assert.match(factoryCmd, /--manifest-path/);
  assert.match(factoryCmd, /--manifest-ref/);
  assert.match(factoryCmd, /--manifest-fetch-cmd/);
  assert.match(factoryCmd, /--self-update-cmd/);
  assert.match(factoryCmd, /static paths = \[\["factory", "release-targeting-status"\]\]/);
  assert.match(factoryCmd, /FactoryReleaseTargetingStatusCommand[\s\S]*--registry-path/);
  assert.match(factoryCmd, /FactoryReleaseTargetingStatusCommand[\s\S]*--manifest-fetch-cmd/);
  assert.match(factoryCmd, /static paths = \[\["factory", "upgrade-posture", "inspect"\]\]/);
  assert.match(factoryCmd, /FactoryUpgradePostureInspectCommand[\s\S]*--policy-path/);
  assert.match(factoryCmd, /static paths = \[\["factory", "upgrade-posture", "cohort"\]\]/);
  assert.match(factoryCmd, /FactoryUpgradePostureCohortCommand[\s\S]*--channel/);
  assert.match(factoryCmd, /FactoryUpgradePostureCohortCommand[\s\S]*--pin-version/);
  assert.match(factoryCmd, /FactoryUpgradePostureCohortCommand[\s\S]*--audit-log-path/);
  assert.match(factoryCmd, /FactoryUpgradePostureCohortCommand[\s\S]*--dry-run/);
  assert.match(factoryCmd, /static paths = \[\["factory", "publish-control-plane-manifest"\]\]/);
  assert.match(factoryCmd, /FactoryPublishControlPlaneManifestCommand[\s\S]*--manifest-path/);
  assert.match(factoryCmd, /FactoryPublishControlPlaneManifestCommand[\s\S]*--repo-root/);
  assert.match(factoryCmd, /static paths = \[\["factory", "release-rollout-controller"\]\]/);
  assert.match(factoryCmd, /--candidate-manifest-path/);
  assert.match(factoryCmd, /--canary-manifest-path/);
  assert.match(factoryCmd, /--general-manifest-path/);
  assert.match(factoryCmd, /--canary-max-factories/);
  assert.match(factoryCmd, /--health-policy-json/);
  assert.match(cliUsage, /factory resume-gate[\s\S]*--rollout-channel stable\|canary\|pinned/);
  assert.match(cliUsage, /factory release-targeting-status[\s\S]*--registry-path factory-registry\.json/);
  assert.match(cliUsage, /factory upgrade-posture inspect <instance-id>/);
  assert.match(cliUsage, /factory upgrade-posture cohort <all\|instance:<id>\|kind:<id>\|repo:<owner\/repo>> --channel stable\|canary\|pinned/);
  assert.match(cliUsage, /fail-closed on missing policy targets or compatibility conflicts/);
  assert.match(cliUsage, /factory publish-control-plane-manifest[\s\S]*--manifest-path/);
  assert.match(cliUsage, /factory release-rollout-controller[\s\S]*--candidate-manifest-path/);
});

test("factory CLI help output advertises publish-control-plane-manifest recovery command", () => {
  const run = spawnOpsCli([
      "factory",
      "--help"
    ], {
      env: opsCliEnv
    });
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.match(output, /factory publish-control-plane-manifest/);
  assert.match(output, /factory dashboard/);
  assert.match(output, /factory dashboard-tui/);
  assert.match(output, /factory session-browser/);
});

test("ops CLI usage documents doctor canonical recovery commands", () => {
  assert.match(doctorCmd, /static paths = \[\["doctor", "canonical-checkout"\]\]/);
  assert.match(doctorCmd, /static paths = \[\["doctor", "repair-canonical-checkout"\]\]/);
  assert.match(doctorCmd, /static paths = \[\["doctor", "relink-cli"\]\]/);
  assert.match(cliUsage, /doctor canonical-checkout/);
  assert.match(cliUsage, /doctor repair-canonical-checkout/);
  assert.match(cliUsage, /doctor relink-cli/);
});

test("ops CLI usage documents LLM route inspection commands", () => {
  assert.match(llmCmd, /static paths = \[\["llm", "route", "list"\]\]/);
  assert.match(llmCmd, /static paths = \[\["llm", "route", "inspect"\]\]/);
  assert.match(llmCmd, /static paths = \[\["llm", "route", "diff"\]\]/);
  assert.match(llmCmd, /--path-id/);
  assert.match(llmCmd, /--inventory-path/);
  assert.match(llmCmd, /--baseline-inventory-path/);
  assert.match(cliUsage, /llm route list \[--repo-root \.\] \[--inventory-path <path>\] \[--json\]/);
  assert.match(cliUsage, /llm route inspect --path-id <id> \[--repo-root \.\] \[--inventory-path <path>\] \[--json\]/);
  assert.match(cliUsage, /llm route diff \[--path-id <id>\] \[--repo-root \.\] \[--inventory-path <path>\] \[--baseline-inventory-path <path>\] \[--json\]/);
});

test("ops CLI usage documents host runtime intake and runtime-release commands", () => {
  assert.match(hostCmd, /static paths = \[\["host", "install-runtime"\]\]/);
  assert.match(hostCmd, /--runtime-public-key-path/);
  assert.match(hostCmd, /--runtime-signature/);
  assert.match(hostCmd, /--runtime-signature-key-id/);
  assert.match(hostCmd, /--runtime-release-manifest-path/);
  assert.match(hostCmd, /--runtime-signed-payload-path/);
  assert.match(cliUsage, /host install-runtime[\s\S]*runtime-public-key-path/);
  assert.match(cliUsage, /fails with host_runtime_signature_missing\/host_runtime_signature_invalid/);

  assert.match(hostCmd, /static paths = \[\["host", "runtime-intake-certify"\]\]/);
  assert.match(hostCmd, /--issue-number/);
  assert.match(hostCmd, /--instance-id/);
  assert.match(hostCmd, /--target-repo/);
  assert.match(hostCmd, /--workspace-mode/);
  assert.match(hostCmd, /--registry-path/);
  assert.match(hostCmd, /--registry-cwd/);
  assert.match(hostCmd, /--destinations-json/);
  assert.match(hostCmd, /--destinations-json-b64/);
  assert.match(cliUsage, /host runtime-intake-certify --repo <owner\/repo> --issue-number <n>/);
  assert.match(cliUsage, /verifies goal creation\/backlink\/source closure invariants/);

  assert.match(hostCmd, /static paths = \[\["host", "runtime-release", "build"\]\]/);
  assert.match(hostCmd, /static paths = \[\["host", "runtime-release", "publish"\]\]/);
  assert.match(hostCmd, /--version/);
  assert.match(hostCmd, /--channel/);
  assert.match(hostCmd, /--supported-kinds/);
  assert.match(hostCmd, /--supported-platforms/);
  assert.match(hostCmd, /--artifact-url/);
  assert.match(hostCmd, /--runtime-signature/);
  assert.match(hostCmd, /--runtime-signature-key-id/);
  assert.match(hostCmd, /--runtime-signature-algorithm/);
  assert.match(cliUsage, /host runtime-release build --version <id>\|\[--release-tag <tag>\]/);
  assert.match(cliUsage, /host runtime-release publish --repo <owner\/repo> --version <id>\|\[--release-tag <tag>\]/);
  assert.match(cliUsage, /publishes manifest asset via control-plane-release-asset primitive/);
});

test("ops CLI usage documents insight command set", () => {
  assert.match(insightCmd, /static paths = \[\["insight", "failures"\]\]/);
  assert.match(insightCmd, /static paths = \[\["insight", "retries"\]\]/);
  assert.match(insightCmd, /static paths = \[\["insight", "latency"\]\]/);
  assert.match(insightCmd, /--lookback-hours/);
  assert.match(insightCmd, /--top/);
  assert.match(insightCmd, /--graph/);
  assert.match(insightCmd, /--node/);
  assert.match(insightCmd, /--json/);
  assert.match(cliUsage, /insight failures \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--top 5\] \[--graph <graph>\] \[--node <node>\] \[--json\]/);
  assert.match(cliUsage, /insight retries \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--top 5\] \[--graph <graph>\] \[--node <node>\] \[--json\]/);
  assert.match(cliUsage, /insight latency \[--runs-dir \.hatch\/runs\] \[--lookback-hours 24\] \[--top 5\] \[--graph <graph>\] \[--node <node>\] \[--json\]/);
});

test("ops CLI usage documents issue-execution commandized goal helpers", () => {
  assert.match(waveCmd, /static paths = \[\["wave", "filter-ready-issues"\]\]/);
  assert.match(waveCmd, /--milestone-issues/);
  assert.match(waveCmd, /--milestone-issues-b64/);

  assert.match(goalRunCmd, /static paths = \[\["goal-run", "split-results"\]\]/);
  assert.match(goalRunCmd, /--fallback/);
  assert.match(goalRunCmd, /--fallback-b64/);
  assert.match(goalRunCmd, /static paths = \[\["goal-run", "handle-review-failures"\]\]/);
  assert.match(goalRunCmd, /static paths = \[\["goal-run", "check-merge-candidates"\]\]/);
  assert.match(goalRunCmd, /static paths = \[\["goal-run", "close-merged-issues"\]\]/);
  assert.match(goalRunCmd, /static paths = \[\["goal-run", "build-merge-results"\]\]/);
  assert.match(goalRunCmd, /static paths = \[\["goal-run", "fallback-judge"\]\]/);

  assert.match(waveCmd, /static paths = \[\["wave", "check-control-plane-blocker"\]\]/);
  assert.match(waveCmd, /WaveCheckControlPlaneBlockerCommand[\s\S]*--issue/);

  assert.match(goalIssueCmd, /static paths = \[\["goal-issue", "extract"\]\]/);
  assert.match(goalIssueCmd, /--item-b64/);
});

test("ops CLI usage documents labels normalize issue-label transport", () => {
  assert.match(labelsCmd, /static paths = \[\["labels", "normalize"\]\]/);
  assert.match(labelsCmd, /--issue-labels/);
  assert.match(labelsCmd, /--issue-labels-b64/);
  assert.match(labelsCmd, /--allowed/);
  assert.match(labelsCmd, /--state/);
  assert.match(labelsCmd, /--dry-run/);
});

test("ops CLI usage documents triage rejected-upstream command", () => {
  assert.match(triageCmd, /static paths = \[\["triage", "apply-rejected-upstream"\]\]/);
  assert.match(triageCmd, /TriageApplyRejectedUpstreamCommand[\s\S]*--blocker-ref/);
});

test("ops CLI usage documents triage resolve-feature-dependencies command", () => {
  assert.match(triageCmd, /static paths = \[\["triage", "resolve-feature-dependencies"\]\]/);
  assert.match(triageCmd, /--feature-issue-map/);
  assert.match(triageCmd, /--repo/);
  assert.match(cliUsage, /triage resolve-feature-dependencies --repo/);
});

test("ops CLI usage documents scenario validation commands", () => {
  assert.match(scenarioCmd, /static paths = \[\["scenario", "validate-scope"\]\]/);
  assert.match(scenarioCmd, /static paths = \[\["scenario", "validate-payload"\]\]/);
  assert.match(scenarioCmd, /static paths = \[\["scenario", "save"\]\]/);
  assert.match(scenarioCmd, /static paths = \[\["scenario", "count-gate"\]\]/);
  assert.match(scenarioCmd, /static paths = \[\["scenario", "add"\]\]/);
  assert.match(scenarioCmd, /static paths = \[\["scenario", "curate"\]\]/);
  assert.match(scenarioCmd, /--runs-root/);
  assert.match(scenarioCmd, /--lookback-runs/);
  assert.match(scenarioCmd, /--stale-days/);
  assert.match(scenarioCmd, /--output-json/);
  assert.match(scenarioCmd, /--id/);
  assert.match(scenarioCmd, /--domain/);
  assert.match(scenarioCmd, /--priority/);
  assert.match(scenarioCmd, /--truth/);
  assert.match(cliUsage, /scenario validate-scope --payload/);
  assert.match(cliUsage, /scenario validate-payload --payload/);
  assert.match(cliUsage, /scenario save --payload/);
  assert.match(cliUsage, /scenario count-gate/);
  assert.match(cliUsage, /scenario add/);
  assert.match(cliUsage, /scenario curate/);
});

test("ops CLI usage documents common normalize-decision", () => {
  assert.match(commonCmd, /static paths = \[\["common", "normalize-decision"\]\]/);
  assert.match(commonCmd, /--value/);
  assert.match(commonCmd, /static paths = \[\["common", "resolve-capability-brainstorming-skills-path"\]\]/);
  assert.match(commonCmd, /static paths = \[\["common", "resolve-capability-brainstorming-skills"\]\]/);
  assert.match(commonCmd, /static paths = \[\["common", "validate-issue-spec-draft"\]\]/);
  assert.match(commonCmd, /--issue-spec/);
  assert.match(commonCmd, /--feature/);
  assert.match(commonCmd, /static paths = \[\["common", "resolve-intent-stack"\]\]/);
  assert.match(commonCmd, /static paths = \[\["common", "load-agent-guidance-context"\]\]/);
  assert.match(commonCmd, /--repo-root/);
  assert.match(commonCmd, /--agents-path/);
  assert.match(commonCmd, /--agent-learnings-path/);
  assert.match(commonCmd, /--agents-max-chars/);
  assert.match(commonCmd, /--learnings-max-chars/);
  assert.match(commonCmd, /--learnings-entry-count/);
  assert.match(commonCmd, /static paths = \[\["common", "resolve-goal-decomposition-timeout"\]\]/);
  assert.match(commonCmd, /--stage/);
  assert.match(commonCmd, /--factory-root/);
  assert.match(commonCmd, /--platform-intent-path/);
  assert.match(commonCmd, /--factory-intent-path/);
  assert.match(commonCmd, /--work-intent/);

  assert.match(commonCmd, /static paths = \[\["common", "count-json"\]\]/);
  assert.match(commonCmd, /--raw/);
  assert.match(commonCmd, /--raw-b64/);

  assert.match(commonCmd, /static paths = \[\["common", "count-feature-objects"\]\]/);

  assert.match(commonCmd, /static paths = \[\["common", "inspect-json"\]\]/);
  assert.match(commonCmd, /--file/);

  assert.match(commonCmd, /static paths = \[\["common", "inspect-json-pair"\]\]/);
  assert.match(commonCmd, /--primary/);
  assert.match(commonCmd, /--primary-b64/);
  assert.match(commonCmd, /--secondary/);
  assert.match(commonCmd, /--secondary-b64/);

  assert.match(commonCmd, /static paths = \[\["common", "fallback-json-pair"\]\]/);
  assert.match(cliUsage, /common resolve-goal-decomposition-timeout --stage <issue_draft\|issue_repair\|issue_judge\|issue_revise\|triage_plan\|triage_repair>/);
  assert.match(cliUsage, /common load-agent-guidance-context \[--repo-root \.\] \[--agents-path AGENTS\.md\] \[--agent-learnings-path AGENT-LEARNINGS\.md\] \[--agents-max-chars 12000\] \[--learnings-max-chars 12000\] \[--learnings-entry-count 5\]/);
});

test("ops CLI usage documents brainstorm command set", () => {
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "next-issue"\]\]/);
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "load-context"\]\]/);
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "intake-context"\]\]/);
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "bump-round"\]\]/);
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "create-goal"\]\]/);
  assert.match(brainstormCmd, /static paths = \[\["brainstorm", "close-issue"\]\]/);
  assert.match(brainstormCmd, /--next-cursor/);
  assert.match(brainstormCmd, /--next-cursor-b64/);
  assert.match(cliUsage, /brainstorm next-issue --repo <owner\/repo> \[--label brainstorm\] \[--factory-id <id>\] \[--root-dir \.\]/);
  assert.match(cliUsage, /brainstorm intake-context --repo <owner\/repo> --factory-id <id> \[--root-dir \.\] --intake-json '<json>'/);
  assert.match(cliUsage, /brainstorm create-goal --repo <owner\/repo> --brainstorm-issue-number <n> \[--destinations-json '\{\.\.\.\}' \| --destinations-json-b64 <base64>\] \[--seed-prompt <txt> \| --seed-prompt-b64 <base64>\] \[--final-round <n>\] \[--final-report <txt> \| --final-report-b64 <base64>\]/);
  assert.match(brainstormCmd, /--destinations-json/);
  assert.match(brainstormCmd, /--destinations-json-b64/);
  assert.match(cliUsage, /brainstorm close-issue --repo <owner\/repo> --brainstorm-issue-number <n> \[--factory-id <id>\] \[--root-dir \.\] \[--next-cursor '<json>' \| --next-cursor-b64 <base64>\]/);
});

test("ops CLI usage documents goal payload b64 transport", () => {
  assert.match(goalCmd, /static paths = \[\["goal", "validate-decisions"\]\]/);
  assert.match(goalCmd, /--goal-issues/);

  assert.match(goalCmd, /static paths = \[\["goal", "apply-decisions"\]\]/);
  assert.match(goalCmd, /--decisions/);
  assert.match(goalCmd, /--decisions-b64/);

  assert.match(goalCmd, /static paths = \[\["goal", "filter-kept"\]\]/);
  assert.match(goalCmd, /--issues/);
  assert.match(goalCmd, /--issues-b64/);

  assert.match(goalHardPlanCmd, /static paths = \[\["goal", "hard-plan", "attach"\]\]/);
  assert.match(goalHardPlanCmd, /--plan-id/);
  assert.match(goalHardPlanCmd, /--summary/);
  assert.match(goalHardPlanCmd, /--artifact-refs/);
  assert.match(goalHardPlanCmd, /--plan-metadata/);
  assert.match(goalHardPlanCmd, /--hold-for-human-review/);
  assert.match(goalHardPlanCmd, /static paths = \[\["goal", "hard-plan", "inspect"\]\]/);
  assert.match(goalCmd, /static paths = \[\["goal", "hard-state"\]\]/);
  assert.match(goalCmd, /--hard-plan-artifact-refs/);
  assert.match(goalCmd, /--hard-goal-state/);
  assert.match(goalHardPlanningCmd, /static paths = \[\["goal", "materialize-approved-plan"\]\]/);
  assert.match(goalHardPlanningCmd, /--factory-request-goal-graph/);
  assert.match(goalHardPlanningCmd, /--factory-request-goal-graph-b64/);
  assert.match(goalHardPlanningCmd, /--plan-packet/);
  assert.match(goalHardPlanningCmd, /--planning-artifact-path/);
  assert.match(goalHardPlanningCmd, /--goal-number/);
  assert.match(cliUsage, /goal hard-plan attach --repo <owner\/repo> --repo-root \. --goal <n> --plan-id <id> --summary <text\|path>/);
  assert.match(cliUsage, /goal materialize-approved-plan --repo-root \. --repo <owner\/repo> --goal-number <n> --plan-packet <id> --planning-artifact-path <path>/);
  assert.match(cliUsage, /goal-hard-plan:v1 goal=<n> packet=<id>/);
  assert.match(cliUsage, /goal-run:awaiting-review/);
  assert.match(cliUsage, /goal hard-plan inspect --repo-root \. --goal <n>/);
  assert.match(cliUsage, /goal hard-state --repo <owner\/repo> --repo-root \. --goal-issue-number <n>/);
  assert.match(cliUsage, /awaiting_post_plan_review/);
  assert.match(cliUsage, /approved_plan_resume/);

  assert.match(goalCmd, /static paths = \[\["goal", "build-fallback-features"\]\]/);
  assert.match(goalCmd, /--goal-issue/);
  assert.match(goalCmd, /--goal-issue-b64/);
  assert.match(goalCmd, /--goal-number/);

  assert.match(goalCmd, /static paths = \[\["goal", "emit-fallback-defect"\]\]/);
  assert.match(goalCmd, /--fallback-node/);
  assert.match(goalCmd, /--trigger-reason/);
  assert.match(goalCmd, /--decompose-parse-status/);
  assert.match(goalCmd, /--post-normalize-feature-count/);
  assert.match(goalCmd, /--issues-created/);
  assert.match(goalCmd, /--goal-issue-number/);
  assert.match(goalCmd, /--runs-dir/);
  assert.match(cliUsage, /goal emit-fallback-defect --fallback-node <node>/);
});

test("ops CLI usage documents supervisor state-snapshot runs-dir contract", () => {
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "state-snapshot"\]\]/);
  assert.match(supervisorCmd, /SupervisorStateSnapshotCommand[\s\S]*--runs-dir/);
  assert.match(supervisorCmd, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--runs-dir", ""\)/);
  assert.match(cliUsage, /supervisor state-snapshot --repo <owner\/repo>[\s\S]*\[--runs-dir <path>\]/);
  assert.match(supervisorCmd, /SupervisorActionItemGateCommand[\s\S]*Option\.String\("--runs-dir", ""\)/);
  assert.match(supervisorCmd, /static paths = \[\["supervisor", "external-factory-lifecycle"\]\]/);
  assert.match(supervisorCmd, /SupervisorExternalFactoryLifecycleCommand[\s\S]*--blocked-items/);
});

test("ops CLI usage documents merge run-integration transport contract", () => {
  assert.match(mergeCmd, /static paths = \[\["merge", "run-integration"\]\]/);
  assert.match(mergeCmd, /--integration-command/);
  assert.match(mergeCmd, /--integration-command-b64/);

  assert.match(mergeCmd, /static paths = \[\["merge", "report"\]\]/);
  assert.match(mergeCmd, /static paths = \[\["merge", "emit-resolution-failure"\]\]/);
  assert.match(mergeCmd, /static paths = \[\["merge", "run-count"\]\]/);
  assert.match(mergeCmd, /--notes/);
  assert.match(mergeCmd, /--notes-b64/);
  assert.match(mergeCmd, /--integration-result/);
  assert.match(mergeCmd, /--integration-result-b64/);
  assert.match(mergeCmd, /--merge-status/);
  assert.match(mergeCmd, /--merge-resolver/);
  assert.match(mergeCmd, /--path-taken/);
  assert.match(mergeCmd, /--recurrence-key/);
  assert.match(mergeCmd, /--lookback-hours/);
  assert.match(mergeCmd, /--factory-id/);
  assert.match(cliUsage, /merge emit-resolution-failure --recurrence-key <key>/);
  assert.match(cliUsage, /merge run-count --recurrence-key <key> \[--lookback-hours 24\] \[--factory-id <id>\]/);
  assert.match(cliUsage, /goal-run build-merge-results --merge-candidates '\[\.\.\.\]' --merge-status <merged\|already_merged\|failed> \[--merge-notes <txt>\] \[--merge-resolver <deterministic\|llm\|unknown>\] \[--path-taken <name>\]/);
});

test("ops CLI usage documents artifact release manifest contract", () => {
  assert.match(artifactCmd, /static paths = \[\["artifact", "release-manifest"\]\]/);
  assert.match(artifactCmd, /--control-plane-repo/);
  assert.match(artifactCmd, /--source-repos/);
  assert.match(artifactCmd, /--release-sha/);
  assert.match(artifactCmd, /--release-tag/);
  assert.match(artifactCmd, /--local-factory-release/);
  assert.match(artifactCmd, /--runs-dir/);
  assert.match(artifactCmd, /--releases-dir/);
  assert.match(artifactCmd, /--out-path/);
  assert.match(artifactCmd, /static paths = \[\["artifact", "emit-disposition-feedback"\]\]/);
  assert.match(artifactCmd, /ArtifactEmitDispositionFeedbackCommand[\s\S]*--manifest-path/);
  assert.match(artifactCmd, /ArtifactEmitDispositionFeedbackCommand[\s\S]*--dry-run/);
  assert.match(cliUsage, /artifact emit-disposition-feedback --control-plane-repo <owner\/repo> --manifest-path <path> \[--dry-run\]/);
});

test("ops CLI usage documents release post-to-slack contract", () => {
  assert.match(releaseCmd, /static paths = \[\["release", "comprehension-catchup"\]\]/);
  assert.match(releaseCmd, /ReleaseComprehensionCatchupCommand[\s\S]*--repo/);
  assert.match(releaseCmd, /ReleaseComprehensionCatchupCommand[\s\S]*--lookback-days/);
  assert.match(releaseCmd, /ReleaseComprehensionCatchupCommand[\s\S]*--limit/);
  assert.match(releaseCmd, /ReleaseComprehensionCatchupCommand[\s\S]*--out-dir/);
  assert.match(cliUsage, /release comprehension-catchup \[--repo <owner\/repo>\] \[--lookback-days 14\] \[--limit 5\] \[--out-dir reports\/comprehension\]/);

  assert.match(releaseCmd, /static paths = \[\["release", "post-to-slack"\]\]/);
  assert.match(releaseCmd, /static paths = \[\["release", "emit-narrative-document"\]\]/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--context/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--context-b64/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--narrative/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--narrative-b64/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--issue-url/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--repo-path/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--factory-id/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--output-dir/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--taxonomy-json/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--category/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--tags-json/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--topics-json/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--publishable/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--contains-internal-only/);
  assert.match(releaseCmd, /ReleaseEmitNarrativeDocumentCommand[\s\S]*--internal-only-sections-json/);
  assert.match(releaseCmd, /static paths = \[\["release", "example-web-followup"\]\]/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--context/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--context-b64/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--narrative/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--narrative-b64/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--factory-id/);
  assert.match(releaseCmd, /ReleaseShapingFollowupCommand[\s\S]*--repo-path/);
  assert.match(releaseCmd, /--context/);
  assert.match(releaseCmd, /--context-b64/);
  assert.match(releaseCmd, /--payload/);
  assert.match(releaseCmd, /--payload-b64/);
  assert.match(releaseCmd, /--webhook-url/);
  assert.match(releaseCmd, /--factory-root/);
  assert.match(releaseCmd, /--config-path/);
  assert.match(releaseCmd, /--max-attempts/);
  assert.match(releaseCmd, /--retry-delay-ms/);
  assert.match(releaseCmd, /static paths = \[\["release", "validate-policy"\]\]/);
  assert.match(releaseCmd, /Option\.String\("--policy-path", ""\)/);
  assert.match(releaseCmd, /Option\.String\("--policy-json", ""\)/);
  assert.match(releaseCmd, /static paths = \[\["release", "rollout-events"\]\]/);
  assert.match(releaseCmd, /Option\.String\("--manifest-path", ""\)/);
  assert.match(releaseCmd, /Option\.String\("--manifest-fetch-cmd", ""\)/);
  assert.match(releaseCmd, /Option\.String\("--manifest-ref", ""\)/);
  assert.match(releaseCmd, /Option\.String\("--control-plane-repo", ""\)/);
  assert.match(releaseCmd, /Option\.String\("--rollout-channel", "stable"\)/);
  assert.match(releaseCmd, /Option\.Boolean\("--json", false\)/);
  assert.match(cliUsage, /release post-to-slack \(--context '\{\.\.\.\}' \| --context-b64 <base64>\) \(--payload '\{\.\.\.\}' \| --payload-b64 <base64>\) \[--webhook-url <url>\] \[--factory-root <path>\] \[--config-path <path>\] \[--max-attempts 3\] \[--retry-delay-ms 250\]/);
  assert.match(cliUsage, /release emit-narrative-document \(--context '\{\.\.\.\}' \| --context-b64 <base64>\) \(--narrative '\{\.\.\.\}' \| --narrative-b64 <base64>\) --issue-url <url> \[--repo-path \.\] \[--factory-id <id>\] \[--output-dir reports\/release\/narratives\]/);
  assert.match(cliUsage, /release example-web-followup \(--context '\{\.\.\.\}' \| --context-b64 <base64>\) \(--narrative '\{\.\.\.\}' \| --narrative-b64 <base64>\) \[--factory-id <id>\] \[--repo-path \.\]/);
  assert.match(cliUsage, /release validate-policy \(--policy-path <path> \| --policy-json '\{\.\.\.\}'\)/);
  assert.match(cliUsage, /release rollout-events \[--manifest-path <path>\] \[--manifest-fetch-cmd '<cmd>'\] \[--manifest-ref <ref>\] \[--control-plane-repo <owner\/repo>\] \[--rollout-channel stable\|canary\|pinned\] \[--json\]/);
  assert.match(cliUsage, /webhook resolution precedence: --webhook-url > FACTORY_SLACK_WEBHOOK_URL > factory\.config\.json slack_webhook_url/);
});

test("ops CLI usage advertises fail-closed release-manifest behavior", () => {
  assert.match(cliUsage, /artifact release-manifest[\s\S]*fails closed on GH read\/linkage errors/);
});

test("ops CLI usage documents skill scaffold/validation contracts", () => {
  assert.match(skillCmd, /static paths = \[\["skill", "scaffold-interface"\]\]/);
  assert.match(skillCmd, /--skill-name/);
  assert.match(skillCmd, /--skills-root/);
  assert.match(skillCmd, /--owner/);
  assert.match(skillCmd, /--overwrite/);
  assert.match(skillCmd, /--dry-run/);
  assert.match(skillCmd, /--validate-existing/);

  assert.match(skillCmd, /static paths = \[\["skill", "validate-interface"\]\]/);
});

test("ops CLI usage documents research approval/stage-label/status contracts", () => {
  assert.match(researchCmd, /static paths = \[\["research", "approve-stage"\]\]/);
  assert.match(researchCmd, /--hypothesis-id/);
  assert.match(researchCmd, /--stage/);
  assert.match(researchCmd, /--approved/);
  assert.match(researchCmd, /--reviewer-id/);
  assert.match(researchCmd, /--reviewer-note/);
  assert.match(researchCmd, /--approvals-dir/);

  assert.match(researchCmd, /static paths = \[\["research", "set-stage-label"\]\]/);
  assert.match(researchCmd, /--repo/);
  assert.match(researchCmd, /--hypothesis-issue/);

  assert.match(researchCmd, /static paths = \[\["research", "set-approval-label"\]\]/);
  assert.match(researchCmd, /--approval-context/);

  assert.match(researchCmd, /static paths = \[\["research", "status"\]\]/);
  assert.match(researchCmd, /--runs-dir/);
  assert.match(researchCmd, /--use-github/);

  assert.match(cliUsage, /research approve-stage --hypothesis-id <id> --stage hypothesis_formulation\|feature_engineering_eda\|backtesting\|verification_red_team --approved true\|false/);
  assert.match(cliUsage, /context_path pointing at this approval JSON/);
  assert.match(cliUsage, /research set-stage-label --repo <owner\/repo> --hypothesis-issue <n> --stage hypothesis_formulation\|data_infrastructure\|feature_engineering_eda\|strategy_design\|backtesting\|verification_red_team\|synthesis/);
  assert.match(cliUsage, /research set-approval-label --repo <owner\/repo> --hypothesis-issue <n> --approved true\|false --approval-context '\{\"stage_id\":\"backtesting\"\}'/);
  assert.match(cliUsage, /research status --hypothesis-id <id> \[--runs-dir \.hatch\/research\/runs\] \[--repo <owner\/repo>\] \[--hypothesis-issue <n>\] \[--run-id <id>\] \[--use-github true\|false\]/);
});

test("goal_issue_execute graph labels execution_mode contract", () => {
  const dot = readFileSync(waveIssueGraphPath, "utf8");
  assert.match(dot, /label="Resolve execution mode \(full\|smoke; non-smoke follows full path\)"/);
  assert.match(dot, /mode_gate -> set_max_review_attempts \[condition="execution_mode!=smoke"\]/);
  assert.match(dot, /fetch_goal_issue/);
  assert.match(dot, /Parent goal issue JSON:\\n\$\{goal_issue\}/);
  assert.match(dot, /should_retry_review/);
  assert.match(dot, /enforce_visual_refinement_evidence/);
  assert.match(dot, /visual_refinement_gate/);
  assert.match(dot, /action_id="coding\.verify_visual_refinement_evidence"/);
  assert.match(dot, /visual_refinement_gate -> report_retry_failed \[condition="visual_refinement_gate_pass!=true"\]/);
  assert.doesNotMatch(dot, /load_latest_review_evidence/);
  assert.doesNotMatch(dot, /done_elsewhere_gate \[shape=diamond label="Zero-delta done elsewhere\?"\]/);
});
