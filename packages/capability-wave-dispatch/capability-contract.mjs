import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({
  packageName: "@hatch/capability-wave-dispatch",
  capabilityId: "wave_dispatch",
  version: "0.1.0",
  title: "Wave Dispatch Capability",
  description: "Lease, sanitize, select, and ready-marker creation graph.",
  sourcePath: "packages/capability-wave-dispatch/capability-contract.mjs",
  outputPath: "packages/capability-wave-dispatch/capability-contract.v1.json",
  reusableAcrossFactories: true,
  privateGlueRequired: false,
  entrypoints: [
    {
      id: "wave_dispatch",
      title: "Wave dispatch graph",
      transport: "sync",
      kind: "graph",
      path: "workflows/wave_dispatch/wave_dispatch.workflow-source.mjs",
      description: "Selects wave-ready work under lease and concurrency policy.",
    },
  ],
  outputSurfaces: {
    events: [
      {
        id: "wave_ready_lease_events",
        title: "Wave ready lease CloudEvents",
        description: "Wave dispatch emits and consumes the governed lease lifecycle CloudEvent surface.",
        standard: "cloudevents",
        ref: "https://recallnet.dev/contracts/cloudevents/wave-ready-lease.v1.json",
        producerPaths: [
          "workflows/wave_dispatch/wave_dispatch.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    artifacts: [
      {
        id: "judge_followup_bug_issue",
        title: "Judge follow-up bug issue artifact",
        description: "Escalates judge follow-up failures through the canonical bug issue artifact path when dispatch requeue handling requires it.",
        standard: "platform_contract_artifact",
        ref: "judge_followup_bug_issue/v1",
        producerPaths: [
          "workflows/wave_dispatch/wave_dispatch.workflow-source.mjs",
          "src/in-process-action-owners.mjs",
        ],
      },
    ],
    telemetry: [
      {
        id: "workflow_runtime",
        title: "Workflow runtime telemetry",
        description: "Wave dispatch runs emit the standard Hatch workflow lifecycle and quality signals.",
        standard: "otel_runtime",
        ref: "hatch.workflow.lifecycle",
        producerPaths: ["workflows/wave_dispatch/wave_dispatch.workflow-source.mjs"],
      },
    ],
  },
  sourceFileOutputCoverage: [
    {
      path: "src/in-process-action-owners.mjs",
      refs: [
        "https://recallnet.dev/contracts/cloudevents/wave-ready-lease.v1.json",
        "judge_followup_bug_issue/v1",
      ],
    },
  ],
  requiredContextKeys: [
    "gh_repo",
    "factory_id",
    "factory_root",
    "trust_domain",
    "trust_role",
    "max_concurrent_waves",
  ],
  requiredRoles: [],
  requiredHandlers: ["tool"],
});
