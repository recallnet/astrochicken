import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-brainstorming",
  capabilityId: "brainstorming",
  version: "0.1.0",
  title: "Brainstorming Capability",
  description: "Multi-agent red/blue deliberation graph and skill bundle.",
  sourcePath: "packages/capability-brainstorming/capability-contract.mjs",
  outputPath: "packages/capability-brainstorming/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "brainstorm",
      title: "Brainstorm graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/brainstorm/brainstorm.workflow-source.mjs",
      description: "Runs red/blue brainstorming over backlog and scenario inputs.",
    },
  ],
  outputSurfaces: {
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Brainstorming runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/brainstorm/brainstorm.workflow-source.mjs"],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [],
    },
  ],
  skillPaths: [
    "skills/red_strategist/SKILL.md",
    "skills/blue_strategist/SKILL.md",
  ],
  requiredContextKeys: [
    "brainstorm_issue_number",
    "brainstorm_issue_body",
    "gh_repo",
    "repo",
    "intent_stack",
    "shipped_goals_since_last",
    "open_backlog_summary",
    "scenario_holdouts",
    "capability_brainstorming_skills",
    "trust_domain",
    "trust_role",
    "factory_root",
  ],
  requiredRoles: [".red_strategist", ".blue_strategist"],
  requiredHandlers: ["agent.kw", "tool"],
});
