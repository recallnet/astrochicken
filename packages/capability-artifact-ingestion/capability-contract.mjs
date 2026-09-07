import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-artifact-ingestion",
  capabilityId: "artifact_ingestion",
  version: "0.1.0",
  title: "Artifact Ingestion Capability",
  description: "Poll artifact issues from source repos and draft goals in the control-plane repo.",
  sourcePath: "packages/capability-artifact-ingestion/capability-contract.mjs",
  outputPath: "packages/capability-artifact-ingestion/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "artifact_ingest",
      title: "Artifact ingest graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/artifact_ingest/artifact_ingest.workflow-source.mjs",
      description: "Ingests artifact issues and drafts control-plane goals.",
    },
  ],
  outputSurfaces: {
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Artifact ingestion runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/artifact_ingest/artifact_ingest.workflow-source.mjs"],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [],
    },
  ],
  requiredContextKeys: [
    "control_plane_repo",
    "source_repos",
    "max_artifacts",
    "trusted_factory_ids",
    "dry_run",
    "trust_domain",
    "trust_role",
  ],
  requiredRoles: [],
  requiredHandlers: ["tool"],
});
