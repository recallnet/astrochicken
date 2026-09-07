import { defineBoundarySchema, exportBoundaryJsonSchema, stringifySchemaDocument, z } from "./schema-registry.ts";

const nonEmptyStringSchema = z.string().trim().min(1);

const workflowSourceBindingSchema = z.object({
  outputKey: nonEmptyStringSchema.optional(),
  outputFormat: nonEmptyStringSchema.optional(),
  outputs: z.array(nonEmptyStringSchema).optional(),
  payload: nonEmptyStringSchema.optional(),
  raw: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

const workflowSourcePolicySchema = z.object({
  governance: nonEmptyStringSchema.optional(),
  timeout: nonEmptyStringSchema.optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  retryTarget: nonEmptyStringSchema.optional(),
  fallbackRetryTarget: nonEmptyStringSchema.optional(),
  recoveryOwner: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

const workflowSourceCompositionSchema = z.object({
  templateWorkflowRef: nonEmptyStringSchema.optional(),
  workflowRef: nonEmptyStringSchema.optional(),
  templateRuntimeGraphPath: nonEmptyStringSchema.optional(),
  workflowRuntimeGraphPath: nonEmptyStringSchema.optional(),
  sourceKey: nonEmptyStringSchema.optional(),
  itemKey: nonEmptyStringSchema.optional(),
  maxConcurrency: z.number().int().nonnegative().optional(),
  bindings: z.record(z.string(), nonEmptyStringSchema).optional(),
}).catchall(z.unknown());

const workflowSourceRuntimeSurfaceSchema = z.object({
  id: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  when: nonEmptyStringSchema,
  description: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

const workflowSourceNodeSchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.enum([
    "start",
    "terminal",
    "llm_prompt",
    "tool_action",
    "decision",
    "dynamic_fan_out",
    "detached_fan_out",
    "dynamic_fan_in",
    "pipeline",
  ]),
  title: nonEmptyStringSchema.optional(),
  description: nonEmptyStringSchema.optional(),
  roleClass: nonEmptyStringSchema.optional(),
  prompt: nonEmptyStringSchema.optional(),
  handlerType: nonEmptyStringSchema.optional(),
  actionId: nonEmptyStringSchema.optional(),
  toolId: nonEmptyStringSchema.optional(),
  dotAttributes: z.record(z.string(), z.unknown()).optional(),
  binding: workflowSourceBindingSchema.optional(),
  policy: workflowSourcePolicySchema.optional(),
  composition: workflowSourceCompositionSchema.optional(),
}).catchall(z.unknown());

const workflowSourceEdgeSchema = z.object({
  from: nonEmptyStringSchema,
  to: nonEmptyStringSchema,
  condition: nonEmptyStringSchema.optional(),
  label: nonEmptyStringSchema.optional(),
  dotAttributes: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown());

const workflowSourceNodeMappingSchema = z.object({
  sourceNodeId: nonEmptyStringSchema,
  runtimeNodeId: nonEmptyStringSchema,
}).catchall(z.unknown());

export const workflowSourceModuleDocumentSchema = z.object({
  schemaVersion: z.literal("workflow_source_module/v1"),
  workflowId: nonEmptyStringSchema,
  familyId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema.optional(),
  sourcePath: nonEmptyStringSchema,
  runtimeGraphPath: nonEmptyStringSchema,
  jsonSchemaOutputPath: nonEmptyStringSchema,
  imports: z.array(nonEmptyStringSchema).optional(),
  graphAttributes: z.record(z.string(), z.unknown()).optional(),
  sourceMap: z.object({
    graphName: nonEmptyStringSchema,
    nodeMappings: z.array(workflowSourceNodeMappingSchema).min(1),
    debugRules: z.array(nonEmptyStringSchema).optional(),
  }).catchall(z.unknown()),
  invariants: z.object({
    mustPreserve: z.array(nonEmptyStringSchema).min(1),
    mayNormalize: z.array(nonEmptyStringSchema).min(1),
  }).catchall(z.unknown()),
  sourceOwnership: z.object({
    canonicalAuthoringSurface: z.literal("typed_workflow_source"),
    runtimeIr: z.enum(["handwritten_dot_until_phase_9_2", "generated_dot_runtime_ir"]),
  }).catchall(z.unknown()).optional(),
  artifacts: z.array(workflowSourceRuntimeSurfaceSchema).optional(),
  events: z.array(workflowSourceRuntimeSurfaceSchema).optional(),
  nodes: z.array(workflowSourceNodeSchema).min(2),
  edges: z.array(workflowSourceEdgeSchema).min(1),
}).catchall(z.unknown());

export const WORKFLOW_SOURCE_MODULE_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: "https://recallnet.dev/contracts/workflow-source-module.v1.schema.json",
  version: "workflow_source_module/v1",
  title: "Typed Workflow Source Module",
  description: "Canonical schema-backed typed workflow authoring document for migrated workflow families before DOT generation/parity enforcement lands.",
  schema: workflowSourceModuleDocumentSchema,
  sourcePath: "packages/factory-core/src/workflow-source-registry.ts",
  outputPath: "docs/contracts/workflow-source-module.v1.schema.json",
});

function sortStrings(values: string[] = []): string[] {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sortNodeMappings(values: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...values].sort((left, right) => {
    const leftKey = `${left.sourceNodeId}::${left.runtimeNodeId}`;
    const rightKey = `${right.sourceNodeId}::${right.runtimeNodeId}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortNodes(values: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...values].sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
}

function sortEdges(values: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...values].sort((left, right) => {
    const leftKey = `${left.from}::${left.to}::${left.condition || ""}::${left.label || ""}`;
    const rightKey = `${right.from}::${right.to}::${right.condition || ""}::${right.label || ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortRuntimeSurfaces(values: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...values].sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
}

function normalizeModule(definition: Record<string, unknown>): Record<string, unknown> {
  const sourceMap = definition.sourceMap as Record<string, unknown>;
  return {
    ...definition,
    sourceOwnership: definition.sourceOwnership || {
      canonicalAuthoringSurface: "typed_workflow_source",
      runtimeIr: "generated_dot_runtime_ir",
    },
    sourceMap: {
      ...sourceMap,
      nodeMappings: sortNodeMappings(sourceMap?.nodeMappings as Record<string, unknown>[] || []),
      debugRules: sortStrings(sourceMap?.debugRules as string[] || [
        "runtime graph name must match sourceMap.graphName",
        "runtime graph workflow_source attr must match sourcePath",
        "runtime node ids must remain traceable to sourceMap.nodeMappings",
      ]),
    },
    invariants: {
      mustPreserve: sortStrings((definition.invariants as Record<string, unknown>)?.mustPreserve as string[] || []),
      mayNormalize: sortStrings((definition.invariants as Record<string, unknown>)?.mayNormalize as string[] || []),
    },
    artifacts: sortRuntimeSurfaces(definition.artifacts as Record<string, unknown>[] || []),
    events: sortRuntimeSurfaces(definition.events as Record<string, unknown>[] || []),
    nodes: sortNodes(definition.nodes as Record<string, unknown>[] || []),
    edges: sortEdges(definition.edges as Record<string, unknown>[] || []),
  };
}

export function defineWorkflowSourceModule(definition: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeModule({
    schemaVersion: "workflow_source_module/v1",
    ...definition,
  });
  return workflowSourceModuleDocumentSchema.parse(normalized) as Record<string, unknown>;
}

export function exportWorkflowSourceDocument(definition: Record<string, unknown>): Record<string, unknown> {
  return defineWorkflowSourceModule(definition);
}

export function stringifyWorkflowSourceDocument(definition: Record<string, unknown>): string {
  return `${JSON.stringify(exportWorkflowSourceDocument(definition), null, 2)}\n`;
}

export function exportWorkflowSourceModuleJsonSchema(): Record<string, unknown> {
  return exportBoundaryJsonSchema(WORKFLOW_SOURCE_MODULE_BOUNDARY_SCHEMA);
}

export function stringifyWorkflowSourceModuleJsonSchema(): string {
  return stringifySchemaDocument(exportWorkflowSourceModuleJsonSchema());
}
