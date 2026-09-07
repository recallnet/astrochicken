export interface WorkflowSourceBinding {
  outputKey?: string;
  outputFormat?: string;
  outputs?: string[];
  payload?: string;
  raw?: string;
}

export interface WorkflowSourcePolicy {
  governance?: string;
  timeout?: string;
  maxRetries?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  recoveryOwner?: string;
}

export interface WorkflowSourceComposition {
  templateWorkflowRef?: string;
  templateRuntimeGraphPath?: string;
  workflowRuntimeGraphPath?: string;
  workflowRef?: string;
  sourceKey?: string;
  itemKey?: string;
  maxConcurrency?: number;
  bindings?: Record<string, string>;
}

export interface WorkflowSourceRuntimeSurface {
  id: string;
  ref: string;
  when: string;
  description?: string;
}

export interface WorkflowSourceNode {
  id: string;
  kind:
    | "start"
    | "terminal"
    | "llm_prompt"
    | "tool_action"
    | "decision"
    | "dynamic_fan_out"
    | "detached_fan_out"
    | "dynamic_fan_in"
    | "pipeline";
  title?: string;
  description?: string;
  roleClass?: string;
  prompt?: string;
  handlerType?: string;
  actionId?: string;
  toolId?: string;
  binding?: WorkflowSourceBinding;
  policy?: WorkflowSourcePolicy;
  composition?: WorkflowSourceComposition;
  dotAttributes?: Record<string, unknown>;
}

export interface WorkflowSourceEdge {
  from: string;
  to: string;
  condition?: string;
  label?: string;
  dotAttributes?: Record<string, unknown>;
}

export interface WorkflowSourceNodeMapping {
  sourceNodeId: string;
  runtimeNodeId: string;
}

export interface WorkflowSourceModuleDefinition {
  workflowId: string;
  familyId: string;
  title: string;
  description?: string;
  sourcePath: string;
  runtimeGraphPath: string;
  jsonSchemaOutputPath: string;
  sourceMap: {
    graphName: string;
    nodeMappings: WorkflowSourceNodeMapping[];
    debugRules?: string[];
  };
  invariants: {
    mustPreserve: string[];
    mayNormalize: string[];
  };
  sourceOwnership?: {
    canonicalAuthoringSurface: "typed_workflow_source";
    runtimeIr: "handwritten_dot_until_phase_9_2" | "generated_dot_runtime_ir";
  };
  imports?: string[];
  graphAttributes?: Record<string, unknown>;
  artifacts?: WorkflowSourceRuntimeSurface[];
  events?: WorkflowSourceRuntimeSurface[];
  nodes: WorkflowSourceNode[];
  edges: WorkflowSourceEdge[];
}

export interface WorkflowSourceModule extends WorkflowSourceModuleDefinition {
  schemaVersion: "workflow_source_module/v1";
}

export function defineWorkflowSourceModule(definition: WorkflowSourceModuleDefinition): WorkflowSourceModule;
export function exportWorkflowSourceDocument(definition: WorkflowSourceModuleDefinition): WorkflowSourceModule;
export function stringifyWorkflowSourceDocument(definition: WorkflowSourceModuleDefinition): string;
export function exportWorkflowSourceModuleJsonSchema(): Record<string, unknown>;
export function stringifyWorkflowSourceModuleJsonSchema(): string;
