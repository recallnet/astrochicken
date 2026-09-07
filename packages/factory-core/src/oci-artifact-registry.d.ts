import type { ArtifactTrustPolicy } from "@hatch/factory-core/artifact-trust-registry";
import type { ZodType } from "zod/v4/core";

export const z: typeof import("zod").z;

export interface OciArtifactLifecyclePolicy {
  schema_version: "oci_artifact_lifecycle_policy/v1";
  retention_days: number;
  expiry_action: string;
  enforcement_mode: string;
  preserve_subject_referrers: boolean;
  rationale: string;
}

export interface OciArtifactClassDefinition<TSchema extends ZodType = ZodType> {
  key: string;
  version: string;
  title: string;
  description?: string;
  canonicalMediaType: string;
  sourcePath: string;
  metadataSchemaId: string;
  metadataOutputPath: string;
  metadataSchema: TSchema;
  nameTemplate: string;
  filenameTemplate: string;
  lifecyclePolicy?: OciArtifactLifecyclePolicy | null;
  trustPolicy?: ArtifactTrustPolicy | null;
  governedPublisherPaths?: string[];
}

export function defineOciArtifactLifecyclePolicy(
  definition?: Partial<OciArtifactLifecyclePolicy> & {
    retentionDays?: number;
    expiryAction?: string;
    enforcementMode?: string;
    preserveSubjectReferrers?: boolean;
  },
): Readonly<OciArtifactLifecyclePolicy>;
export function defineOciArtifactClass<TSchema extends ZodType>(
  definition: OciArtifactClassDefinition<TSchema>,
): Readonly<OciArtifactClassDefinition<TSchema>>;

export function exportOciArtifactMetadataSchema(artifactClass: OciArtifactClassDefinition): Record<string, unknown>;
export function exportOciArtifactTaxonomyDocument(artifactClasses?: OciArtifactClassDefinition[]): Record<string, unknown>;
export function buildOciArtifactIdentity(options?: {
  factoryId?: string;
  runId?: string;
  capabilityId?: string;
  workflowId?: string;
  workflowSourceRevision?: string;
  correlationId?: string;
  traceparent?: string;
  tracestate?: string;
}): Record<string, string>;
export function buildOciArtifactRef(options?: { registryRepository?: string; tag?: string }): string;
export function buildOciSubjectReferrerRelation(options?: {
  subjectArtifactRef?: string;
  relationshipName?: string;
}): Record<string, string>;
export function buildOciArtifactPublicationPlan(options?: {
  artifactClass?: OciArtifactClassDefinition;
  artifactRef?: string;
  metadata?: Record<string, unknown>;
  files?: Array<{ path?: string; mediaType?: string }>;
  subject?: Record<string, unknown> | null;
}): Record<string, unknown>;
export function buildOciArtifactLifecycleEvaluation(options?: {
  artifactClass?: OciArtifactClassDefinition;
  artifactRef?: string;
  publishedAt?: string;
  asOf?: string;
}): Record<string, unknown>;
export function publishOciArtifact(plan: Record<string, unknown>, options?: {
  execFileSyncFn?: (...args: unknown[]) => string;
}): Record<string, unknown>;
export function buildOciArtifactCopyPlan(options?: { fromRef?: string; toRef?: string }): Record<string, unknown>;
export function buildOciArtifactInspectPlan(options?: { artifactRef?: string }): Record<string, unknown>;
export function buildOciArtifactDiscoverPlan(options?: { subjectArtifactRef?: string }): Record<string, unknown>;
