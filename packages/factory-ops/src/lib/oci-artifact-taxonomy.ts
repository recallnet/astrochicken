import { defineArtifactTrustPolicy } from "@hatch/factory-core/artifact-trust-registry";
import {
  defineOciArtifactClass,
  defineOciArtifactLifecyclePolicy,
  z,
} from "@hatch/factory-core/oci-artifact-registry";

const artifactIdentitySchema = z.strictObject({
  factory_id: z.string(),
  run_id: z.string(),
  capability_id: z.string(),
  workflow_id: z.string(),
  workflow_source_revision: z.string(),
  correlation_id: z.string(),
  traceparent: z.string().optional(),
  tracestate: z.string().optional(),
});

const sharedSubjectPreservingLifecyclePolicy = ({
  retentionDays,
  rationale,
}) => defineOciArtifactLifecyclePolicy({
  retentionDays,
  expiryAction: "review_delete",
  enforcementMode: "shared_policy_engine",
  preserveSubjectReferrers: true,
  rationale,
});

const sharedRequiredTrustPolicy = (rationale) => defineArtifactTrustPolicy({
  rationale,
});

export const workflowIrBundleArtifactClass = defineOciArtifactClass({
  key: "workflow_ir_bundle",
  version: "workflow_ir_bundle/v1",
  title: "Workflow IR Bundle",
  description: "Compiled workflow IR and companion publication-intent metadata for a later governed OCI publish path.",
  canonicalMediaType: "application/vnd.recallnet.factory.workflow-ir.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/workflow-ir-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/workflow-ir-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("workflow_ir_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    workflow_graph_id: z.string(),
    compiler_version: z.string(),
  }),
  nameTemplate: "workflow-ir/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 30,
    rationale: "Workflow IR bundles are rebuildable intermediates and should age out quickly under the shared lifecycle engine.",
  }),
  trustPolicy: sharedRequiredTrustPolicy("Workflow IR bundles require canonical signing, attestation, and verification because they drive downstream release and provenance decisions."),
});

export const runSnapshotBundleArtifactClass = defineOciArtifactClass({
  key: "run_snapshot_bundle",
  version: "run_snapshot_bundle/v1",
  title: "Run Snapshot Bundle",
  description: "Durable run snapshot bundle for replay, inspection, and later provenance.",
  canonicalMediaType: "application/vnd.recallnet.factory.run-snapshot.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/run-snapshot-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/run-snapshot-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("run_snapshot_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    snapshot_kind: z.string(),
  }),
  nameTemplate: "run-snapshot/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 30,
    rationale: "Run snapshots support short-horizon replay and inspection and should rotate under the shared lifecycle engine.",
  }),
});

export const judgeEvidenceBundleArtifactClass = defineOciArtifactClass({
  key: "judge_evidence_bundle",
  version: "judge_evidence_bundle/v1",
  title: "Judge Evidence Bundle",
  description: "Judge evidence bundle packaged for durable OCI publication.",
  canonicalMediaType: "application/vnd.recallnet.factory.judge-evidence.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/judge-evidence-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/judge-evidence-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("judge_evidence_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    judge_kind: z.string(),
    subject_artifact_ref: z.string(),
  }),
  nameTemplate: "judge-evidence/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 180,
    rationale: "Judge evidence stays available long enough for operator review and release audits before shared-policy expiry.",
  }),
  trustPolicy: sharedRequiredTrustPolicy("Judge evidence bundles require canonical signing, attestations, and provenance for release auditability."),
});

export const releaseReportBundleArtifactClass = defineOciArtifactClass({
  key: "release_report_bundle",
  version: "release_report_bundle/v1",
  title: "Release Report Bundle",
  description: "Release narrative report bundle packaged for durable OCI publication.",
  canonicalMediaType: "application/vnd.recallnet.factory.release-report.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/release-report-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/release-report-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("release_report_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    report_kind: z.literal("release_narrative"),
    report_issue_url: z.string().url(),
    generated_at: z.string(),
  }),
  nameTemplate: "release-report/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 365,
    rationale: "Release reports remain operator-facing evidence and retain a one-year lifecycle under the shared policy engine.",
  }),
  trustPolicy: sharedRequiredTrustPolicy("Release report bundles are first-class release artifacts and must use the canonical signing and provenance stack."),
  governedPublisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
});

export const releaseBundleArtifactClass = defineOciArtifactClass({
  key: "release_bundle",
  version: "release_bundle/v1",
  title: "Release Bundle",
  description: "Durable release bundle and manifest publication metadata.",
  canonicalMediaType: "application/vnd.recallnet.factory.release.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/release-bundle-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/release-bundle-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("release_bundle_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    release_id: z.string(),
    channel: z.string(),
  }),
  nameTemplate: "release-bundle/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 365,
    rationale: "Release bundles remain durable release artifacts but still use a canonical one-year lifecycle policy.",
  }),
  trustPolicy: sharedRequiredTrustPolicy("Release bundles are promotion-critical artifacts and must be signed, attestable, and verifiable."),
});

export const telemetrySummaryBundleArtifactClass = defineOciArtifactClass({
  key: "telemetry_summary_bundle",
  version: "telemetry_summary_bundle/v1",
  title: "Telemetry Summary Bundle",
  description: "Durable telemetry-derived summary bundle packaged for OCI publication.",
  canonicalMediaType: "application/vnd.recallnet.factory.telemetry-summary.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/telemetry-summary-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/telemetry-summary-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("telemetry_summary_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    summary_kind: z.string(),
    window_start: z.string(),
    window_end: z.string(),
  }),
  nameTemplate: "telemetry-summary/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 90,
    rationale: "Telemetry summaries are durable but high-volume operator artifacts and should rotate under shared lifecycle enforcement.",
  }),
});

export const contractSpecBundleArtifactClass = defineOciArtifactClass({
  key: "contract_spec_bundle",
  version: "contract_spec_bundle/v1",
  title: "Contract Spec Bundle",
  description: "Generated contract and spec bundle packaged for durable OCI publication.",
  canonicalMediaType: "application/vnd.recallnet.factory.contract-spec.bundle.v1",
  sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
  metadataSchemaId: "https://recallnet.dev/contracts/contract-spec-artifact-metadata.v1.schema.json",
  metadataOutputPath: "docs/contracts/contract-spec-artifact-metadata.v1.schema.json",
  metadataSchema: z.strictObject({
    schema_version: z.literal("contract_spec_artifact_metadata/v1"),
    artifact_identity: artifactIdentitySchema,
    contract_kind: z.string(),
    contract_version: z.string(),
  }),
  nameTemplate: "contract-spec/{factory_id}/{run_id}/{workflow_source_revision}",
  filenameTemplate: "{artifact_id}.bundle",
  lifecyclePolicy: sharedSubjectPreservingLifecyclePolicy({
    retentionDays: 365,
    rationale: "Contract spec bundles remain durable references but still inherit one shared lifecycle enforcement model.",
  }),
  trustPolicy: sharedRequiredTrustPolicy("Generated contract bundles are governed outputs that require canonical provenance and attestations."),
});

export const OCI_ARTIFACT_CLASSES = Object.freeze([
  workflowIrBundleArtifactClass,
  runSnapshotBundleArtifactClass,
  judgeEvidenceBundleArtifactClass,
  releaseReportBundleArtifactClass,
  releaseBundleArtifactClass,
  telemetrySummaryBundleArtifactClass,
  contractSpecBundleArtifactClass,
]);

export function getOciArtifactClass(key = "") {
  return OCI_ARTIFACT_CLASSES.find((artifactClass) => artifactClass.key === String(key || "").trim()) || null;
}
