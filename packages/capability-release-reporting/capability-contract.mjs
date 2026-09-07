import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-release-reporting",
  capabilityId: "release_reporting",
  version: "0.1.0",
  title: "Release Reporting Capability",
  description: "Release narration, Slack delivery, dedup, and tick-idle cursor updates.",
  sourcePath: "packages/capability-release-reporting/capability-contract.mjs",
  outputPath: "packages/capability-release-reporting/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "release_report_flow",
      title: "Release report flow graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/release_report_flow/release_report_flow.workflow-source.mjs",
      description: "Builds and publishes release reporting outputs.",
    },
  ],
  outputSurfaces: {
    artifacts: [
      {
        id: "release_report_bundle",
        title: "Release report OCI bundle",
        description: "Publishes the governed release report artifact through the canonical OCI helper surface.",
        standard: "oci_artifact_class",
        ref: "release_report_bundle",
        producerPaths: [
          "workflows/release_report_flow/release_report_flow.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Release reporting runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/release_report_flow/release_report_flow.workflow-source.mjs"],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/build-report-context.ts",
      refs: [],
    },
    {
      path: "src/in-process-action-owners.mjs",
      refs: ["release_report_bundle"],
    },
    {
      path: "src/release-action-contracts.ts",
      refs: [],
    },
  ],
  requiredContextKeys: [
    "gh_repo",
    "release_reporting_repo",
    "factory_id",
    "trust_domain",
    "trust_role",
  ],
  requiredRoles: [".release_narrator"],
  requiredHandlers: ["tool", "codergen"],
});
