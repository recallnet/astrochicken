import { readFixtureText as read } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const configPath = join(repoRoot, "factories/example-web/factory.config.json");
const kindPath = join(repoRoot, "factories/example-web/kind.json");
const instanceTemplatePath = join(repoRoot, "factories/example-web/instance.template.json");
const registryPath = join(repoRoot, "factory-registry.json");
const sharedDomainGraphPath = join(repoRoot, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");
const managedSupervisorGraphPath = join(repoRoot, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
const localDomainGraphPath = join(repoRoot, "factories/example-web/graphs/domain_example_web.dot");
const localDomainGraphPngPath = join(repoRoot, "factories/example-web/graphs/domain_example_web.png");
const localDomainWorkflowDataPath = join(repoRoot, "factories/example-web/workflows/dispatch-control/domain_example_web.workflow-source.data.json");
const localDomainWorkflowSourcePath = join(repoRoot, "factories/example-web/workflows/dispatch-control/domain_example_web.workflow-source.mjs");
const localDailyReleaseGraphPath = join(repoRoot, "factories/example-web/graphs/daily_release_report.dot");
const localDailyReleaseGraphPngPath = join(repoRoot, "factories/example-web/graphs/daily_release_report.png");
const localDailyReleaseWorkflowDataPath = join(repoRoot, "factories/example-web/workflows/daily-reporting/daily_release_report.workflow-source.data.json");
const localDailyReleaseWorkflowSourcePath = join(repoRoot, "factories/example-web/workflows/daily-reporting/daily_release_report.workflow-source.mjs");
const localRolesStylesheetPath = join(repoRoot, "factories/example-web/roles.stylesheet");
const localGraphsDirPath = join(repoRoot, "factories/example-web/graphs");
const localDailyReportingWorkflowDirPath = join(repoRoot, "factories/example-web/workflows/daily-reporting");
const localDispatchControlWorkflowDirPath = join(repoRoot, "factories/example-web/workflows/dispatch-control");
const localWorkflowsDirPath = join(repoRoot, "factories/example-web/workflows");
const localPolicyPackDirPath = join(repoRoot, "factories/example-web/policy-pack");
const localScriptsDirPath = join(repoRoot, "factories/example-web/scripts");
const localPilotVerifierPath = join(repoRoot, "factories/example-web/scripts/verify-pilot-outcome.mjs");
const localConformanceScriptPath = join(repoRoot, "factories/example-web/scripts/run-conformance.sh");
const localScenariosDirPath = join(repoRoot, "factories/example-web/scenarios");
const localScenariosLeafDirPath = join(repoRoot, "factories/example-web/scenarios/example-web");
const localConformanceDirPath = join(repoRoot, "factories/example-web/conformance");
const localConformanceDataDirPath = join(repoRoot, "factories/example-web/conformance/data");
const localSupervisorRulesPath = join(repoRoot, "factories/example-web/skills/supervisor_rules.md");
const codeReviewRepoPath = join(repoRoot, "factories/example-web/skills/code_review/REPO.md");
const readmePath = join(repoRoot, "factories/example-web/README.md");

test("example-web config contains required managed-factory wiring", () => {
  const config = JSON.parse(read(configPath));

  assert.equal(config.schema, "hatch.factory.config.v1");
  assert.equal(config.factory_id, "example-web");
  assert.equal(config.factory_root, "factories/example-web");
  assert.equal(config.target_repo, "example-org/example-web");
  assert.equal(config.control_plane_repo, "recallnet/astrochicken");
  assert.equal(config.workspace_mode, "checkout");
  assert.equal(config.service_registry_path, "factory-registry.json");
  assert.equal(config.installation_manifest_path, ".hatch/hosts/example-web/installation.json");
  assert.equal(config.runs_dir, ".hatch/example-web/runs");
  assert.equal(config.work_dir, "/path/to/example-web");
  assert.equal(config.scenarios?.root, "packages/factory-runtime/scenarios/managed_software_delivery");
  assert.equal(config.managed, true);
  assert.equal(config.upstream_repo, "recallnet/astrochicken");
  assert.deepEqual(config.upstream_bug_labels, ["managed-factory-bug", "factory:example-web"]);
  assert.equal(config.provider, "openrouter");
  assert.equal(config.model, "openai/gpt-5.3-codex");
  // @context:regression !critical issue #2573 removed example-web-local policy-pack files; config-only managed wiring must not reintroduce policyPack for example-web.
  assert.equal(Object.prototype.hasOwnProperty.call(config, "policyPack"), false);
  assert.equal(config.dispatch?.graph, "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs");
  assert.equal(config.pipeline?.supervisor_tick, "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs");

  const dailyReleaseReportJob = (config.schedules?.jobs || []).find((job) => job.id === "daily-release-report");
  assert.ok(dailyReleaseReportJob, "daily-release-report scheduled job must exist");
  assert.equal(dailyReleaseReportJob.graph, "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs");
});

test("example-web kind manifest routes through shared shell into shared software-delivery domain", () => {
  const kind = JSON.parse(read(kindPath));

  assert.equal(kind.kind_id, "example-web");
  assert.equal(kind.managed, true);
  assert.equal(kind.execution_mode, "code");
  assert.equal(kind.default_workspace_mode, "checkout");
  assert.equal(kind.shared_supervisor_shell, "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs");
  assert.equal(kind.domain_graph, "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs");
  assert.equal(kind.shell_hooks?.managed_load_context, "hatch-ops supervisor managed-load-context");
  assert.equal(kind.shell_hooks?.managed_domain_contract, "hatch-ops supervisor managed-domain-contract");
  assert.deepEqual(kind.supported_destinations, ["platform_incidents"]);
  assert.ok(kind.required_labels.includes("goal"));
  assert.ok(kind.required_labels.includes("ready"));
  assert.ok(kind.required_labels.includes("managed-factory-bug"));
  assert.ok(kind.required_labels.includes("factory:example-web"));
});

test("example-web factory no longer ships local domain or daily-release graph/workflow copies", () => {
  assert.equal(existsSync(localDomainGraphPath), false, "factories/example-web/graphs/domain_example_web.dot must not exist");
  assert.equal(existsSync(localDomainGraphPngPath), false, "factories/example-web/graphs/domain_example_web.png must not exist");
  assert.equal(existsSync(localDomainWorkflowDataPath), false, "dispatch-control/domain_example_web.workflow-source.data.json must not exist");
  assert.equal(existsSync(localDomainWorkflowSourcePath), false, "dispatch-control/domain_example_web.workflow-source.mjs must not exist");

  assert.equal(existsSync(localDailyReleaseGraphPath), false, "factories/example-web/graphs/daily_release_report.dot must not exist");
  assert.equal(existsSync(localDailyReleaseGraphPngPath), false, "factories/example-web/graphs/daily_release_report.png must not exist");
  assert.equal(existsSync(localDailyReleaseWorkflowDataPath), false, "daily-reporting/daily_release_report.workflow-source.data.json must not exist");
  assert.equal(existsSync(localDailyReleaseWorkflowSourcePath), false, "daily-reporting/daily_release_report.workflow-source.mjs must not exist");
});

// @context:decision !critical example-web now follows config-only managed-factory topology; reintroducing local graphs/workflow dirs would bypass shared runtime contracts from #2568/#2571.
test("example-web factory has no local graphs or workflows directories", () => {
  assert.equal(existsSync(localGraphsDirPath), false, "factories/example-web/graphs must not exist");
  assert.equal(existsSync(localDailyReportingWorkflowDirPath), false, "factories/example-web/workflows/daily-reporting must not exist");
  assert.equal(existsSync(localDispatchControlWorkflowDirPath), false, "factories/example-web/workflows/dispatch-control must not exist");
  assert.equal(existsSync(localWorkflowsDirPath), false, "factories/example-web/workflows must not exist");
});

// @context:regression !critical issue #2572 requires example-web to inherit shared role defaults + config model/provider instead of keeping a local roles stylesheet.
test("example-web factory has no local roles stylesheet", () => {
  assert.equal(existsSync(localRolesStylesheetPath), false, "factories/example-web/roles.stylesheet must not exist");
});

// @context:regression !critical issue #2573 requires example-web policy to come from shared runtime defaults or config-level wiring; reintroducing a local policy-pack bypasses config-only managed-factory ownership.
test("example-web factory has no local policy-pack directory", () => {
  assert.equal(existsSync(localPolicyPackDirPath), false, "factories/example-web/policy-pack must not exist");
});

// @context:regression !critical issue #2574 removes pilot-era example-web-local scripts/empty scaffolding; config-only factory bundles must not reintroduce local conformance wrappers.
test("example-web factory has no local scripts, empty scenarios/conformance scaffolding, or supervisor addendum", () => {
  assert.equal(existsSync(localScriptsDirPath), false, "factories/example-web/scripts must not exist");
  assert.equal(existsSync(localPilotVerifierPath), false, "factories/example-web/scripts/verify-pilot-outcome.mjs must not exist");
  assert.equal(existsSync(localConformanceScriptPath), false, "factories/example-web/scripts/run-conformance.sh must not exist");

  assert.equal(existsSync(localScenariosLeafDirPath), false, "factories/example-web/scenarios/example-web must not exist");
  assert.equal(existsSync(localScenariosDirPath), false, "factories/example-web/scenarios must not exist");

  assert.equal(existsSync(localConformanceDataDirPath), false, "factories/example-web/conformance/data must not exist");
  assert.equal(existsSync(localConformanceDirPath), false, "factories/example-web/conformance must not exist");

  assert.equal(existsSync(localSupervisorRulesPath), false, "factories/example-web/skills/supervisor_rules.md must not exist");
  assert.equal(existsSync(codeReviewRepoPath), true, "factories/example-web/skills/code_review/REPO.md must remain");
});

// @context:regression !critical Guard against regressing to any factory-local DOT in example-web; goal #2571 requires shared-runtime-only graph ownership.
test("example-web has no factory-local DOT graphs", () => {
  if (!existsSync(localGraphsDirPath)) {
    return;
  }

  const localDotGraphs = readdirSync(localGraphsDirPath).filter((entry) => entry.endsWith(".dot"));
  assert.deepEqual(localDotGraphs, [], "factories/example-web/graphs must not contain local .dot graphs");
});

test("managed supervisor routes through resolved domain_graph context key", () => {
  const dot = read(managedSupervisorGraphPath);

  assert.match(dot, /load_context[\s\S]*outputs="[^"]*domain_graph[^"]*"/);
  assert.match(dot, /run_domain_graph\s*\[[\s\S]*pipeline="\$\{domain_graph\}"/);
});

test("shared managed software-delivery domain graph is reachable for example-web", () => {
  const dot = read(sharedDomainGraphPath);

  assert.match(dot, /fan_out_goal_run\s*\[[\s\S]*template="@hatch\/capability-goal-decomposition\/workflows\/goal_run\/goal_run\.workflow-source\.mjs"/);
  assert.match(dot, /spawn_goal_execute\s*\[[\s\S]*template="@hatch\/capability-software-development\/workflows\/goal_execute\/goal_execute\.workflow-source\.mjs"/);
  assert.match(dot, /set_domain_result\s*\[[\s\S]*output_key="domain_result"/);
  assert.match(dot, /release_manifest[\s\S]*action_runtime="in_process" action_id="artifact\.release_manifest"/);

  assert.doesNotMatch(dot, /factories\/example-web\/graphs\//);
  assert.doesNotMatch(dot, /hatch-ops wave\s+/);
});

test("example-web instance template defines intake + managed host metadata", () => {
  const instance = JSON.parse(read(instanceTemplatePath));

  assert.equal(instance.instance_id, "example-web");
  assert.equal(instance.kind_id, "example-web");
  assert.equal(instance.workspace_mode, "checkout");
  assert.equal(instance.service_registry_path, "factory-registry.json");
  assert.equal(instance.installation_manifest_path, ".hatch/hosts/example-web/installation.json");
  assert.equal(instance.target_repo?.full_name, "example-org/example-web");
  assert.equal(instance.control_plane_repo, "recallnet/astrochicken");
  assert.deepEqual(instance.intake?.issue_selector?.labels, ["goal", "ready"]);
  assert.equal(instance.destinations?.platform_incidents?.repo, "recallnet/astrochicken");
  assert.ok((instance.destinations?.platform_incidents?.labels || []).includes("managed-factory-bug"));
  assert.ok((instance.destinations?.platform_incidents?.labels || []).includes("factory:example-web"));
});

test("factory-registry includes example-web factory + instance graph inventory", () => {
  const registry = JSON.parse(read(registryPath));
  const factory = (registry.factories || []).find((entry) => entry.id === "example-web");
  const instance = (registry.instances || []).find((entry) => entry.instance_id === "example-web");

  assert.ok(factory, "factory-registry.json must include example-web factory entry");
  assert.equal(factory.repo, "example-org/example-web");

  const factoryGraphPaths = (factory.graphs || []).map((graph) => graph.path);
  assert.ok(factoryGraphPaths.includes("packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs"));
  assert.ok(factoryGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs"));
  assert.ok(factoryGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs"));
  assert.ok(factoryGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs"));
  assert.ok(factoryGraphPaths.includes("packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs"));
  assert.ok(factoryGraphPaths.includes("packages/capability-software-development/workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs"));

  assert.ok(instance, "factory-registry.json must include example-web instance entry");
  assert.equal(instance.kind_id, "example-web");
  assert.equal(instance.target_repo, "example-org/example-web");
  assert.equal(instance.status, "active");
  assert.equal(instance.assigned_host_id, "unassigned");
  assert.equal(instance.installation_manifest_path, ".hatch/hosts/example-web/installation.json");
  assert.equal(instance.service_tier, "standard");
  assert.equal(instance.support_owner, "ops");

  const instanceGraphPaths = (instance.graphs || []).map((graph) => graph.path);
  assert.ok(instanceGraphPaths.includes("packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs"));
  assert.ok(instanceGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs"));
  assert.ok(instanceGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs"));
  assert.ok(instanceGraphPaths.includes("packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs"));
  assert.ok(instanceGraphPaths.includes("packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs"));
  assert.ok(instanceGraphPaths.includes("packages/capability-software-development/workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs"));
});

test("example-web README captures host lifecycle, monitoring loop, and validation commands", () => {
  const readme = read(readmePath);

  assert.match(readme, /hatch-ops factory host-install --factory-id example-web --host-base-dir ~\/\.hatch-hosts/);
  assert.match(readme, /hatch-ops factory host-start --factory-id example-web --host-base-dir ~\/\.hatch-hosts/);
  assert.match(readme, /hatch-ops factory host-health --factory-id example-web --host-base-dir ~\/\.hatch-hosts/);
  assert.match(readme, /hatch-ops factory tick-status --factory-id example-web/);

  assert.match(readme, /hatch-ops factory status --factory-id example-web --json/);
  assert.match(readme, /hatch-ops factory subscribe --factory-id example-web/);
  assert.match(readme, /hatch-ops factory outcomes --repo example-org\/example-web --lookback-hours 1 --json/);
  assert.match(readme, /hatch-ops factory subscribe --factory-id example-web --target next-review/);
  assert.match(readme, /hatch-ops factory subscribe --factory-id example-web --target next-merge/);

  assert.match(readme, /hatch-ops factory validate --factory-root factories\/example-web/);
  assert.match(readme, /node scripts\/run-conformance-harness\.mjs --factory-root factories\/example-web/);
  assert.doesNotMatch(readme, /factories\/example-web\/scripts\/run-conformance\.sh/);
  assert.doesNotMatch(readme, /verify-pilot-outcome\.mjs/);

  assert.match(readme, /workspace_mode: "checkout"/);
  assert.match(readme, /packages\/factory-runtime\/workflows\/managed_software_delivery_domain\/managed_software_delivery_domain\.workflow-source\.mjs/);
  assert.doesNotMatch(readme, /factories\/example-web\/graphs\/domain_example_web\.dot/);
});
