import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const factoryRoot = join(repoRoot, "factories/example-scanner");
const configPath = join(factoryRoot, "factory.config.json");
const kindPath = join(factoryRoot, "kind.json");
const instanceTemplatePath = join(factoryRoot, "instance.template.json");
const envContractPath = join(factoryRoot, "env.contract.json");
const manifestPath = join(factoryRoot, "inventory/factory-composition-manifest.v1.json");
const readmePath = join(factoryRoot, "README.md");
const registryPath = join(repoRoot, "factory-registry.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

test("example-scanner bundle stays config-first and routes entirely through shared managed graphs", () => {
  const config = readJson(configPath);
  const kind = readJson(kindPath);
  const instance = readJson(instanceTemplatePath);

  assert.equal(config.factory_id, "example-scanner");
  assert.equal(config.factory_root, "factories/example-scanner");
  assert.equal(config.target_repo, "example-org/example-scanner");
  assert.equal(config.control_plane_repo, "recallnet/astrochicken");
  assert.equal(config.managed, true);
  assert.equal(config.workspace_mode, "checkout");
  assert.equal(config.dispatch?.graph, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.pipeline?.supervisor_tick, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.scenarios?.root, "packages/factory-runtime/scenarios/managed_software_delivery");
  assert.equal(config.canonical_checkout_path, "${HATCH_CANONICAL_CHECKOUT_PATH}");
  assert.equal(kind.shared_supervisor_shell, "docs/contracts/workflow-ir/factory-runtime/managed-supervisor-shell.dot");
  assert.equal(kind.domain_graph, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");
  assert.equal(instance.instance_id, "example-scanner");
  assert.equal(instance.kind_id, "example-scanner");
  assert.equal(instance.target_repo?.full_name, "example-org/example-scanner");
  assert.equal(instance.control_plane_repo, "recallnet/astrochicken");
  assert.deepEqual(instance.intake?.issue_selector?.labels, ["goal", "ready"]);
});

test("example-scanner does not require factory-local graphs, scripts, workflows, or supervisor glue", () => {
  assert.equal(existsSync(join(factoryRoot, "graphs")), false, "factories/example-scanner/graphs must not exist");
  assert.equal(existsSync(join(factoryRoot, "scripts")), false, "factories/example-scanner/scripts must not exist");
  assert.equal(existsSync(join(factoryRoot, "workflows")), false, "factories/example-scanner/workflows must not exist");
  assert.equal(existsSync(join(factoryRoot, "skills")), false, "factories/example-scanner/skills must not exist");
  assert.equal(existsSync(join(factoryRoot, "roles.stylesheet")), false, "factories/example-scanner/roles.stylesheet must not exist");
});

test("example-scanner registry inventory points at shared runtime graphs", () => {
  const registry = readJson(registryPath);
  const manifest = readJson(manifestPath);
  const envContract = readJson(envContractPath);
  const factory = (registry.factories || []).find((entry) => entry.id === "example-scanner");
  const instance = (registry.instances || []).find((entry) => entry.instance_id === "example-scanner");

  assert.ok(factory, "factory-registry.json must include example-scanner factory entry");
  assert.ok(instance, "factory-registry.json must include example-scanner instance entry");
  assert.equal(factory.target_repo, "example-org/example-scanner");
  assert.equal(instance.target_repo, "example-org/example-scanner");
  assert.equal(instance.installation_manifest_path, ".hatch/hosts/example-scanner/installation.json");
  assert.equal(manifest.artifactDefaults.canonicalCheckoutPath, "${HATCH_CANONICAL_CHECKOUT_PATH}");
  assert.ok(
    envContract.variables.some((entry) => entry.name === "HATCH_CANONICAL_CHECKOUT_PATH" && entry.required),
    "example-scanner env contract must require canonical checkout wiring",
  );

  const factoryGraphPaths = (factory.graphs || []).map((entry) => entry.path);
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot"));
  assert.ok(factoryGraphPaths.includes("docs/contracts/workflow-ir/capability-software-development/goal_execute.dot"));

  const instanceGraphPaths = (instance.graphs || []).map((entry) => entry.path);
  assert.ok(instanceGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"));
  assert.ok(instanceGraphPaths.includes("docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot"));
});

test("example-scanner matches example-trading managed runtime contracts except for repo-specific knobs", () => {
  const exampleScannerConfig = readJson(configPath);
  const exampleScannerKind = readJson(kindPath);
  const exampleTradingConfig = readJson(join(repoRoot, "factories/example-trading/factory.config.json"));
  const exampleTradingKind = readJson(join(repoRoot, "factories/example-trading/kind.json"));

  assert.deepEqual(
    exampleScannerConfig.trust_roles,
    exampleTradingConfig.trust_roles.map((role) => role.replaceAll("example-trading", "example-scanner")),
    "example-scanner should inherit the same managed trust-role shape as example-trading",
  );
  assert.deepEqual(
    exampleScannerKind.required_labels,
    ["managed-factory-bug", "factory:example-scanner"],
    "example-scanner kind labels should mirror example-trading's managed-incident contract",
  );
});

test("example-scanner README states the thin-factory contract explicitly", () => {
  const readme = readText(readmePath);

  assert.match(readme, /This factory intentionally owns config and intent only/i);
  assert.match(readme, /packages\/factory-runtime\/graphs\/managed_supervisor\.dot/);
  assert.match(readme, /packages\/factory-runtime\/graphs\/managed_software_delivery_domain\.dot/);
  assert.doesNotMatch(readme, /graphs\/domain_example_scanner\.dot/);
  assert.doesNotMatch(readme, /skills\/supervisor_rules\.md/);
});
