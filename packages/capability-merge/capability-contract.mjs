import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-merge",
  capabilityId: "merge",
  version: "0.1.0",
  title: "Merge Capability",
  description: "Rebase, deterministic merge, and conflict-resolution graph plus skill bundle.",
  sourcePath: "packages/capability-merge/capability-contract.mjs",
  outputPath: "packages/capability-merge/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "merge_item",
      title: "Merge item graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/merge_item/merge_item.workflow-source.mjs",
      description: "Resolves merge items through deterministic merge and conflict handling.",
    },
  ],
  outputSurfaces: {
    artifacts: [
      {
        id: "merge_conflict_packet",
        title: "Merge conflict packet artifact",
        description: "Builds the canonical merge conflict packet for deterministic resolver handoff.",
        standard: "platform_contract_artifact",
        ref: "merge_conflict_packet/v1",
        producerPaths: [
          "workflows/merge_item/merge_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
      {
        id: "merge_report",
        title: "Merge report artifact",
        description: "Builds the canonical merge report artifact after deterministic merge processing.",
        standard: "platform_contract_artifact",
        ref: "merge_report/v1",
        producerPaths: [
          "workflows/merge_item/merge_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Merge runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/merge_item/merge_item.workflow-source.mjs"],
      },
      {
        id: "merge_resolution_failure",
        title: "Merge resolution failure telemetry",
        description: "Emits the canonical merge failure telemetry signal when deterministic resolution fails.",
        standard: "otel_event",
        ref: "hatch.merge_resolution_failure",
        producerPaths: [
          "workflows/merge_item/merge_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [
        "hatch.merge_resolution_failure",
        "merge_conflict_packet/v1",
        "merge_report/v1",
      ],
    },
  ],
  skillPaths: ["skills/merge_conflict_resolver/SKILL.md"],
  requiredContextKeys: [
    "merge_item",
    "repo",
    "branch",
    "issue_number",
    "factory_id",
    "gh_repo",
    "control_plane_repo",
    "integration_command",
    "capability_merge_skills",
    "trust_domain",
    "trust_role",
  ],
  requiredRoles: [".merge_resolver"],
  requiredHandlers: ["tool", "agent.worktree"],
});
