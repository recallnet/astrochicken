import { defineWorkflowSourceModule } from "../../../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule({
  workflowId: "daily_lens_publish",
  familyId: "daily_reporting",
  title: "Daily lens publish",
  description: "Typed source for the mothership daily lens publishing schedule graph.",
  sourcePath: "factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs",
  runtimeGraphPath: "factories/mothership/graphs/daily_lens_publish.dot",
  jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
  imports: [
    "../roles.stylesheet"
  ],
  graphAttributes: {
    workdir: "."
  },
  sourceMap: {
    graphName: "daily_lens_publish",
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
        sourceNodeId: "set_date",
        runtimeNodeId: "set_date"
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
        sourceNodeId: "set_window_start",
        runtimeNodeId: "set_window_start"
      },
      {
        sourceNodeId: "set_window_end",
        runtimeNodeId: "set_window_end"
      },
      {
        sourceNodeId: "set_output_dir",
        runtimeNodeId: "set_output_dir"
      },
      {
        sourceNodeId: "set_runs_dir",
        runtimeNodeId: "set_runs_dir"
      },
      {
        sourceNodeId: "set_repo_path",
        runtimeNodeId: "set_repo_path"
      },
      {
        sourceNodeId: "set_issue_labels_json",
        runtimeNodeId: "set_issue_labels_json"
      },
      {
        sourceNodeId: "set_notify_slack",
        runtimeNodeId: "set_notify_slack"
      },
      {
        sourceNodeId: "prepare_daily_lens",
        runtimeNodeId: "prepare_daily_lens"
      },
      {
        sourceNodeId: "load_daily_lens_analysis_prompt",
        runtimeNodeId: "load_daily_lens_analysis_prompt"
      },
      {
        sourceNodeId: "analyze_daily_lens",
        runtimeNodeId: "analyze_daily_lens"
      },
      {
        sourceNodeId: "finalize_daily_lens",
        runtimeNodeId: "finalize_daily_lens"
      },
      {
        sourceNodeId: "generate_followup_candidates",
        runtimeNodeId: "generate_followup_candidates"
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
      id: "set_date",
      kind: "tool_action",
      title: "Bind report date",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "date"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${date}",
        action_fallback: "",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_repo",
      kind: "tool_action",
      title: "Bind report repo",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "repo"
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
      id: "set_window_start",
      kind: "tool_action",
      title: "Bind window start",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "window_start"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${window_start}",
        action_fallback: "",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_window_end",
      kind: "tool_action",
      title: "Bind window end",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "window_end"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${window_end}",
        action_fallback: "",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_output_dir",
      kind: "tool_action",
      title: "Bind output dir",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "output_dir"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${output_dir}",
        action_fallback: "reports/lens",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_runs_dir",
      kind: "tool_action",
      title: "Bind runs dir",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "runs_dir"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${runs_dir}",
        action_fallback: ".hatch/runs",
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
      id: "set_issue_labels_json",
      kind: "tool_action",
      title: "Bind issue labels",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "issue_labels_json"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${issue_labels_json}",
        action_fallback: "[\"daily-lens\"]",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "set_notify_slack",
      kind: "tool_action",
      title: "Bind Slack notify flag",
      handlerType: "tool",
      actionId: "common.resolve_default",
      binding: {
        outputKey: "notify_slack"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_value: "${notify_slack}",
        action_fallback: "false",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "prepare_daily_lens",
      kind: "tool_action",
      title: "Prepare Daily Lens bundle",
      handlerType: "tool",
      actionId: "daily_lens.prepare",
      binding: {
        outputFormat: "json",
        outputs: [
          "ok",
          "date",
          "repo",
          "factory_id",
          "window_start",
          "window_end",
          "bundle_path",
          "bundle_manifest_path",
          "analysis_output_path",
          "output_dir",
          "issue_labels_json",
          "notify_slack"
        ]
      },
      policy: {
        governance: "irreversible",
        timeout: "10m",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_date: "${date}",
        action_repo: "${repo}",
        action_factory_id: "${factory_id}",
        action_output_dir: "${output_dir}",
        action_window_start: "${window_start}",
        action_window_end: "${window_end}",
        action_runs_dir: "${runs_dir}",
        action_repo_path: "${repo_path}",
        action_run_id: "${__run_id}",
        action_issue_labels_json: "${issue_labels_json}",
        action_notify_slack: "${notify_slack}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "load_daily_lens_analysis_prompt",
      kind: "tool_action",
      title: "Load Daily Lens analysis prompt",
      prompt: "cat packages/factory-prompts/prompts/daily_lens/agent_analysis.md",
      handlerType: "tool",
      binding: {
        outputKey: "daily_lens_analysis_prompt"
      },
      policy: {
        governance: "reversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "analyze_daily_lens",
      kind: "llm_prompt",
      title: "Analyze Daily Lens bundle",
      roleClass: "knowledge_worker",
      prompt: "${daily_lens_analysis_prompt}\n\nExecution context JSON:\n{\"date\":\"${date}\",\"repo\":\"${repo}\",\"factory_id\":\"${factory_id}\",\"window_start\":\"${window_start}\",\"window_end\":\"${window_end}\",\"bundle_manifest_path\":\"${bundle_manifest_path}\",\"bundle_path\":\"${bundle_path}\",\"analysis_output_path\":\"${analysis_output_path}\"}\n\nUse tools to inspect the bundle files and write the final JSON analysis file.\nReturn JSON only.",
      handlerType: "agent.kw",
      binding: {
        outputKey: "daily_lens_agent_result",
        outputFormat: "json",
        outputs: [
          "ok",
          "analysis_path",
          "summary"
        ]
      },
      policy: {
        governance: "reversible",
        timeout: "45m",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        benchmark_job_id: "daily_lens.graph.analysis",
        llm_path_id: "mothership.daily_lens.analysis",
        prompt_version: "2026-03-17.r2",
        role_version: "1.0.0",
        skill_id: "daily_lens.analysis",
        session_id: "daily-lens-${factory_id}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.codergen"
      }
    },
    {
      id: "finalize_daily_lens",
      kind: "tool_action",
      title: "Finalize Daily Lens artifacts and publication",
      handlerType: "tool",
      actionId: "daily_lens.finalize",
      binding: {
        outputFormat: "json",
        outputs: [
          "ok",
          "scheduled_job_issue_url",
          "scheduled_job_issue_number"
        ]
      },
      policy: {
        governance: "irreversible",
        timeout: "10m",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_date: "${date}",
        action_repo: "${repo}",
        action_factory_id: "${factory_id}",
        action_output_dir: "${output_dir}",
        action_bundle_path: "${bundle_path}",
        action_analysis_path: "${analysis_output_path}",
        action_window_start: "${window_start}",
        action_window_end: "${window_end}",
        action_notify_slack: "${notify_slack}",
        action_issue_labels_json: "${issue_labels_json}",
        action_run_id: "${__run_id}",
        action_agent_result_json: "${daily_lens_agent_result}",
        action_skip_followup_candidates: "true",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    },
    {
      id: "generate_followup_candidates",
      kind: "tool_action",
      title: "Generate Daily Lens follow-up candidates",
      handlerType: "tool",
      actionId: "daily_lens.generate_followup_candidates",
      binding: {
        outputFormat: "json",
        outputs: [
          "ok",
          "created_count",
          "updated_count"
        ]
      },
      policy: {
        governance: "irreversible",
        recoveryOwner: "supervisor"
      },
      dotAttributes: {
        action_runtime: "in_process",
        action_repo: "${repo}",
        action_report_issue_number: "${scheduled_job_issue_number}",
        action_analysis_path: "${analysis_output_path}",
        action_run_id: "${__run_id}",
        action_factory_id: "${factory_id}",
        trust_domain: "mothership.local",
        trust_role: "mothership.local.tool"
      }
    }
  ],
  edges: [
    {
      from: "start",
      to: "set_date"
    },
    {
      from: "set_date",
      to: "set_repo"
    },
    {
      from: "set_repo",
      to: "set_factory_id"
    },
    {
      from: "set_factory_id",
      to: "set_window_start"
    },
    {
      from: "set_window_start",
      to: "set_window_end"
    },
    {
      from: "set_window_end",
      to: "set_output_dir"
    },
    {
      from: "set_output_dir",
      to: "set_runs_dir"
    },
    {
      from: "set_runs_dir",
      to: "set_repo_path"
    },
    {
      from: "set_repo_path",
      to: "set_issue_labels_json"
    },
    {
      from: "set_issue_labels_json",
      to: "set_notify_slack"
    },
    {
      from: "set_notify_slack",
      to: "prepare_daily_lens"
    },
    {
      from: "prepare_daily_lens",
      to: "load_daily_lens_analysis_prompt"
    },
    {
      from: "load_daily_lens_analysis_prompt",
      to: "analyze_daily_lens"
    },
    {
      from: "analyze_daily_lens",
      to: "finalize_daily_lens"
    },
    {
      from: "finalize_daily_lens",
      to: "generate_followup_candidates"
    },
    {
      from: "generate_followup_candidates",
      to: "done"
    }
  ]
});
