import type { WorkflowSourceEdge, WorkflowSourceModuleDefinition, WorkflowSourceNode } from "./workflow-source-registry";

export interface WorkflowIrDocumentDefinition {
  workflowId: string;
  familyId: string;
  sourcePath: string;
  runtimeGraphPath: string;
  outputPath?: string;
  compilerVersion: string;
  artifactRef: string;
  generatedFiles: string[];
  metadata: Record<string, unknown>;
  artifactClassDefinition?: Record<string, unknown>;
  dot?: string;
  imports?: string[];
  graphAttributes?: Record<string, unknown>;
  nodes?: WorkflowSourceNode[];
  edges?: WorkflowSourceEdge[];
}

export interface WorkflowIrDocument extends WorkflowIrDocumentDefinition {
  schemaVersion: "workflow_ir_document/v1";
  artifactClass: "workflow_ir_bundle";
  artifactVersion: "workflow_ir_bundle/v1";
  publicationPlan: Record<string, unknown>;
  dot: string;
}

export interface WorkflowSourceDotRenderable extends Pick<WorkflowSourceModuleDefinition, "workflowId" | "sourcePath" | "nodes" | "edges"> {
  imports?: string[];
  graphAttributes?: Record<string, unknown>;
}

export interface WorkflowSourceDotRenderOptions {
  hostPath?: string;
}

export function deriveWorkflowRuntimeDotPath(sourcePath: string, workflowId: string): string;
export function renderWorkflowSourceModuleToDot(definition: WorkflowSourceDotRenderable, options?: WorkflowSourceDotRenderOptions): string;
export function defineWorkflowIrModule(definition: WorkflowIrDocumentDefinition): WorkflowIrDocument;
export function exportWorkflowIrDocument(definition: WorkflowIrDocumentDefinition): WorkflowIrDocument;
export function stringifyWorkflowIrDocument(definition: WorkflowIrDocumentDefinition): string;
export function exportWorkflowIrDocumentJsonSchema(): Record<string, unknown>;
export function stringifyWorkflowIrDocumentJsonSchema(): string;
