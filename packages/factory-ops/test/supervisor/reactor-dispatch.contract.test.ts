import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const configPath = join(repoRoot, "factories/mothership/factory.config.json");
const registryPath = join(repoRoot, "factory-registry.json");
const activeSurfaceManifestPath = join(repoRoot, "docs/contracts/active-surface-manifest.json");
const supervisorDotPath = join(repoRoot, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const dispatchDotPath = join(repoRoot, "factories/mothership/graphs/factory_dispatch_reactor.dot");

test("mothership config splits dispatch graph from maintenance supervisor tick", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(config.dispatch.graph, "factories/mothership/workflows/dispatch-control/factory_dispatch_reactor.workflow-source.mjs");
  assert.equal(config.dispatch.latency_slo_seconds, 15);
  assert.equal(config.pipeline.supervisor_tick, "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
  assert.equal(config.pipeline.maintenance_interval_seconds, 300);
  assert.notEqual(config.dispatch.graph, config.pipeline.supervisor_tick);
  assert.ok(config.pipeline.maintenance_interval_seconds > config.dispatch.latency_slo_seconds);
});

test("dispatch reactor owns executable-goal selection, completion reaction, and launch", () => {
  const dot = readFileSync(dispatchDotPath, "utf8");
  const sweepCompletedActionId = 'action_id="goal.sweep_completed"';
  const releaseQuarantineActionId = 'action_id="wave.release_quarantine"';

  assert.match(dot, /artifact_ingest \[type="pipeline"/);
  assert.match(dot, /auto_ready_artifact_goals[\s\S]*action_runtime="in_process" action_id="goal\.auto_ready_artifacts"/);
  assert.match(dot, /sanitize_goal_duplicates[\s\S]*action_runtime="in_process" action_id="goal\.sanitize_duplicates"/);
  assert.ok(dot.includes(sweepCompletedActionId));
  assert.match(dot, /sweep_completed_goals[\s\S]*action_runtime="in_process" action_id="goal\.sweep_completed"/);
  assert.ok(dot.includes(releaseQuarantineActionId));
  assert.match(dot, /release_quarantine[\s\S]*action_runtime="in_process" action_id="wave\.release_quarantine"/);
  assert.match(dot, /resolve_dispatch_retry_backoff_seconds[\s\S]*action_runtime="in_process" action_id="common\.resolve_default"/);
  assert.match(dot, /list_executable_goals \[type="tool"/);
  assert.match(dot, /list_executable_goals[\s\S]*action_runtime="in_process" action_id="software\.list_executable_goals"/);
  assert.match(dot, /action_backoff_seconds="\$\{dispatch_retry_backoff_seconds\}"/);
  assert.match(dot, /goal_execute_gate \[shape="diamond" label="Any executable goals\?" recovery_owner="dispatch_reactor"\]/);
  assert.match(dot, /spawn_goal_execute \[type="fan_out\.detached"/);
  assert.match(dot, /template="factories\/mothership\/workflows\/goal-execution\/goal_execute\.workflow-source\.mjs"/);
  assert.match(dot, /start -> set_gh_repo -> artifact_ingest -> auto_ready_artifact_goals -> sanitize_goal_duplicates -> sweep_completed_goals -> release_quarantine -> set_max_concurrent_waves_for_goal_execute -> resolve_dispatch_retry_backoff_seconds -> list_executable_goals -> goal_execute_gate/);
  assert.match(dot, /goal_execute_gate -> stamp_factory_contract_hash \[condition="count!=0"\]/);
  assert.match(dot, /stamp_factory_contract_hash -> spawn_goal_execute/);
  assert.match(dot, /spawn_goal_execute -> done/);
});

test("dispatch reactor excludes non-hot-path supervisor concerns", () => {
  const dot = readFileSync(dispatchDotPath, "utf8");

  assert.doesNotMatch(dot, /release_manifest/);
  assert.doesNotMatch(dot, /emit_disposition_feedback/);
  assert.doesNotMatch(dot, /snapshot_state/);
  assert.doesNotMatch(dot, /supervisor_review/);
});

test("mothership no longer treats legacy wave dispatch as an active governed graph", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const activeSurfaceManifest = JSON.parse(readFileSync(activeSurfaceManifestPath, "utf8"));
  const mothershipInstance = registry.instances.find((entry) => entry.instance_id === "mothership");
  const mothershipFactory = registry.factories.find((entry) => entry.id === "mothership");
  const activeFactoryGraphs = activeSurfaceManifest.graph_families.find((entry) => entry.id === "factory_graphs_active");

  assert.ok(mothershipInstance);
  assert.ok(mothershipFactory);
  assert.ok(activeFactoryGraphs);
  assert.deepEqual(
    mothershipInstance.graphs.some((entry) => entry.path === "docs/contracts/workflow-ir/mothership/wave_dispatch.dot"),
    false,
  );
  assert.deepEqual(
    mothershipFactory.graphs.some((entry) => entry.path === "docs/contracts/workflow-ir/mothership/wave_dispatch.dot"),
    false,
  );
  assert.deepEqual(
    activeFactoryGraphs.include.includes("docs/contracts/workflow-ir/mothership/wave_dispatch.dot"),
    false,
  );
});
