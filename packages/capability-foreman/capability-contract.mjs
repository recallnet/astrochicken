import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-foreman",
  capabilityId: "foreman",
  version: "0.1.0",
  title: "Foreman Capability",
  description: "Foreman host scheduling, incident ownership, telemetry, and extension-facing tool surfaces.",
  sourcePath: "packages/capability-foreman/capability-contract.mjs",
  outputPath: "packages/capability-foreman/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "foreman_module_api",
      title: "Foreman module surface",
      transport: "sync",
      kind: "module",
      path: ".",
      description: "Exports the foreman package runtime surface through the package root entrypoint.",
    },
  ],
  outputSurfaces: {
    artifacts: [
      {
        id: "foreman_cycle_artifact",
        title: "Foreman cycle artifact",
        description: "Writes the canonical foreman cycle history artifact under the run-scoped foreman directory.",
        standard: "platform_contract_artifact",
        ref: "foreman_cycle_artifact/v1",
        producerPaths: [
          "src/host.ts",
          "src/telemetry.ts",
        ],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "vitest.config.ts",
      refs: [],
    },
    {
      path: "src/extension.ts",
      refs: [],
    },
    {
      path: "src/host.ts",
      refs: ["foreman_cycle_artifact/v1"],
    },
    {
      path: "src/index.ts",
      refs: [],
    },
    {
      path: "src/telemetry.ts",
      refs: ["foreman_cycle_artifact/v1"],
    },
    {
      path: "src/types.ts",
      refs: [],
    },
  ],
  requiredContextKeys: ["factory_id", "foreman_config"],
  requiredRoles: [".foreman"],
  requiredHandlers: [],
});
