import { execFileSync } from "node:child_process";

import { defineArtifactTrustPolicy } from "./artifact-trust-registry.ts";
import { exportBoundaryJsonSchema, sortJson, z } from "./schema-registry.ts";

function trim(value: string = ""): string {
  return String(value ?? "").trim();
}

function stableList(values: string[] = []): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => trim(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function isOciArtifactRef(value: string = ""): boolean {
  const normalized = trim(value);
  return Boolean(normalized) && /^[^:@\s]+(?:\/[^:@\s]+)+(?::[^@\s]+|@sha256:[a-f0-9]{64})$/u.test(normalized);
}

function normalizePositiveInteger(value: unknown = 0): number {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeIsoInstant(value: string = ""): string {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function defineOciArtifactLifecyclePolicy({
  retentionDays = 0,
  expiryAction = "",
  enforcementMode = "shared_policy_engine",
  preserveSubjectReferrers = true,
  rationale = "",
  retention_days: legacyRetentionDays = 0,
  expiry_action: legacyExpiryAction = "",
  enforcement_mode: legacyEnforcementMode = "shared_policy_engine",
  preserve_subject_referrers: legacyPreserveSubjectReferrers = true,
}: {
  retentionDays?: number;
  expiryAction?: string;
  enforcementMode?: string;
  preserveSubjectReferrers?: boolean;
  rationale?: string;
  retention_days?: number;
  expiry_action?: string;
  enforcement_mode?: string;
  preserve_subject_referrers?: boolean;
} = {}): Readonly<Record<string, unknown>> {
  const normalizedRetentionDays = normalizePositiveInteger(retentionDays || legacyRetentionDays);
  const normalizedExpiryAction = trim(expiryAction || legacyExpiryAction);
  const normalizedEnforcementMode = trim(enforcementMode || legacyEnforcementMode || "shared_policy_engine");
  const normalizedPreserveSubjectReferrers = preserveSubjectReferrers ?? legacyPreserveSubjectReferrers;

  if (!normalizedRetentionDays || !normalizedExpiryAction || !normalizedEnforcementMode) {
    throw new Error("oci_lifecycle_policy_invalid");
  }

  return Object.freeze({
    schema_version: "oci_artifact_lifecycle_policy/v1",
    retention_days: normalizedRetentionDays,
    expiry_action: normalizedExpiryAction,
    enforcement_mode: normalizedEnforcementMode,
    preserve_subject_referrers: Boolean(normalizedPreserveSubjectReferrers),
    rationale: trim(rationale),
  });
}

export function defineOciArtifactClass({
  key,
  version,
  title,
  description = "",
  canonicalMediaType,
  sourcePath,
  metadataSchemaId,
  metadataOutputPath,
  metadataSchema,
  nameTemplate,
  filenameTemplate,
  lifecyclePolicy,
  trustPolicy,
  governedPublisherPaths = [],
}: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    key: trim(key as string),
    version: trim(version as string),
    title: trim(title as string),
    description: trim(description as string),
    canonicalMediaType: trim(canonicalMediaType as string),
    sourcePath: trim(sourcePath as string),
    metadataSchemaId: trim(metadataSchemaId as string),
    metadataOutputPath: trim(metadataOutputPath as string),
    metadataSchema,
    nameTemplate: trim(nameTemplate as string),
    filenameTemplate: trim(filenameTemplate as string),
    lifecyclePolicy: lifecyclePolicy ? defineOciArtifactLifecyclePolicy(lifecyclePolicy as Record<string, unknown>) : null,
    trustPolicy: trustPolicy ? defineArtifactTrustPolicy(trustPolicy as Record<string, unknown>) : null,
    governedPublisherPaths: stableList(governedPublisherPaths as string[]),
  });
}

export function exportOciArtifactMetadataSchema(artifactClass: Record<string, unknown>): Record<string, unknown> {
  return sortJson({
    ...exportBoundaryJsonSchema({
      id: artifactClass.metadataSchemaId as string,
      title: `${artifactClass.title} Metadata`,
      description: (artifactClass.description as string) || `${artifactClass.title} metadata contract.`,
      schema: artifactClass.metadataSchema as import("zod").ZodType,
      outputPath: "",
      sourcePath: "",
      documentVersionField: "schema_version",
      version: "",
    }),
  }) as Record<string, unknown>;
}

export function exportOciArtifactTaxonomyDocument(artifactClasses: Record<string, unknown>[] = []): Record<string, unknown> {
  const classes = [...(Array.isArray(artifactClasses) ? artifactClasses : [])]
    .sort((left, right) => (left.key as string).localeCompare(right.key as string))
    .map((artifactClass) => ({
      key: artifactClass.key,
      version: artifactClass.version,
      title: artifactClass.title,
      description: artifactClass.description,
      canonical_media_type: artifactClass.canonicalMediaType,
      source_path: artifactClass.sourcePath,
      metadata_schema_id: artifactClass.metadataSchemaId,
      metadata_output_path: artifactClass.metadataOutputPath,
      lifecycle_policy: artifactClass.lifecyclePolicy,
      trust_policy: artifactClass.trustPolicy,
      governed_publisher_paths: stableList(artifactClass.governedPublisherPaths as string[]),
      name_template: artifactClass.nameTemplate,
      filename_template: artifactClass.filenameTemplate,
    }));

  return sortJson({
    schema_version: "oci_artifact_taxonomy/v1",
    summary: {
      registered_classes: classes.length,
    },
    classes,
  }) as Record<string, unknown>;
}

export function buildOciArtifactIdentity({
  factoryId = "",
  runId = "",
  capabilityId = "",
  workflowId = "",
  workflowSourceRevision = "",
  correlationId = "",
  traceparent = "",
  tracestate = "",
}: {
  factoryId?: string;
  runId?: string;
  capabilityId?: string;
  workflowId?: string;
  workflowSourceRevision?: string;
  correlationId?: string;
  traceparent?: string;
  tracestate?: string;
} = {}): Record<string, string> {
  return {
    factory_id: trim(factoryId),
    run_id: trim(runId),
    capability_id: trim(capabilityId),
    workflow_id: trim(workflowId),
    workflow_source_revision: trim(workflowSourceRevision),
    correlation_id: trim(correlationId),
    ...(trim(traceparent) ? { traceparent: trim(traceparent) } : {}),
    ...(trim(tracestate) ? { tracestate: trim(tracestate) } : {}),
  };
}

export function buildOciArtifactRef({ registryRepository = "", tag = "" }: { registryRepository?: string; tag?: string } = {}): string {
  const repository = trim(registryRepository);
  const normalizedTag = trim(tag);
  if (!repository || !normalizedTag) {
    throw new Error("oci_artifact_ref_invalid");
  }
  return `${repository}:${normalizedTag}`;
}

export function buildOciSubjectReferrerRelation({
  subjectArtifactRef = "",
  relationshipName = "",
  subject_artifact_ref: legacySubjectArtifactRef = "",
  relationship_name: legacyRelationshipName = "",
}: {
  subjectArtifactRef?: string;
  relationshipName?: string;
  subject_artifact_ref?: string;
  relationship_name?: string;
} = {}): Readonly<Record<string, string>> {
  const normalizedSubjectArtifactRef = trim(subjectArtifactRef || legacySubjectArtifactRef);
  const normalizedRelationshipName = trim(relationshipName || legacyRelationshipName || "attachment");

  if (!isOciArtifactRef(normalizedSubjectArtifactRef)) {
    throw new Error("oci_subject_referrer_invalid");
  }

  if (!normalizedRelationshipName) {
    throw new Error("oci_subject_referrer_invalid");
  }

  return Object.freeze({
    schema_version: "oci_subject_referrer/v1",
    subject_artifact_ref: normalizedSubjectArtifactRef,
    relationship_name: normalizedRelationshipName,
  });
}

export function buildOciArtifactPublicationPlan({
  artifactClass,
  artifactRef = "",
  metadata = {},
  files = [],
  subject = null,
}: {
  artifactClass: Record<string, unknown>;
  artifactRef?: string;
  metadata?: Record<string, unknown>;
  files?: Array<{ path?: string; mediaType?: string }>;
  subject?: Record<string, unknown> | null;
} = {} as { artifactClass: Record<string, unknown> }): Record<string, unknown> {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((entry) => ({
      path: trim(entry?.path),
      mediaType: trim(entry?.mediaType),
    }))
    .filter((entry) => entry.path);

  if (!artifactClass?.key || !artifactClass?.canonicalMediaType) {
    throw new Error("oci_artifact_class_missing");
  }

  (artifactClass.metadataSchema as { parse: (v: unknown) => unknown }).parse(metadata);

  if (!trim(artifactRef)) {
    throw new Error("oci_artifact_ref_missing");
  }

  if (normalizedFiles.length < 1) {
    throw new Error("oci_artifact_files_missing");
  }

  const args = [
    "oras",
    "push",
    trim(artifactRef),
    "--artifact-type",
    trim(artifactClass.canonicalMediaType as string),
    ...(
      subject
        ? ((normalizedSubject: Record<string, string>) => [
          "--subject",
          normalizedSubject.subject_artifact_ref,
          "--annotation",
          `dev.recallnet.oci.subject.relationship=${normalizedSubject.relationship_name}`,
        ])(buildOciSubjectReferrerRelation(subject as Record<string, string>))
        : []
    ),
    ...normalizedFiles.flatMap((entry) => [entry.path]),
  ];

  return {
    artifact_class: artifactClass.key,
    artifact_ref: trim(artifactRef),
    media_type: artifactClass.canonicalMediaType,
    metadata,
    ...(artifactClass.lifecyclePolicy ? { lifecycle_policy: artifactClass.lifecyclePolicy } : {}),
    ...(artifactClass.trustPolicy ? { trust_policy: artifactClass.trustPolicy } : {}),
    files: normalizedFiles,
    ...(subject ? { subject: buildOciSubjectReferrerRelation(subject as Record<string, string>) } : {}),
    args,
  };
}

export function buildOciArtifactLifecycleEvaluation({
  artifactClass,
  artifactRef = "",
  publishedAt = "",
  asOf = "",
}: {
  artifactClass: Record<string, unknown>;
  artifactRef?: string;
  publishedAt?: string;
  asOf?: string;
} = {} as { artifactClass: Record<string, unknown> }): Record<string, unknown> {
  const lifecyclePolicy = artifactClass?.lifecyclePolicy ? defineOciArtifactLifecyclePolicy(artifactClass.lifecyclePolicy as Record<string, unknown>) : null;
  const normalizedPublishedAt = normalizeIsoInstant(publishedAt);

  if (!artifactClass?.key || !lifecyclePolicy || !normalizedPublishedAt) {
    throw new Error("oci_lifecycle_evaluation_invalid");
  }

  const publishedAtEpoch = Date.parse(normalizedPublishedAt);
  const retainUntilEpoch = publishedAtEpoch + ((lifecyclePolicy.retention_days as number) * 24 * 60 * 60 * 1000);
  const normalizedAsOf = normalizeIsoInstant(asOf) || normalizedPublishedAt;
  const asOfEpoch = Date.parse(normalizedAsOf);

  return {
    schema_version: "oci_artifact_lifecycle_evaluation/v1",
    artifact_class: artifactClass.key,
    ...(trim(artifactRef) ? { artifact_ref: trim(artifactRef) } : {}),
    lifecycle_policy: lifecyclePolicy,
    published_at: normalizedPublishedAt,
    retain_until: new Date(retainUntilEpoch).toISOString(),
    status: asOfEpoch >= retainUntilEpoch ? "expired" : "retained",
    evaluated_at: normalizedAsOf,
  };
}

export function publishOciArtifact(plan: Record<string, unknown>, { execFileSyncFn = execFileSync }: { execFileSyncFn?: typeof execFileSync } = {}): Record<string, unknown> {
  const args = Array.isArray(plan?.args) ? plan.args as string[] : [];
  if (args.length < 3) throw new Error("oci_publish_plan_invalid");
  const output = execFileSyncFn(args[0], args.slice(1), { encoding: "utf8" });
  return {
    ok: true,
    artifact_ref: trim(plan.artifact_ref as string),
    stdout: trim(output as string),
  };
}

export function buildOciArtifactCopyPlan({ fromRef = "", toRef = "" }: { fromRef?: string; toRef?: string } = {}): Record<string, unknown> {
  if (!trim(fromRef) || !trim(toRef)) throw new Error("oci_copy_plan_invalid");
  return {
    from_ref: trim(fromRef),
    to_ref: trim(toRef),
    args: ["oras", "cp", trim(fromRef), trim(toRef)],
  };
}

export function buildOciArtifactInspectPlan({ artifactRef = "" }: { artifactRef?: string } = {}): Record<string, unknown> {
  if (!trim(artifactRef)) throw new Error("oci_inspect_plan_invalid");
  return {
    artifact_ref: trim(artifactRef),
    args: ["oras", "manifest", "fetch", trim(artifactRef)],
  };
}

export function buildOciArtifactDiscoverPlan({ subjectArtifactRef = "" }: { subjectArtifactRef?: string } = {}): Record<string, unknown> {
  if (!isOciArtifactRef(subjectArtifactRef)) throw new Error("oci_discover_plan_invalid");
  return {
    subject_artifact_ref: trim(subjectArtifactRef),
    args: ["oras", "discover", "--output", "json", trim(subjectArtifactRef)],
  };
}

export { z };
