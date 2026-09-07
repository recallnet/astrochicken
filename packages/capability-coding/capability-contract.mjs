import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-coding",
  capabilityId: "coding",
  version: "0.1.0",
  title: "Coding Capability",
  description: "Code implementation and review graph plus skill bundle.",
  sourcePath: "packages/capability-coding/capability-contract.mjs",
  outputPath: "packages/capability-coding/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "issue_execute_item",
      title: "Issue execute item graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/issue_execute_item/issue_execute_item.workflow-source.mjs",
      description: "Runs coding and review for a single issue item.",
    },
  ],
  outputSurfaces: {
    artifacts: [
      {
        id: "review_evidence",
        title: "Review evidence artifact",
        description: "Persists the canonical issue review evidence artifact for deterministic review routing.",
        standard: "platform_contract_artifact",
        ref: "review_evidence/v1",
        producerPaths: [
          "workflows/issue_execute_item/issue_execute_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
      {
        id: "reviewer_context",
        title: "Reviewer context contract artifact",
        description: "Persists the canonical reviewer context contract consumed by the reviewer session.",
        standard: "platform_contract_artifact",
        ref: "reviewer_context/v1",
        producerPaths: [
          "workflows/issue_execute_item/issue_execute_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Issue execution runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/issue_execute_item/issue_execute_item.workflow-source.mjs"],
      },
      {
        id: "review_verdict",
        title: "Review verdict telemetry",
        description: "Emits the canonical review verdict telemetry signal from the governed reviewer path.",
        standard: "otel_event",
        ref: "hatch.review_verdict",
        producerPaths: [
          "workflows/issue_execute_item/issue_execute_item.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [
        "hatch.review_verdict",
        "review_evidence/v1",
        "reviewer_context/v1",
      ],
    },
  ],
  skillPaths: ["skills/code_review/SKILL.md"],
  requiredContextKeys: [
    "issue_item",
    "gh_repo",
    "repo",
    "branch",
    "issue_number",
    "issue_title",
    "intent_stack",
    "goal_issue_number",
    "goal_issue",
    "milestone_title",
    "review_qa_command",
    "integration_command",
    "capability_coding_skills",
    "trust_domain",
    "trust_role",
    "factory_root",
  ],
  requiredRoles: [".coder", ".reviewer"],
  requiredHandlers: ["agent.worktree", "codergen", "tool"],
});
