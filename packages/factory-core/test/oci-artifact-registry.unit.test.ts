import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOciArtifactIdentity,
  buildOciArtifactLifecycleEvaluation,
  buildOciArtifactPublicationPlan,
  buildOciArtifactRef,
  buildOciSubjectReferrerRelation,
  buildOciArtifactDiscoverPlan,
  defineOciArtifactClass,
  exportOciArtifactMetadataSchema,
  exportOciArtifactTaxonomyDocument,
  z,
} from "../src/oci-artifact-registry.ts";
import { defineArtifactTrustPolicy } from "../src/artifact-trust-registry.ts";

test("OCI artifact registry exports canonical taxonomy and metadata schema documents", () => {
  const artifactClass = defineOciArtifactClass({
    key: "release_report_bundle",
    version: "release_report_bundle/v1",
    title: "Release Report Bundle",
    description: "Durable release report bundle packaged for OCI publication.",
    canonicalMediaType: "application/vnd.recallnet.factory.release-report.bundle.v1",
    sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    metadataSchemaId: "https://recallnet.dev/contracts/release-report-artifact-metadata.v1.schema.json",
    metadataOutputPath: "docs/contracts/release-report-artifact-metadata.v1.schema.json",
    metadataSchema: z.strictObject({
      schema_version: z.literal("release_report_artifact_metadata/v1"),
      artifact_identity: z.strictObject({
        factory_id: z.string(),
        run_id: z.string(),
        capability_id: z.string(),
        workflow_id: z.string(),
        workflow_source_revision: z.string(),
        correlation_id: z.string(),
        traceparent: z.string().optional(),
        tracestate: z.string().optional(),
      }),
      report_issue_url: z.string().url(),
      report_kind: z.literal("release_narrative"),
      generated_at: z.string(),
    }),
    nameTemplate: "release-report/{factory_id}/{run_id}/{workflow_source_revision}",
    filenameTemplate: "{artifact_id}.bundle",
    trustPolicy: defineArtifactTrustPolicy({
      rationale: "Release reports are required signed artifacts.",
    }),
  });

  const taxonomy = exportOciArtifactTaxonomyDocument([artifactClass]);
  const schema = exportOciArtifactMetadataSchema(artifactClass);

  assert.equal(taxonomy.schema_version, "oci_artifact_taxonomy/v1");
  assert.equal(taxonomy.classes[0].key, "release_report_bundle");
  assert.equal(taxonomy.classes[0].canonical_media_type, "application/vnd.recallnet.factory.release-report.bundle.v1");
  assert.equal(taxonomy.classes[0].trust_policy.signing_stack, "cosign");
  assert.equal(schema.$id, "https://recallnet.dev/contracts/release-report-artifact-metadata.v1.schema.json");
  assert.equal(schema.title, "Release Report Bundle Metadata");
});

test("OCI publication plan is built from canonical taxonomy, identity, and durable files", () => {
  const artifactClass = defineOciArtifactClass({
    key: "judge_evidence_bundle",
    version: "judge_evidence_bundle/v1",
    title: "Judge Evidence Bundle",
    canonicalMediaType: "application/vnd.recallnet.factory.judge-evidence.bundle.v1",
    sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    metadataSchemaId: "https://recallnet.dev/contracts/judge-evidence-artifact-metadata.v1.schema.json",
    metadataOutputPath: "docs/contracts/judge-evidence-artifact-metadata.v1.schema.json",
    metadataSchema: z.strictObject({
      schema_version: z.literal("judge_evidence_artifact_metadata/v1"),
      artifact_identity: z.strictObject({
        factory_id: z.string(),
        run_id: z.string(),
        capability_id: z.string(),
        workflow_id: z.string(),
        workflow_source_revision: z.string(),
        correlation_id: z.string(),
        traceparent: z.string().optional(),
        tracestate: z.string().optional(),
      }),
      judge_kind: z.string(),
      subject_artifact_ref: z.string(),
    }),
    nameTemplate: "judge-evidence/{factory_id}/{run_id}/{workflow_source_revision}",
    filenameTemplate: "{artifact_id}.bundle",
    lifecyclePolicy: {
      retentionDays: 180,
      expiryAction: "review_delete",
      enforcementMode: "shared_policy_engine",
      preserveSubjectReferrers: true,
      rationale: "Judge evidence uses the shared lifecycle engine.",
    },
  });

  const identity = buildOciArtifactIdentity({
    factoryId: "mothership",
    runId: "run-123",
    capabilityId: "judge",
    workflowId: "goal_run",
    workflowSourceRevision: "abc123def456",
    correlationId: "corr-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
  });

  const publication = buildOciArtifactPublicationPlan({
    artifactClass,
    artifactRef: buildOciArtifactRef({
      registryRepository: "registry.example.dev/astrochicken",
      tag: "judge-evidence-run-123",
    }),
    metadata: {
      schema_version: "judge_evidence_artifact_metadata/v1",
      artifact_identity: identity,
      judge_kind: "wave_execution_post_merge",
      subject_artifact_ref: "registry.example.dev/astrochicken:goal-123-wave-1",
    },
    files: [
      { path: "reports/judge/evidence.json", mediaType: "application/json" },
      { path: "reports/judge/evidence.md", mediaType: "text/markdown" },
    ],
    subject: buildOciSubjectReferrerRelation({
      subjectArtifactRef: "registry.example.dev/astrochicken:goal-123-wave-1",
      relationshipName: "evidence_for",
    }),
  });

  assert.equal(publication.artifact_class, "judge_evidence_bundle");
  assert.equal(publication.artifact_ref, "registry.example.dev/astrochicken:judge-evidence-run-123");
  assert.equal(publication.media_type, "application/vnd.recallnet.factory.judge-evidence.bundle.v1");
  assert.equal(publication.metadata.artifact_identity.factory_id, "mothership");
  assert.equal(publication.lifecycle_policy.retention_days, 180);
  assert.equal(publication.lifecycle_policy.enforcement_mode, "shared_policy_engine");
  assert.equal(publication.subject.subject_artifact_ref, "registry.example.dev/astrochicken:goal-123-wave-1");
  assert.equal(publication.subject.relationship_name, "evidence_for");
  assert.match(publication.args.join(" "), /oras push registry\.example\.dev\/astrochicken:judge-evidence-run-123/);
  assert.match(publication.args.join(" "), /--artifact-type application\/vnd\.recallnet\.factory\.judge-evidence\.bundle\.v1/);
  assert.match(publication.args.join(" "), /--subject registry\.example\.dev\/astrochicken:goal-123-wave-1/);
});

test("OCI discover plan uses canonical subject artifact references", () => {
  const discoverPlan = buildOciArtifactDiscoverPlan({
    subjectArtifactRef: "registry.example.dev/astrochicken:release-bundle-run-123",
  });

  assert.equal(discoverPlan.subject_artifact_ref, "registry.example.dev/astrochicken:release-bundle-run-123");
  assert.deepEqual(discoverPlan.args, [
    "oras",
    "discover",
    "--output",
    "json",
    "registry.example.dev/astrochicken:release-bundle-run-123",
  ]);
});

test("OCI lifecycle evaluation derives retain-until from the canonical lifecycle policy", () => {
  const artifactClass = defineOciArtifactClass({
    key: "release_report_bundle",
    version: "release_report_bundle/v1",
    title: "Release Report Bundle",
    canonicalMediaType: "application/vnd.recallnet.factory.release-report.bundle.v1",
    sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    metadataSchemaId: "https://recallnet.dev/contracts/release-report-artifact-metadata.v1.schema.json",
    metadataOutputPath: "docs/contracts/release-report-artifact-metadata.v1.schema.json",
    metadataSchema: z.strictObject({
      schema_version: z.literal("release_report_artifact_metadata/v1"),
      artifact_identity: z.strictObject({
        factory_id: z.string(),
        run_id: z.string(),
        capability_id: z.string(),
        workflow_id: z.string(),
        workflow_source_revision: z.string(),
        correlation_id: z.string(),
      }),
      report_kind: z.literal("release_narrative"),
      report_issue_url: z.string().url(),
      generated_at: z.string(),
    }),
    nameTemplate: "release-report/{factory_id}/{run_id}/{workflow_source_revision}",
    filenameTemplate: "{artifact_id}.bundle",
    lifecyclePolicy: {
      retentionDays: 365,
      expiryAction: "review_delete",
      enforcementMode: "shared_policy_engine",
      preserveSubjectReferrers: true,
      rationale: "Release reports inherit the shared lifecycle engine.",
    },
  });

  const evaluation = buildOciArtifactLifecycleEvaluation({
    artifactClass,
    artifactRef: "registry.example.dev/astrochicken:release-report-mothership-run-3004",
    publishedAt: "2026-03-21T05:45:00.000Z",
    asOf: "2026-03-22T05:45:00.000Z",
  });

  assert.equal(evaluation.artifact_class, "release_report_bundle");
  assert.equal(evaluation.lifecycle_policy.retention_days, 365);
  assert.equal(evaluation.status, "retained");
  assert.equal(evaluation.retain_until, "2027-03-21T05:45:00.000Z");
});
