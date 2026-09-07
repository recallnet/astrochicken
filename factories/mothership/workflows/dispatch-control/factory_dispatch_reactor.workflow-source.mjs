import { defineWorkflowSourceModule } from "../../../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule({
  workflowId: "factory_dispatch_reactor",
  familyId: "dispatch_control",
  title: "Factory dispatch reactor",
  description: "Typed source for the mothership dispatch reactor graph.",
  sourcePath: "factories/mothership/workflows/dispatch-control/factory_dispatch_reactor.workflow-source.mjs",
  runtimeGraphPath: "factories/mothership/graphs/factory_dispatch_reactor.dot",
  jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
  imports: [
    "../roles.stylesheet"
  ],
  graphAttributes: {
    typed_action_transport_mode: "enforced",
    workdir: "."
  },
  sourceMap: {
    graphName: "factory_dispatch_reactor",
    nodeMappings: [
      {
        sourceNodeId: "start",
        runtimeNodeId: "start"
      },
      {
        sourceNodeId: "done",
        runtimeNodeId: "done"
      },
      {
        sourceNodeId: "artifact_ingest",
        runtimeNodeId: "artifact_ingest"
      },
      {
        sourceNodeId: "auto_ready_artifact_goals",
        runtimeNodeId: "auto_ready_artifact_goals"
      },
      {
        sourceNodeId: "sanitize_goal_duplicates",
        runtimeNodeId: "sanitize_goal_duplicates"
      },
      {
        sourceNodeId: "sweep_completed_goals",
        runtimeNodeId: "sweep_completed_goals"
      },
      {
        sourceNodeId: "release_quarantine",
        runtimeNodeId: "release_quarantine"
      },
      {
        sourceNodeId: "set_gh_repo",
        runtimeNodeId: "set_gh_repo"
      },
      {
        sourceNodeId: "set_max_concurrent_waves_for_goal_execute",
        runtimeNodeId: "set_max_concurrent_waves_for_goal_execute"
      },
      {
        sourceNodeId: "resolve_dispatch_retry_backoff_seconds",
        runtimeNodeId: "resolve_dispatch_retry_backoff_seconds"
      },
      {
        sourceNodeId: "list_executable_goals",
        runtimeNodeId: "list_executable_goals"
      },
      {
        sourceNodeId: "goal_execute_gate",
        runtimeNodeId: "goal_execute_gate"
      },
      {
        sourceNodeId: "stamp_factory_contract_hash",
        runtimeNodeId: "stamp_factory_contract_hash"
      },
      {
        sourceNodeId: "spawn_goal_execute",
        runtimeNodeId: "spawn_goal_execute"
      }
    ],
    debugRules: [
      "Operators trace runtime node ids directly through sourceMap.nodeMappings.",
      "Generated runtime DOT remains the execution IR for this migrated workflow family.",
      "workflow_source graph attr points back to this module for source-of-truth lookup."
    ]
  },
  invariants: {
    mustPreserve: [
      "edge.condition",
      "edge.from",
      "edge.label",
      "edge.to",
      "graph.label",
      "graph.workflow_source",
      "node.id"
    ],
    mayNormalize: [
      "attribute_order",
      "comment_blocks",
      "whitespace"
    ]
  },
  sourceOwnership: {
    canonicalAuthoringSurface: "typed_workflow_source",
    runtimeIr: "generated_dot_runtime_ir"
  },
  nodes: [
    {
      id: "start",
      kind: "start",
      title: "Start",
      policy: {
        recoveryOwner: "dispatch_reactor"
      }
    },
    {
      id: "done",
      kind: "terminal",
      title: "Done",
      policy: {
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        recovery_sink_type: "terminal"
      }
    },
    {
      id: "artifact_ingest",
      kind: "pipeline",
      title: "Ingest artifacts",
      handlerType: "pipeline",
      policy: {
        recoveryOwner: "dispatch_reactor"
      },
      composition: {
        workflowRuntimeGraphPath: "packages/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs"
      },
      dotAttributes: {
        inherit_context: "true",
        fail_open: "true",
        export_keys: "artifact_ingest_result",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.pipeline"
      }
    },
    {
      id: "auto_ready_artifact_goals",
      kind: "tool_action",
      title: "Auto-ready artifact goals",
      handlerType: "tool",
      actionId: "goal.auto_ready_artifacts",
      binding: {
        outputKey: "__auto_ready_artifact_goals_result"
      },
      policy: {
        governance: "irreversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_repo: "${gh_repo}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "sanitize_goal_duplicates",
      kind: "tool_action",
      title: "Normalize goal duplicates",
      handlerType: "tool",
      actionId: "goal.sanitize_duplicates",
      binding: {
        outputKey: "__sanitize_goal_duplicates_result"
      },
      policy: {
        governance: "irreversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_repo: "${gh_repo}",
        action_run_id: "${__run_id}",
        action_pipeline: "factory_dispatch_reactor",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "sweep_completed_goals",
      kind: "tool_action",
      title: "Close goals with all sub-issues done",
      handlerType: "tool",
      actionId: "goal.sweep_completed",
      binding: {
        outputKey: "__sweep_completed_goals_result"
      },
      policy: {
        governance: "irreversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_repo: "${gh_repo}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "release_quarantine",
      kind: "tool_action",
      title: "Release expired quarantined issues",
      handlerType: "tool",
      actionId: "wave.release_quarantine",
      binding: {
        outputKey: "__release_quarantine_result"
      },
      policy: {
        governance: "irreversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_repo: "${gh_repo}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_gh_repo",
      kind: "tool_action",
      title: "Resolve GitHub repo",
      handlerType: "tool",
      actionId: "common.resolve_gh_repo",
      binding: {
        outputKey: "gh_repo"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_gh_repo: "${gh_repo}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_max_concurrent_waves_for_goal_execute",
      kind: "tool_action",
      title: "Resolve max concurrent waves for goal execution",
      handlerType: "tool",
      actionId: "common.resolve_factory_config",
      binding: {
        outputKey: "max_concurrent_waves_for_goal_execute"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_key: "max_concurrent_waves",
        action_fallback: "5",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "resolve_dispatch_retry_backoff_seconds",
      kind: "tool_action",
      title: "Resolve dispatch retry backoff seconds",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "dispatch_retry_backoff_seconds"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${dispatch_retry_backoff_seconds}",
        action_fallback: "60",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "list_executable_goals",
      kind: "tool_action",
      title: "List dispatched goals with open sub-issues (dedup against active runs)",
      handlerType: "tool",
      actionId: "software.list_executable_goals",
      binding: {
        outputFormat: "json",
        outputs: [
          "executable_goals",
          "count",
          "capped",
          "execution_capacity",
          "active_goal_count",
          "free_slots"
        ]
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_factory_id: "mothership",
        action_repo: "${gh_repo}",
        action_repo_root: "${repo}",
        action_max_concurrent: "${max_concurrent_waves_for_goal_execute}",
        action_runs_dir: "${runs_dir}",
        action_backoff_seconds: "${dispatch_retry_backoff_seconds}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "goal_execute_gate",
      kind: "decision",
      title: "Any executable goals?",
      policy: {
        recoveryOwner: "dispatch_reactor"
      }
    },
    {
      id: "stamp_factory_contract_hash",
      kind: "tool_action",
      title: "Stamp factory contract hash for drift detection",
      handlerType: "tool",
      actionId: "factory.stamp_contract_hash",
      binding: {
        outputKey: "factory_contract_sha256"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "dispatch_reactor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_factory_root: "factories/mothership",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "spawn_goal_execute",
      kind: "tool_action",
      title: "Spawn goal execution processes",
      handlerType: "fan_out.detached",
      binding: {
        outputKey: "spawned_goal_runs"
      },
      policy: {
        recoveryOwner: "dispatch_reactor"
      },
      composition: {
        sourceKey: "executable_goals",
        itemKey: "goal_issue_number",
        templateRuntimeGraphPath: "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs"
      },
      dotAttributes: {
        context_keys: "factory_contract_sha256",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.fan_out.detached"
      }
    }
  ],
  edges: [
    {
      from: "start",
      to: "set_gh_repo"
    },
    {
      from: "set_gh_repo",
      to: "artifact_ingest"
    },
    {
      from: "artifact_ingest",
      to: "auto_ready_artifact_goals"
    },
    {
      from: "auto_ready_artifact_goals",
      to: "sanitize_goal_duplicates"
    },
    {
      from: "sanitize_goal_duplicates",
      to: "sweep_completed_goals"
    },
    {
      from: "sweep_completed_goals",
      to: "release_quarantine"
    },
    {
      from: "release_quarantine",
      to: "set_max_concurrent_waves_for_goal_execute"
    },
    {
      from: "set_max_concurrent_waves_for_goal_execute",
      to: "resolve_dispatch_retry_backoff_seconds"
    },
    {
      from: "resolve_dispatch_retry_backoff_seconds",
      to: "list_executable_goals"
    },
    {
      from: "list_executable_goals",
      to: "goal_execute_gate"
    },
    {
      from: "goal_execute_gate",
      to: "stamp_factory_contract_hash",
      condition: "count!=0"
    },
    {
      from: "goal_execute_gate",
      to: "done",
      condition: "count=0"
    },
    {
      from: "stamp_factory_contract_hash",
      to: "spawn_goal_execute"
    },
    {
      from: "spawn_goal_execute",
      to: "done"
    }
  ]
});
