import test from "node:test";
import assert from "node:assert/strict";

import {
  defineFactoryCompositionManifest,
  exportFactoryCompositionManifestDocument,
  stringifyFactoryCompositionManifestDocument,
} from "../src/factory-composition-registry.ts";

test("defineFactoryCompositionManifest normalizes graph bindings and policy keys", () => {
  const manifest = defineFactoryCompositionManifest({
    schemaVersion: "factory_composition_manifest/v1",
    factoryId: "demo",
    compositionModel: "thin_composition",
    manifestPath: "factories/demo/inventory/factory-composition-manifest.v1.json",
    configPath: "factories/demo/factory.config.json",
    registryPath: "factory-registry.json",
    dispatchGraphPath: "factories/demo/graphs/factory_supervisor_tick.dot",
    supervisorGraphPath: "factories/demo/graphs/factory_supervisor_tick.dot",
    graphBindings: [
      { id: "goal_run", path: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs", owner: "shared", role: "capability_binding" },
      { id: "factory_supervisor_tick", path: "factories/demo/graphs/factory_supervisor_tick.dot", owner: "factory", role: "supervisor" },
    ],
    bootstrap: {
      readmePath: "factories/demo/README.md",
      intentPath: "factories/demo/INTENT.md",
      createEvolveDocPath: "factories/demo/docs/factory-create-evolve.md",
      conformanceReadmePath: "factories/demo/conformance/README.md",
      initCommand: "hatch factory init --id demo --repo example-org/demo --control-plane recallnet/astrochicken",
    },
    policy: {
      configPath: "factories/demo/factory.config.json",
      policyPackDir: "factories/demo/policy-pack/v1",
      policyPackVersion: "v1",
      overrideKeys: ["factory.review.required_command", "factory.supervisor.max_review_retries"],
      policyFiles: ["reviewer-policy.json", "metadata.json", "supervisor-policy.json"],
    },
    artifactDefaults: {
      runsDir: ".hatch/demo/runs",
      trustDomain: "demo.local",
      trustRoles: ["demo.local.tool", "demo.local.codergen"],
      canonicalCheckoutPath: null,
      scheduledGraphs: ["factories/demo/graphs/daily_release_report.dot"],
    },
    telemetryDefaults: {
      dispatchLatencySloSeconds: null,
      maintenanceIntervalSeconds: null,
      conformanceEntrypoint: "factories/demo/scripts/run-conformance.sh",
      conformanceRunsDir: ".hatch/demo/runs",
      benchmarkTelemetryWarnOnly: false,
      benchmarkTelemetryExemptions: ["demo.perf.warn"],
    },
    privateExecutionGluePaths: [],
  });

  assert.equal(manifest.graphBindings[0].id, "goal_run");
  assert.deepEqual(manifest.policy.policyFiles, ["metadata.json", "reviewer-policy.json", "supervisor-policy.json"]);
});

test("exportFactoryCompositionManifestDocument renders canonical manifest envelope", () => {
  const manifest = exportFactoryCompositionManifestDocument({
    schemaVersion: "factory_composition_manifest/v1",
    factoryId: "mothership",
    compositionModel: "control_plane",
    manifestPath: "factories/mothership/inventory/factory-composition-manifest.v1.json",
    configPath: "factories/mothership/factory.config.json",
    registryPath: "factory-registry.json",
    dispatchGraphPath: "factories/mothership/graphs/factory_dispatch_reactor.dot",
    supervisorGraphPath: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    graphBindings: [],
    bootstrap: {
      readmePath: "factories/mothership/README.md",
      intentPath: "factories/mothership/INTENT.md",
      createEvolveDocPath: null,
      conformanceReadmePath: null,
      initCommand: "hatch factory init --id mothership --repo recallnet/astrochicken --control-plane recallnet/astrochicken",
    },
    policy: {
      configPath: "factories/mothership/factory.config.json",
      policyPackDir: "factories/mothership/policy-pack/v1",
      policyPackVersion: "v1",
      overrideKeys: [],
      policyFiles: ["metadata.json"],
    },
    artifactDefaults: {
      runsDir: ".hatch/mothership/runs",
      trustDomain: "mothership.local",
      trustRoles: ["mothership.local.tool"],
      canonicalCheckoutPath: "${HATCH_CANONICAL_CHECKOUT_PATH}",
      scheduledGraphs: [],
    },
    telemetryDefaults: {
      dispatchLatencySloSeconds: 15,
      maintenanceIntervalSeconds: 300,
      conformanceEntrypoint: "factories/mothership/scripts/run-conformance.sh",
      conformanceRunsDir: ".hatch/mothership/runs",
      benchmarkTelemetryWarnOnly: false,
      benchmarkTelemetryExemptions: [],
    },
    privateExecutionGluePaths: ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"],
  });

  assert.equal(manifest.schemaVersion, "factory_composition_manifest/v1");
  assert.equal(manifest.compositionModel, "control_plane");
});

test("stringifyFactoryCompositionManifestDocument returns deterministic JSON", () => {
  const rendered = stringifyFactoryCompositionManifestDocument({
    schemaVersion: "factory_composition_manifest/v1",
    factoryId: "demo",
    compositionModel: "thin_composition",
    manifestPath: "factories/demo/inventory/factory-composition-manifest.v1.json",
    configPath: "factories/demo/factory.config.json",
    registryPath: "factory-registry.json",
    dispatchGraphPath: "factories/demo/graphs/factory_supervisor_tick.dot",
    supervisorGraphPath: "factories/demo/graphs/factory_supervisor_tick.dot",
    graphBindings: [],
    bootstrap: {
      readmePath: "factories/demo/README.md",
      intentPath: null,
      createEvolveDocPath: null,
      conformanceReadmePath: null,
      initCommand: "hatch factory init --id demo --repo example-org/demo --control-plane recallnet/astrochicken",
    },
    policy: {
      configPath: "factories/demo/factory.config.json",
      policyPackDir: "factories/demo/policy-pack/v1",
      policyPackVersion: "v1",
      overrideKeys: [],
      policyFiles: [],
    },
    artifactDefaults: {
      runsDir: ".hatch/demo/runs",
      trustDomain: "demo.local",
      trustRoles: ["demo.local.tool"],
      canonicalCheckoutPath: null,
      scheduledGraphs: [],
    },
    telemetryDefaults: {
      dispatchLatencySloSeconds: null,
      maintenanceIntervalSeconds: null,
      conformanceEntrypoint: null,
      conformanceRunsDir: null,
      benchmarkTelemetryWarnOnly: false,
      benchmarkTelemetryExemptions: [],
    },
    privateExecutionGluePaths: [],
  });

  assert.match(rendered, /"schemaVersion": "factory_composition_manifest\/v1"/);
  assert.match(rendered, /"factoryId": "demo"/);
});
