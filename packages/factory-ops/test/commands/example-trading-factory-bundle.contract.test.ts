import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const factoryRoot = join(repoRoot, "factories/example-trading");
const configPath = join(factoryRoot, "factory.config.json");
const kindPath = join(factoryRoot, "kind.json");
const instanceTemplatePath = join(factoryRoot, "instance.template.json");
const readmePath = join(factoryRoot, "README.md");
const registryPath = join(repoRoot, "factory-registry.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

test("example-trading bundle stays config-first and routes entirely through shared managed graphs", () => {
  const config = readJson(configPath);
  const kind = readJson(kindPath);
  const instance = readJson(instanceTemplatePath);

  assert.equal(config.factory_id, "example-trading");
  assert.equal(config.factory_root, "factories/example-trading");
  assert.equal(config.target_repo, "recallnet/astrochicken");
  assert.equal(config.target_repo, "example-org/example-trading");
  assert.equal(config.control_plane_repo, "recallnet/astrochicken");
  assert.equal(config.managed, true);
  assert.equal(config.workspace_mode, "checkout");
  assert.equal(config.dispatch?.graph, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.pipeline?.supervisor_tick, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.scenarios?.root, "packages/factory-runtime/scenarios/managed_software_delivery");
  assert.equal(kind.shared_supervisor_shell, "docs/contracts/workflow-ir/factory-runtime/managed-supervisor-shell.dot");
  assert.equal(kind.domain_graph, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");
  assert.equal(instance.instance_id, "example-trading");
  assert.equal(instance.kind_id, "example-trading");
  assert.equal(instance.target_repo?.full_name, "recallnet/astrochicken");
  assert.equal(instance.control_plane_repo, "recallnet/astrochicken");
  assert.deepEqual(instance.intake?.issue_selector?.labels, ["goal", "ready"]);
});

test("example-trading does not require factory-local graphs, scripts, workflows, or supervisor glue", () => {
  assert.equal(existsSync(join(factoryRoot, "graphs")), false, "factories/example-trading/graphs must not exist");
  assert.equal(existsSync(join(factoryRoot, "scripts")), false, "factories/example-trading/scripts must not exist");
  assert.equal(existsSync(join(factoryRoot, "workflows")), false, "factories/example-trading/workflows must not exist");
  assert.equal(existsSync(join(factoryRoot, "skills")), false, "factories/example-trading/skills must not exist");
  assert.equal(existsSync(join(factoryRoot, "scenarios")), false, "factories/example-trading/scenarios must not exist");
  assert.equal(existsSync(join(factoryRoot, "policy-pack")), false, "factories/example-trading/policy-pack must not exist");
  assert.equal(existsSync(join(factoryRoot, "roles.stylesheet")), false, "factories/example-trading/roles.stylesheet must not exist");
});

test("example-trading registry inventory points at shared runtime graphs", () => {
  const registry = readJson(registryPath);
  const factory = (registry.factories || []).find((entry) => entry.id === "example-trading");
  const instance = (registry.instances || []).find((entry) => entry.instance_id === "example-trading");

  assert.ok(factory, "factory-registry.json must include example-trading factory entry");
  assert.ok(instance, "factory-registry.json must include example-trading instance entry");
  assert.equal(factory.repo, "example-org/example-trading");
  assert.equal(instance.target_repo, "recallnet/astrochicken");

  const factoryGraphPaths = (factory.graphs || []).map((entry) => entry.path);
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/capability-software-development/goal_execute.dot"));

  const instanceGraphPaths = (instance.graphs || []).map((entry) => entry.path);
  assert.ok(instanceGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));
  assert.ok(instanceGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot"));
});

test("example-trading README states the thin-factory contract explicitly", () => {
  const readme = readText(readmePath);

  assert.match(readme, /This factory intentionally owns config and intent only/i);
  assert.match(readme, /packages\/factory-runtime\/graphs\/managed_supervisor\.dot/);
  assert.match(readme, /packages\/factory-runtime\/graphs\/managed_software_delivery_domain\.dot/);
  assert.match(readme, /packages\/capability-release-reporting\/graphs\/release_report_flow\.dot/);
  assert.doesNotMatch(readme, /factories\/example-trading\/graphs\/domain_example_trading\.dot/);
  assert.doesNotMatch(readme, /factories\/example-trading\/skills\/supervisor_rules\.md/);
});
