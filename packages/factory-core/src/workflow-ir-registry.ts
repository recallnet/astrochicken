import path from "node:path";

import {
  buildArtifactTrustBundle,
  buildArtifactVerificationRecord,
  buildCosignSignatureRecord,
  buildSlsaAttestation,
  buildSlsaProvenancePredicate,
  defineArtifactTrustPolicy,
} from "./artifact-trust-registry.ts";
import {
  buildOciSubjectReferrerRelation,
  buildOciArtifactPublicationPlan,
  z,
} from "./oci-artifact-registry.ts";
import {
  defineBoundarySchema,
  exportBoundaryJsonSchema,
  sortJson,
  stringifySchemaDocument,
} from "./schema-registry.ts";

const WORKFLOW_IR_BUNDLE_KEY = "workflow_ir_bundle";
const WORKFLOW_IR_BUNDLE_VERSION = "workflow_ir_bundle/v1";
const WORKFLOW_IR_BUNDLE_MEDIA_TYPE = "application/vnd.recallnet.factory.workflow-ir.bundle.v1";
const WORKFLOW_IR_DOCUMENT_SCHEMA_VERSION = "workflow_ir_document/v1";

const nonEmptyStringSchema = z.string().trim().min(1);

const workflowIrPublicationFileSchema = z.object({
  path: nonEmptyStringSchema,
  mediaType: nonEmptyStringSchema,
}).catchall(z.unknown());

const workflowIrPublicationPlanSchema = z.object({
  artifact_class: z.literal(WORKFLOW_IR_BUNDLE_KEY),
  artifact_ref: nonEmptyStringSchema,
  media_type: z.literal(WORKFLOW_IR_BUNDLE_MEDIA_TYPE),
  metadata: z.record(z.string(), z.unknown()),
  files: z.array(workflowIrPublicationFileSchema).min(1),
  lifecycle_policy: z.record(z.string(), z.unknown()).optional(),
  trust_policy: z.record(z.string(), z.unknown()).optional(),
  subject: z.record(z.string(), z.unknown()).optional(),
  args: z.array(nonEmptyStringSchema).min(1),
}).catchall(z.unknown());

export const workflowIrDocumentSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_IR_DOCUMENT_SCHEMA_VERSION),
  artifactClass: z.literal(WORKFLOW_IR_BUNDLE_KEY),
  artifactVersion: z.literal(WORKFLOW_IR_BUNDLE_VERSION),
  workflowId: nonEmptyStringSchema,
  familyId: nonEmptyStringSchema,
  sourcePath: nonEmptyStringSchema,
  runtimeGraphPath: nonEmptyStringSchema,
  outputPath: nonEmptyStringSchema.optional(),
  compilerVersion: nonEmptyStringSchema,
  artifactRef: nonEmptyStringSchema,
  generatedFiles: z.array(nonEmptyStringSchema).min(1),
  metadata: z.record(z.string(), z.unknown()),
  publicationPlan: workflowIrPublicationPlanSchema,
  trustBundle: z.record(z.string(), z.unknown()).optional(),
  dot: z.string(),
}).catchall(z.unknown());

export const WORKFLOW_IR_DOCUMENT_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: "https://recallnet.dev/contracts/workflow-ir-document.v1.schema.json",
  version: WORKFLOW_IR_DOCUMENT_SCHEMA_VERSION,
  title: "Workflow IR Document",
  description: "Canonical deterministic workflow IR document envelope for generated DOT runtime IR and governed OCI publication-intent metadata.",
  schema: workflowIrDocumentSchema,
  sourcePath: "packages/factory-core/src/workflow-ir-registry.ts",
  outputPath: "docs/contracts/workflow-ir-document.v1.schema.json",
  documentVersionField: "schemaVersion",
});

function trim(value: string = ""): string {
  return String(value ?? "").trim();
}

function deriveOwnerIdFromSourcePath(sourcePath: string = ""): string {
  const factoryMatch = trim(sourcePath).match(/^factories\/([^/]+)\//);
  if (factoryMatch) return factoryMatch[1];
  const packageMatch = trim(sourcePath).match(/^packages\/([^/]+)\//);
  if (packageMatch) return packageMatch[1];
  return "unknown_owner";
}

export function deriveWorkflowRuntimeDotPath(sourcePath: string = "", workflowId: string = ""): string {
  return `docs/contracts/workflow-ir/${deriveOwnerIdFromSourcePath(sourcePath)}/${trim(workflowId)}.dot`;
}

export function deriveWorkflowDiagramPngPath(runtimeGraphPath: string = ""): string {
  return trim(runtimeGraphPath).replace(/\.dot$/u, ".png");
}

function deriveLegacyWorkflowGraphPath(sourcePath: string = ""): string {
  const normalized = trim(sourcePath);
  const match = normalized.match(/^(factories|packages)\/([^/]+)\/workflows\/.+\/([^/]+)\.workflow-source\.mjs$/u);
  if (!match) return "";
  const [, scope, owner, baseName] = match;
  return `${scope}/${owner}/graphs/${baseName}.dot`;
}

function normalizeRelativeImportPath(relativePath: string = ""): string {
  const normalized = trim(relativePath).replace(/\\/gu, "/");
  if (!normalized) return normalized;
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function normalizeRepoRelativeHostPath(hostPath: string = "", preferredRelativePath: string = ""): string {
  const host = trim(hostPath).replace(/\\/gu, "/");
  const preferred = trim(preferredRelativePath).replace(/\\/gu, "/");
  if (!host) return host;
  if (!path.posix.isAbsolute(host)) return host;
  // @context:regression !critical Detached workflow-source execution passes an
  // absolute module path as hostPath. Import relocation is defined on repo-owned
  // relative surfaces; mixing an absolute host path with a repo-relative source
  // path produces nonsense imports like ../../../../../../../packages/... which
  // later resolve to /packages/... and crash the child before run state exists.
  if (preferred && host.endsWith(preferred)) return preferred;
  return host;
}

function relocateWorkflowImports(imports: string[] = [], { sourcePath = "", hostPath = "", runtimeGraphPath = "" }: { sourcePath?: string; hostPath?: string; runtimeGraphPath?: string } = {}): string[] {
  const host = normalizeRepoRelativeHostPath(hostPath, sourcePath)
    || normalizeRepoRelativeHostPath(hostPath, runtimeGraphPath);
  if (!host) return sortStrings(imports || []);

  const legacyGraphPath = deriveLegacyWorkflowGraphPath(sourcePath);
  if (!legacyGraphPath) return sortStrings(imports || []);

  const fromDir = path.posix.dirname(legacyGraphPath);
  const hostDir = path.posix.dirname(host);
  return sortStrings((imports || []).map((entry) => {
    const importLiteral = trim(entry);
    if (!importLiteral) return importLiteral;
    if (importLiteral.startsWith("@")) return importLiteral;
    const absoluteTarget = path.posix.normalize(path.posix.resolve("/", fromDir, importLiteral));
    const absoluteHostDir = path.posix.normalize(path.posix.resolve("/", hostDir));
    const relativeTarget = path.posix.relative(absoluteHostDir, absoluteTarget);
    return normalizeRelativeImportPath(relativeTarget);
  }));
}

function quote(value: string = ""): string {
  return JSON.stringify(String(value ?? ""));
}

function sortStrings(values: string[] = []): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => trim(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function sortEntries(entries: [string, unknown][] = []): [string, unknown][] {
  return [...entries].sort(([left], [right]) => left.localeCompare(right));
}

const ATTRIBUTE_PRIORITY: string[] = [
  "shape",
  "type",
  "governance",
  "action_runtime",
  "action_id",
  "class",
  "benchmark_job_id",
  "llm_path_id",
  "prompt_version",
  "role_version",
  "skill_id",
  "llm_model",
  "condition",
  "label",
  "output_key",
  "output_format",
  "outputs",
  "action_repo",
  "action_repo_root",
  "action_goal_issue_number",
  "action_issue_number",
  "action_goal_execution_path",
  "action_goal_execution_paths",
  "action_goal_routing_state",
  "action_factory_id",
  "action_run_id",
  "action_pipeline",
  "action_node_id",
  "reasoning_effort",
  "timeout",
  "prompt",
];

function normalizeAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => trim(entry as string)).filter(Boolean).join(",");
  }
  return trim(value as string);
}

function normalizeAttributes(attributes: Record<string, unknown> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([key, value]) => [trim(key), normalizeAttributeValue(value)])
      .filter(([key, value]) => key && value),
  );
}

function renderAttributeList(attributes: Record<string, unknown> = {}): string {
  return Object.entries(normalizeAttributes(attributes))
    .map(([key, value], index) => ({ key, value, index }))
    .sort((left, right) => {
      const leftPriority = ATTRIBUTE_PRIORITY.indexOf(left.key);
      const rightPriority = ATTRIBUTE_PRIORITY.indexOf(right.key);
      if (leftPriority !== -1 || rightPriority !== -1) {
        if (leftPriority === -1) return 1;
        if (rightPriority === -1) return -1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      }
      return left.index - right.index;
    })
    .map(({ key, value }) => `${key}=${quote(value)}`)
    .join(" ");
}

function buildNodeAttributes(node: Record<string, unknown>): Record<string, unknown> {
  const binding = (node.binding || {}) as Record<string, unknown>;
  const policy = (node.policy || {}) as Record<string, unknown>;
  const composition = (node.composition || {}) as Record<string, unknown>;
  const dotAttributes = normalizeAttributes(node.dotAttributes as Record<string, unknown> || {});
  const attributes: Record<string, unknown> = {
    label: node.title,
    description: node.description,
  };

  if (node.kind === "start") {
    return {
      shape: "Mdiamond",
      ...attributes,
      ...dotAttributes,
    };
  }

  if (node.kind === "terminal") {
    return {
      shape: "Msquare",
      recovery_sink_type: "terminal",
      ...attributes,
      ...dotAttributes,
    };
  }

  if (node.kind === "decision") {
    return {
      shape: "diamond",
      ...attributes,
      ...(policy.recoveryOwner ? { recovery_owner: policy.recoveryOwner } : {}),
      ...dotAttributes,
    };
  }

  if (node.kind === "llm_prompt") {
    attributes.class = node.roleClass;
  }

  if (node.kind === "tool_action") {
    attributes.type = node.handlerType || "tool";
    if (policy.governance) attributes.governance = policy.governance;
    if (node.actionId) {
      attributes.action_runtime = "in_process";
      attributes.action_id = node.actionId;
    }
  }

  if (node.kind === "dynamic_fan_out" || node.kind === "detached_fan_out" || node.kind === "dynamic_fan_in" || node.kind === "pipeline") {
    attributes.type = node.handlerType || (node.kind === "pipeline" ? "pipeline" : "");
  }

  if (node.toolId) attributes.tool_id = node.toolId;
  if (node.prompt) attributes.prompt = node.prompt;
  if (binding.outputKey) attributes.output_key = binding.outputKey;
  if (binding.outputFormat) attributes.output_format = binding.outputFormat;
  if ((binding.outputs as string[])?.length) attributes.outputs = (binding.outputs as string[]).join(",");
  if (binding.payload) attributes.action_payload = binding.payload;
  if (binding.raw) attributes.action_raw = binding.raw;
  if (policy.timeout) attributes.timeout = policy.timeout;
  if (policy.recoveryOwner) attributes.recovery_owner = policy.recoveryOwner;
  if (policy.retryTarget) attributes.retry_target = policy.retryTarget;
  if (policy.fallbackRetryTarget) attributes.fallback_retry_target = policy.fallbackRetryTarget;
  if (typeof policy.maxRetries === "number") attributes.max_retries = String(policy.maxRetries);
  if (composition.sourceKey) attributes.source_key = composition.sourceKey;
  if (composition.itemKey) attributes.item_key = composition.itemKey;
  const workflowTarget = trim((composition.workflowRef || composition.workflowRuntimeGraphPath) as string);
  const templateTarget = trim((composition.templateWorkflowRef || composition.templateRuntimeGraphPath) as string);
  if (workflowTarget) {
    attributes[node.kind === "pipeline" ? "pipeline" : "workflow"] = workflowTarget;
  }
  if (templateTarget) attributes.template = templateTarget;
  if (typeof composition.maxConcurrency === "number") attributes.max_concurrency = String(composition.maxConcurrency);
  if (composition.bindings && Object.keys(composition.bindings as Record<string, unknown>).length > 0) {
    attributes.bindings = Object.entries(composition.bindings as Record<string, string>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value}`)
      .join(",");
  }

  return {
    ...attributes,
    ...dotAttributes,
  };
}

function buildEdgeAttributes(edge: Record<string, unknown> = {}): Record<string, string> {
  return normalizeAttributes({
    ...(edge.dotAttributes as Record<string, unknown> || {}),
    condition: edge.condition,
    label: edge.label,
  });
}

function renderDotIdentifier(value: unknown): string {
  const normalized = trim(value as string);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : quote(normalized);
}

function renderEdgeLine(from: string, to: string, attributes: Record<string, string> = {}): string {
  const rendered = renderAttributeList(attributes);
  return rendered ? `    ${from} -> ${to} [${rendered}]` : `    ${from} -> ${to}`;
}

function renderEdgeLines(edges: Record<string, unknown>[] = []): string[] {
  const outgoingByNode = new Map<string, Record<string, unknown>[]>();
  const incomingCountByNode = new Map<string, number>();

  for (const edge of edges) {
    const outgoing = outgoingByNode.get(edge.from as string) || [];
    outgoing.push(edge);
    outgoingByNode.set(edge.from as string, outgoing);
    incomingCountByNode.set(edge.to as string, (incomingCountByNode.get(edge.to as string) || 0) + 1);
  }

  const rendered: string[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const attributes = buildEdgeAttributes(edge);
    const isUnconditional = Object.keys(attributes).length === 0;
    const startsChain = isUnconditional && (incomingCountByNode.get(edge.from as string) || 0) !== 1;
    if (!startsChain) continue;

    const chain = [edge.from as string, edge.to as string];
    consumed.add(index);
    let current = edge.to as string;

    while (true) {
      const outgoing = outgoingByNode.get(current) || [];
      if (outgoing.length !== 1) break;
      if ((incomingCountByNode.get(current) || 0) !== 1) break;
      const nextEdge = outgoing[0];
      const nextAttributes = buildEdgeAttributes(nextEdge);
      if (Object.keys(nextAttributes).length > 0) break;
      const nextIndex = edges.indexOf(nextEdge);
      if (nextIndex === -1 || consumed.has(nextIndex)) break;
      chain.push(nextEdge.to as string);
      consumed.add(nextIndex);
      current = nextEdge.to as string;
    }

    rendered.push(`    ${chain.join(" -> ")}`);
  }

  for (let index = 0; index < edges.length; index += 1) {
    if (consumed.has(index)) continue;
    const edge = edges[index];
    const attributes = buildEdgeAttributes(edge);
    consumed.add(index);
    rendered.push(renderEdgeLine(edge.from as string, edge.to as string, attributes));
  }

  return rendered;
}

export function renderWorkflowSourceModuleToDot(definition: Record<string, unknown> = {}, options: Record<string, unknown> = {}): string {
  const hostPath = trim(options.hostPath as string) || trim(definition.runtimeGraphPath as string);
  const imports = relocateWorkflowImports(definition.imports as string[] || [], {
    sourcePath: definition.sourcePath as string,
    hostPath,
    runtimeGraphPath: definition.runtimeGraphPath as string,
  });
  const graphAttributes = normalizeAttributes({
    label: definition.workflowId,
    workflow_source: definition.sourcePath,
    ...(definition.graphAttributes as Record<string, unknown> || {}),
  });

  return [
    `// Generated from ${trim(definition.sourcePath as string)}. Do not edit by hand.`,
    ...imports.map((entry) => `@import ${quote(entry)}`),
    ...(imports.length > 0 ? [""] : []),
    `digraph ${renderDotIdentifier(definition.workflowId)} {`,
    ...Object.entries(graphAttributes).map(([key, value]) => `    ${key} = ${quote(value)}`),
    ...((definition.nodes as Record<string, unknown>[] || []).map((node) => `    ${node.id} [${renderAttributeList(buildNodeAttributes(node))}]`)),
    ...renderEdgeLines(definition.edges as Record<string, unknown>[] || []),
    "}",
    "",
  ].join("\n");
}

function createDefaultArtifactClass(): Record<string, unknown> {
  return {
    key: WORKFLOW_IR_BUNDLE_KEY,
    canonicalMediaType: WORKFLOW_IR_BUNDLE_MEDIA_TYPE,
    metadataSchema: z.record(z.string(), z.unknown()),
    trustPolicy: defineArtifactTrustPolicy({
      rationale: "Workflow IR bundles require canonical signing, attestation, and verification because they drive downstream release and provenance decisions.",
    }),
  };
}

function buildDefaultTrustBundle({
  artifactClass,
  artifactRef,
  compilerVersion,
  workflowId,
  sourcePath,
  dot,
}: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  const policy = (artifactClass as Record<string, unknown>)?.trustPolicy || defineArtifactTrustPolicy({
    rationale: "Workflow IR bundles require canonical signing, attestation, and verification because they drive downstream release and provenance decisions.",
  });
  const signature = buildCosignSignatureRecord({
    keyId: "workflow-ir-contract-key",
    signature: "c2lnbmF0dXJl",
    payloadRef: trim(artifactRef as string),
    payloadType: "oci_artifact",
    payloadBytes: Buffer.from(String(dot || ""), "utf8"),
  });
  const predicate = buildSlsaProvenancePredicate({
    buildType: "https://recallnet.dev/build/workflow-ir",
    builderId: "https://recallnet.dev/builders/workflow-ir",
    invocationId: trim(workflowId as string),
    startedOn: "2026-03-21T00:00:00.000Z",
    finishedOn: "2026-03-21T00:00:01.000Z",
    externalParameters: { artifact_ref: trim(artifactRef as string) },
    internalParameters: {
      compiler_version: trim(compilerVersion as string),
      workflow_id: trim(workflowId as string),
    },
    resolvedDependencies: [{
      uri: trim(sourcePath as string),
      digest: { sha256: "typed-source-generated" },
    }],
  });
  return buildArtifactTrustBundle({
    policy,
    signature,
    attestations: [buildSlsaAttestation({
      predicate,
      keyId: (signature as Record<string, unknown>).key_id as string,
      signature: (signature as Record<string, unknown>).signature as string,
    })],
    verifications: ((policy as Record<string, unknown>).verification_boundaries as string[] || ["release", "promotion"]).map((boundary: string) => buildArtifactVerificationRecord({
      boundary,
      status: "verified",
      verifiedAt: "2026-03-21T00:00:02.000Z",
      reason: "contract_generated",
    })),
  });
}

function applyWorkflowIrTrust({
  artifactClass,
  artifactRef,
  compilerVersion,
  workflowId,
  sourcePath,
  dot,
  publicationPlan,
  applyOciArtifactTrustFn = null,
}: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  const defaultTrustBundle = buildDefaultTrustBundle({
    artifactClass,
    artifactRef,
    compilerVersion,
    workflowId,
    sourcePath,
    dot,
  });

  if (typeof applyOciArtifactTrustFn !== "function") {
    return defaultTrustBundle;
  }

  const defaultAttestation = ((defaultTrustBundle as Record<string, unknown>).attestations as unknown[])?.[0] || null;
  const trustResult = (applyOciArtifactTrustFn as (args: Record<string, unknown>) => Record<string, unknown>)({
    artifactClass,
    publicationPlan,
    publishResult: null,
    defaultAttestation,
  });

  return buildArtifactTrustBundle({
    policy: (artifactClass as Record<string, unknown>)?.trustPolicy || (defaultTrustBundle as Record<string, unknown>).policy,
    signature: trustResult?.signature || (defaultTrustBundle as Record<string, unknown>).signature,
    attestations: Array.isArray(trustResult?.attestations) && (trustResult.attestations as unknown[]).length > 0
      ? trustResult.attestations
      : (defaultTrustBundle as Record<string, unknown>).attestations,
    verifications: Array.isArray(trustResult?.verifications) && (trustResult.verifications as unknown[]).length > 0
      ? trustResult.verifications
      : (defaultTrustBundle as Record<string, unknown>).verifications,
  });
}

function normalizeWorkflowIrDocument(definition: Record<string, unknown> = {}): Record<string, unknown> {
  const artifactClass = (definition.artifactClassDefinition || createDefaultArtifactClass()) as Record<string, unknown>;
  const runtimeGraphPath = trim(definition.runtimeGraphPath as string)
    || deriveWorkflowRuntimeDotPath(definition.sourcePath as string, definition.workflowId as string);
  const dot = trim(definition.dot as string) || renderWorkflowSourceModuleToDot({ ...definition, runtimeGraphPath });
  const generatedFiles = sortStrings(definition.generatedFiles as string[] || [runtimeGraphPath]);
  const subject = definition.subject ? buildOciSubjectReferrerRelation(definition.subject as Record<string, string>) : null;
  const publicationPlan = buildOciArtifactPublicationPlan({
    artifactClass,
    artifactRef: definition.artifactRef as string,
    metadata: (definition.metadata || {}) as Record<string, unknown>,
    ...(subject ? { subject } : {}),
    files: generatedFiles.map((filePath) => ({
      path: filePath,
      mediaType: filePath.endsWith(".dot")
        ? "text/vnd.graphviz"
        : filePath.endsWith(".png")
          ? "image/png"
          : "application/json",
    })),
  });
  const trustBundle = definition.trustBundle || applyWorkflowIrTrust({
    artifactClass,
    artifactRef: definition.artifactRef,
    compilerVersion: definition.compilerVersion,
    workflowId: definition.workflowId,
    sourcePath: definition.sourcePath,
    dot,
    publicationPlan,
    applyOciArtifactTrustFn: definition.applyOciArtifactTrustFn,
  });

  return sortJson({
    schemaVersion: WORKFLOW_IR_DOCUMENT_SCHEMA_VERSION,
    artifactClass: WORKFLOW_IR_BUNDLE_KEY,
    artifactVersion: WORKFLOW_IR_BUNDLE_VERSION,
    workflowId: trim(definition.workflowId as string),
    familyId: trim(definition.familyId as string),
    sourcePath: trim(definition.sourcePath as string),
    runtimeGraphPath,
    ...(trim(definition.outputPath as string) ? { outputPath: trim(definition.outputPath as string) } : {}),
    compilerVersion: trim(definition.compilerVersion as string),
    artifactRef: trim(definition.artifactRef as string),
    generatedFiles,
    metadata: definition.metadata || {},
    publicationPlan,
    trustBundle,
    dot,
  }) as Record<string, unknown>;
}

export function defineWorkflowIrModule(definition: Record<string, unknown> = {}): Record<string, unknown> {
  return workflowIrDocumentSchema.parse(normalizeWorkflowIrDocument(definition)) as Record<string, unknown>;
}

export function exportWorkflowIrDocument(definition: Record<string, unknown> = {}): Record<string, unknown> {
  return defineWorkflowIrModule(definition);
}

export function stringifyWorkflowIrDocument(definition: Record<string, unknown> = {}): string {
  return `${JSON.stringify(exportWorkflowIrDocument(definition), null, 2)}\n`;
}

export function exportWorkflowIrDocumentJsonSchema(): Record<string, unknown> {
  return exportBoundaryJsonSchema(WORKFLOW_IR_DOCUMENT_BOUNDARY_SCHEMA);
}

export function stringifyWorkflowIrDocumentJsonSchema(): string {
  return stringifySchemaDocument(exportWorkflowIrDocumentJsonSchema());
}
