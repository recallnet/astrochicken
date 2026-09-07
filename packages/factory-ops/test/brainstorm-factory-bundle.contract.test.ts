import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const configPath = join(repoRoot, "factories/brainstorm/factory.config.json");
const registryPath = join(repoRoot, "factory-registry.json");
const graphPath = join(repoRoot, "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot");
const rolesPath = join(repoRoot, "factories/brainstorm/roles.stylesheet");
const kindPath = join(repoRoot, "factories/brainstorm/kind.json");
const instanceTemplatePath = join(repoRoot, "factories/brainstorm/instance.template.json");

function read(path) {
  return readFileSync(path, "utf8");
}

test("brainstorm config contains runnable factory identity wiring", () => {
  const config = JSON.parse(read(configPath));

  assert.equal(config.schema, "hatch.factory.config.v1");
  assert.equal(config.factory_id, "brainstorm");
  assert.equal(config.factory_root, "factories/brainstorm");
  assert.equal(config.target_repo, "example-org/example-notes");
  assert.equal(config.target_repo, undefined);
  assert.equal(config.control_plane_repo, "recallnet/astrochicken");
  assert.equal(config.workspace_mode, "api_only");
  assert.equal(config.service_registry_path, "factory-registry.json");
  assert.equal(config.installation_manifest_path, ".hatch/hosts/brainstorm/installation.json");
  assert.equal(config.runs_dir, ".hatch/brainstorm/runs");
  assert.equal(config.dispatch?.graph, "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot");
  assert.equal(config.pipeline?.supervisor_tick, "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot");
  assert.equal(config.scenarios?.root, "factories/brainstorm/scenarios/brainstorm");
  assert.equal(config.skills?.supervisor, "packages/factory-skills/skills/runtime/brainstorm_supervisor_review/SKILL.md");
  assert.equal(config.trust?.domain, "brainstorm.local");
  assert.equal(config.max_concurrent_brainstorms, 1);
  assert.equal(config.max_brainstorms_per_tick, 1);
});

test("brainstorm registry entry is present with supervisor graph", () => {
  const registry = JSON.parse(read(registryPath));
  const brainstorm = (registry.factories || []).find((entry) => entry.id === "brainstorm");

  assert.ok(brainstorm, "factory-registry.json must include brainstorm");
  assert.equal(brainstorm.repo, "example-org/example-notes");
  assert.deepEqual(brainstorm.graphs, [
    {
      id: "factory_supervisor_tick",
      path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot",
    },
  ]);
  assert.equal(brainstorm.daemonStatus?.status, "stopped");
});

test("brainstorm supervisor graph composes shared managed supervisor shell", () => {
  const dot = read(graphPath);

  assert.match(dot, /pipeline="packages\/factory-runtime\/graphs\/managed_supervisor\.dot"/);
  assert.match(dot, /set_kind_path[\s\S]*factories\/brainstorm\/kind\.json/);
  assert.match(dot, /set_instance_path[\s\S]*factories\/brainstorm\/instance\.template\.json/);
  assert.match(dot, /set_destinations_json[\s\S]*goal_issues/, "factory_supervisor_tick.dot missing goal_issues route in set_destinations_json");
  assert.match(dot, /set_destinations_json[\s\S]*platform_incidents/, "factory_supervisor_tick.dot missing platform_incidents route in set_destinations_json");
  assert.match(dot, /export_keys="managed_run_summary,lifecycle_state,health_state,failure_classification,failure_reason,domain_result"/);
});

test("brainstorm bundle declares api_only identity and dual destinations", () => {
  const kind = JSON.parse(read(kindPath));
  const instanceTemplate = JSON.parse(read(instanceTemplatePath));

  assert.deepEqual(
    kind.supported_destinations,
    ["goal_issues", "platform_incidents"],
    "kind.json supported_destinations must include both goal_issues and platform_incidents",
  );
  assert.equal(instanceTemplate.workspace_mode, "api_only", "instance.template.json must pin workspace_mode to api_only");
  assert.equal(instanceTemplate.target_repo?.full_name, "example-org/example-notes", "instance.template.json must pin target_repo to example-org/example-notes");
  assert.equal(typeof instanceTemplate.instance_id, "string", "instance.template.json must declare instance_id");
  assert.notEqual(instanceTemplate.instance_id.trim(), "", "instance.template.json instance_id must be non-empty");
  assert.equal(instanceTemplate.destinations?.goal_issues?.repo, "recallnet/astrochicken", "instance.template.json missing destinations.goal_issues.repo");
  assert.deepEqual(instanceTemplate.destinations?.goal_issues?.labels, ["goal", "source:brainstorm"], "instance.template.json destinations.goal_issues.labels must match contract");
  assert.equal(instanceTemplate.destinations?.platform_incidents?.repo, "recallnet/astrochicken", "instance.template.json missing destinations.platform_incidents.repo");
  assert.deepEqual(instanceTemplate.destinations?.platform_incidents?.labels, ["managed-factory-bug", "kind:brainstorm"], "instance.template.json destinations.platform_incidents.labels must match contract");
});

test("brainstorm stylesheet defines strategist role classes explicitly", () => {
  const stylesheet = read(rolesPath);

  assert.match(stylesheet, /@import "\.\.\/_shared\/roles\.stylesheet"/);
  assert.match(stylesheet, /\.red_strategist\s*\{/);
  assert.match(stylesheet, /\.blue_strategist\s*\{/);
  assert.match(stylesheet, /trust_domain\s*=\s*"brainstorm\.local"/);
});
