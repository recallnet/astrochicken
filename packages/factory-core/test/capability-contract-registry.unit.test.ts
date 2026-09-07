import test from "node:test";
import assert from "node:assert/strict";

import {
  defineCapabilitySurface,
  exportCapabilityContractDocument,
  exportCapabilityManifestDocument,
  stringifyCapabilityContractDocument,
  stringifyCapabilityManifestDocument,
} from "../src/capability-contract-registry.ts";

test("defineCapabilitySurface normalizes capability contract metadata", () => {
  const surface = defineCapabilitySurface({
    packageName: "@hatch/capability-demo",
    capabilityId: "demo",
    version: "0.1.0",
    title: "Demo Capability",
    description: "Reusable demo capability",
    sourcePath: "packages/capability-demo/capability-contract.mjs",
    outputPath: "packages/capability-demo/capability-contract.v1.json",
    entrypoints: [
      {
        id: "demo_graph",
        title: "Demo graph",
        transport: "sync",
        kind: "graph",
        path: "graphs/demo.dot",
      },
    ],
    outputSurfaces: {
      artifacts: [
        {
          id: "demo_artifact",
          title: "Demo artifact",
          standard: "platform_contract_artifact",
          ref: "demo_artifact/v1",
          producerPaths: ["graphs/demo.dot"],
        },
      ],
      telemetry: [
        {
          id: "workflow_runtime",
          title: "Workflow runtime telemetry",
          standard: "otel_runtime",
          ref: "hatch.workflow.lifecycle",
          producerPaths: ["graphs/demo.dot"],
        },
      ],
    },
    sourceFileOutputCoverage: [
      {
        path: "src/in-process-action-owners.mjs",
        refs: ["demo_artifact/v1", "hatch.workflow.lifecycle"],
      },
    ],
    skillPaths: ["skills/demo/SKILL.md"],
    requiredContextKeys: ["repo", "factory_id"],
    requiredRoles: [".demo"],
    requiredHandlers: ["tool"],
  });

  assert.equal(surface.packageName, "@hatch/capability-demo");
  assert.equal(surface.entrypoints[0].path, "graphs/demo.dot");
  assert.equal(surface.outputSurfaces.artifacts[0].ref, "demo_artifact/v1");
  assert.deepEqual(surface.sourceFileOutputCoverage[0].refs, ["demo_artifact/v1", "hatch.workflow.lifecycle"]);
  assert.deepEqual(surface.requiredContextKeys, ["factory_id", "repo"]);
});

test("exportCapabilityContractDocument renders the canonical capability contract envelope", () => {
  const surface = defineCapabilitySurface({
    packageName: "@hatch/capability-demo",
    capabilityId: "demo",
    version: "0.1.0",
    title: "Demo Capability",
    sourcePath: "packages/capability-demo/capability-contract.mjs",
    outputPath: "packages/capability-demo/capability-contract.v1.json",
    entrypoints: [
      {
        id: "demo_module",
        title: "Demo module",
        transport: "sync",
        kind: "module",
        path: ".",
      },
    ],
  });

  const document = exportCapabilityContractDocument(surface);
  assert.equal(document.schemaVersion, "capability_contract/v1");
  assert.equal(document.entrypoints[0].kind, "module");
  assert.deepEqual(document.outputSurfaces, { artifacts: [], events: [], telemetry: [] });
  assert.deepEqual(document.sourceFileOutputCoverage, []);
  assert.equal(document.privateGlueRequired, false);
});

test("stringifyCapabilityContractDocument returns deterministic JSON", () => {
  const surface = defineCapabilitySurface({
    packageName: "@hatch/capability-demo",
    capabilityId: "demo",
    version: "0.1.0",
    title: "Demo Capability",
    sourcePath: "packages/capability-demo/capability-contract.mjs",
    outputPath: "packages/capability-demo/capability-contract.v1.json",
    entrypoints: [],
  });

  const rendered = stringifyCapabilityContractDocument(surface);
  assert.match(rendered, /"schemaVersion": "capability_contract\/v1"/);
  assert.match(rendered, /"packageName": "@hatch\/capability-demo"/);
});

test("exportCapabilityManifestDocument renders generated manifest metadata from source + package surfaces", () => {
  const surface = defineCapabilitySurface({
    packageName: "@hatch/capability-demo",
    capabilityId: "demo",
    version: "0.1.0",
    title: "Demo Capability",
    description: "Reusable demo capability",
    sourcePath: "packages/capability-demo/capability-contract.mjs",
    outputPath: "packages/capability-demo/capability-contract.v1.json",
    entrypoints: [
      {
        id: "demo_graph",
        title: "Demo graph",
        transport: "sync",
        kind: "graph",
        path: "graphs/demo.dot",
      },
    ],
    outputSurfaces: {
      telemetry: [
        {
          id: "workflow_runtime",
          title: "Workflow runtime telemetry",
          standard: "otel_runtime",
          ref: "hatch.workflow.lifecycle",
          producerPaths: ["graphs/demo.dot", "src/in-process-action-owners.mjs"],
        },
      ],
    },
    sourceFileOutputCoverage: [
      {
        path: "src/in-process-action-owners.mjs",
        refs: ["hatch.workflow.lifecycle"],
      },
    ],
    skillPaths: ["skills/demo/SKILL.md"],
    requiredContextKeys: ["repo", "factory_id"],
    requiredRoles: [".demo"],
    requiredHandlers: ["tool"],
  });

  const document = exportCapabilityManifestDocument(surface, {
    packageRoot: "packages/capability-demo",
    manifestPath: "packages/capability-demo/capability-manifest.v1.json",
    contractPath: "packages/capability-demo/capability-contract.v1.json",
    packageJsonPath: "packages/capability-demo/package.json",
    packageMetadata: {
      description: "Demo package description",
      exports: { "./contract": "./capability-contract.v1.json", "./manifest": "./capability-manifest.v1.json" },
      files: ["graphs", "capability-contract.v1.json", "capability-manifest.v1.json"],
    },
    graphPaths: ["graphs/demo.dot"],
    skillPaths: ["skills/demo/SKILL.md"],
    supportFilePaths: ["src/in-process-action-owners.mjs"],
    producerPaths: ["graphs/demo.dot", "src/in-process-action-owners.mjs"],
  });

  assert.equal(document.schemaVersion, "capability_manifest/v1");
  assert.equal(document.contractPath, "packages/capability-demo/capability-contract.v1.json");
  assert.equal(document.manifestPath, "packages/capability-demo/capability-manifest.v1.json");
  assert.deepEqual(document.discoveredSurfaces.graphs, ["graphs/demo.dot"]);
  assert.deepEqual(document.discoveredSurfaces.producerPaths, ["graphs/demo.dot", "src/in-process-action-owners.mjs"]);
  assert.deepEqual(document.sourceFileOutputCoverage, [
    {
      path: "src/in-process-action-owners.mjs",
      refs: ["hatch.workflow.lifecycle"],
    },
  ]);
});

test("stringifyCapabilityManifestDocument returns deterministic JSON", () => {
  const surface = defineCapabilitySurface({
    packageName: "@hatch/capability-demo",
    capabilityId: "demo",
    version: "0.1.0",
    title: "Demo Capability",
    sourcePath: "packages/capability-demo/capability-contract.mjs",
    outputPath: "packages/capability-demo/capability-contract.v1.json",
    entrypoints: [],
  });

  const rendered = stringifyCapabilityManifestDocument(surface, {
    packageRoot: "packages/capability-demo",
    manifestPath: "packages/capability-demo/capability-manifest.v1.json",
    contractPath: "packages/capability-demo/capability-contract.v1.json",
    packageJsonPath: "packages/capability-demo/package.json",
  });

  assert.match(rendered, /"schemaVersion": "capability_manifest\/v1"/);
  assert.match(rendered, /"manifestPath": "packages\/capability-demo\/capability-manifest\.v1\.json"/);
});
