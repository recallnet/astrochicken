import { defineWorkflowSourceModule } from "../../../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule({
  workflowId: "daily_release_report",
  familyId: "daily_reporting",
  title: "Daily release report",
  description: "Typed source for the mothership scheduled daily release-report workflow.",
  sourcePath: "factories/mothership/workflows/daily-reporting/daily_release_report.workflow-source.mjs",
  runtimeGraphPath: "factories/mothership/graphs/daily_release_report.dot",
  jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
  imports: [
    "../roles.stylesheet"
  ],
  graphAttributes: {
    workdir: "."
  },
  sourceMap: {
    graphName: "daily_release_report",
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
        sourceNodeId: "set_repo",
        runtimeNodeId: "set_repo"
      },
      {
        sourceNodeId: "set_factory_id",
        runtimeNodeId: "set_factory_id"
      },
      {
        sourceNodeId: "set_repo_path",
        runtimeNodeId: "set_repo_path"
      },
      {
        sourceNodeId: "set_trust_domain",
        runtimeNodeId: "set_trust_domain"
      },
      {
        sourceNodeId: "set_trust_role",
        runtimeNodeId: "set_trust_role"
      },
      {
        sourceNodeId: "set_release_reporting_repo",
        runtimeNodeId: "set_release_reporting_repo"
      },
      {
        sourceNodeId: "run_release_report_flow",
        runtimeNodeId: "run_release_report_flow"
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
        recoveryOwner: "supervisor"
      }
    },
    {
      id: "done",
      kind: "terminal",
      title: "Done",
      policy: {
        recoveryOwner: "supervisor"
      }
    },
    {
      id: "set_repo",
      kind: "tool_action",
      title: "Bind report repo",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "gh_repo"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${repo}",
        action_fallback: "",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_factory_id",
      kind: "tool_action",
      title: "Bind factory id",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "factory_id"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${factory_id}",
        action_fallback: "mothership",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_repo_path",
      kind: "tool_action",
      title: "Bind repo path",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "repo_path"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${repo_path}",
        action_fallback: ".",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_trust_domain",
      kind: "tool_action",
      title: "Bind trust domain",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "trust_domain"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${trust_domain}",
        action_fallback: "mothership.local",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_trust_role",
      kind: "tool_action",
      title: "Bind trust role",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "trust_role"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${trust_role}",
        action_fallback: "mothership.local.tool",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_release_reporting_repo",
      kind: "tool_action",
      title: "Set release-reporting repo",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "release_reporting_repo"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${gh_repo}",
        action_fallback: "${gh_repo}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "run_release_report_flow",
      kind: "pipeline",
      title: "Run release reporting flow",
      handlerType: "pipeline",
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      composition: {
        workflowRuntimeGraphPath: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs"
      },
      dotAttributes: {
        context_keys: "release_reporting_repo",
        inherit_context: "true",
        fail_open: "true",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.pipeline"
      }
    }
  ],
  edges: [
    {
      from: "start",
      to: "set_repo"
    },
    {
      from: "set_repo",
      to: "set_factory_id"
    },
    {
      from: "set_factory_id",
      to: "set_repo_path"
    },
    {
      from: "set_repo_path",
      to: "set_trust_domain"
    },
    {
      from: "set_trust_domain",
      to: "set_trust_role"
    },
    {
      from: "set_trust_role",
      to: "set_release_reporting_repo"
    },
    {
      from: "set_release_reporting_repo",
      to: "run_release_report_flow"
    },
    {
      from: "run_release_report_flow",
      to: "done"
    }
  ]
});
