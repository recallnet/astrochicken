import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-product-judge",
  capabilityId: "product_judge",
  version: "0.1.0",
  title: "Product Judge Capability",
  description: "Post-merge alignment judgment graph.",
  sourcePath: "packages/capability-product-judge/capability-contract.mjs",
  outputPath: "packages/capability-product-judge/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "product_judge",
      title: "Product judge graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/product_judge/product_judge.workflow-source.mjs",
      description: "Judges post-merge product alignment for merge candidates.",
    },
  ],
  outputSurfaces: {
    artifacts: [
      {
        id: "judge_context",
        title: "Judge context contract artifact",
        description: "Persists the canonical judge context contract consumed by post-merge judgment.",
        standard: "platform_contract_artifact",
        ref: "judge_context/v1",
        producerPaths: [
          "workflows/product_judge/product_judge.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
      {
        id: "judge_evidence",
        title: "Judge evidence contract artifact",
        description: "Persists the canonical judge evidence contract backing product-judgment decisions.",
        standard: "platform_contract_artifact",
        ref: "judge_evidence/v1",
        producerPaths: [
          "workflows/product_judge/product_judge.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
      {
        id: "judge_recovery_packet",
        title: "Judge recovery packet artifact",
        description: "Builds the canonical recovery packet for failed product-judge flows.",
        standard: "platform_contract_artifact",
        ref: "judge_recovery_packet/v1",
        producerPaths: [
          "workflows/product_judge/product_judge.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
      {
        id: "judge_followup_bug_issue",
        title: "Judge follow-up bug issue artifact",
        description: "Emits the canonical fast-follow bug issue artifact when judge failures must be escalated.",
        standard: "platform_contract_artifact",
        ref: "judge_followup_bug_issue/v1",
        producerPaths: [
          "workflows/product_judge/product_judge.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Product judge runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/product_judge/product_judge.workflow-source.mjs"],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [
        "judge_context/v1",
        "judge_evidence/v1",
        "judge_followup_bug_issue/v1",
        "judge_recovery_packet/v1",
      ],
    },
  ],
  requiredContextKeys: [
    "merge_results",
    "merge_candidates",
    "milestone_title",
    "repo",
    "gh_repo",
    "factory_id",
    "control_plane_repo",
    "trust_domain",
    "trust_role",
  ],
  requiredRoles: [".post_merge_judge"],
  requiredHandlers: ["tool", "pipeline"],
});
