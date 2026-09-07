import assert from "node:assert/strict";
import test from "node:test";

import { z } from "../packages/factory-core/src/oci-artifact-registry.ts";
import { defineArtifactTrustPolicy } from "../packages/factory-core/src/artifact-trust-registry.ts";
import { analyzeOciArtifactContract } from "./lib/oci-artifact-contract.ts";

function sampleClass() {
  return {
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
      }),
      report_kind: z.literal("release_narrative"),
      report_issue_url: z.string().url(),
      generated_at: z.string(),
    }),
    lifecyclePolicy: {
      schema_version: "oci_artifact_lifecycle_policy/v1",
      retention_days: 365,
      expiry_action: "review_delete",
      enforcement_mode: "shared_policy_engine",
      preserve_subject_referrers: true,
      rationale: "Release reports inherit the shared lifecycle engine.",
    },
    trustPolicy: defineArtifactTrustPolicy({
      rationale: "Release reports are governed signed artifacts.",
    }),
    governedPublisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
  };
}

test("oci artifact contract fails when governed publishers bypass the canonical helper", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    readFile() {
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_governed_publisher_missing_helper_import")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_governed_publisher_missing_trust_helper")));
});

test("oci artifact contract fails on discovered but unregistered artifact class modules", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    discoveredSourcePaths: [
      "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
      "packages/factory-ops/src/lib/rogue-oci-artifact.mjs",
    ],
    readFile() {
      return [
        'import { publishOciArtifact } from "@hatch/factory-core/oci-artifact-registry";',
        'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
      ].join("\n");
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_unregistered_source")));
});

test("oci artifact contract fails on discovered but unregistered governed publisher modules", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    discoveredPublisherPaths: [
      "packages/factory-ops/src/commands/release-emit-narrative-document.ts",
      "packages/factory-ops/src/commands/release-publish-evidence-bundle.mjs",
    ],
    readFile() {
      return [
        'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
        'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
      ].join("\n");
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_unregistered_governed_publisher")));
});

test("oci artifact contract fails on direct oras usage outside canonical helper ownership", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    readFile(filePath) {
      if (filePath === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return [
          'import { publishOciArtifact } from "@hatch/factory-core/oci-artifact-registry";',
          'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
          'const cmd = "oras push";',
        ].join("\n");
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_direct_oras_usage")));
});

test("oci artifact contract fails when bespoke subject identifiers remain in governed artifact metadata", () => {
  const artifactClass = {
    ...sampleClass(),
    key: "judge_evidence_bundle",
    metadataSchemaId: "https://recallnet.dev/contracts/judge-evidence-artifact-metadata.v1.schema.json",
    metadataOutputPath: "docs/contracts/judge-evidence-artifact-metadata.v1.schema.json",
    metadataSchema: z.strictObject({
      schema_version: z.literal("judge_evidence_artifact_metadata/v1"),
      artifact_identity: z.strictObject({
        factory_id: z.string(),
      }),
      judge_kind: z.string(),
      subject_id: z.string(),
    }),
  };

  const analysis = analyzeOciArtifactContract({
    artifactClasses: [artifactClass],
    readFile() {
      return [
        'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
        'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
      ].join("\n");
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_bespoke_attachment_identifier")));
});

test("oci artifact contract fails when governed publishers use legacy subjectRef attachment wiring", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    readFile(filePath) {
      if (filePath === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return [
          'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
          'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
          'const plan = buildOciArtifactPublicationPlan({ subjectRef: "https://github.com/recallnet/astrochicken/issues/3004" });',
        ].join("\n");
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_legacy_subject_ref_usage")));
});

test("oci artifact contract fails when a governed artifact class has no lifecycle policy", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [
      {
        ...sampleClass(),
        lifecyclePolicy: null,
      },
    ],
    readFile() {
      return [
        'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
        'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
      ].join("\n");
    },
  });

  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_missing_lifecycle_policy")));
});

test("oci artifact contract fails when governed publishers carry bespoke lifecycle fields without the shared lifecycle helper", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    readFile(path) {
      if (path === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return [
          'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
          'import { buildArtifactTrustBundle } from "@hatch/factory-core/artifact-trust-registry";',
          "const retain_until = '2027-03-21T05:45:00.000Z';",
        ].join("\n");
      }
      return "";
    },
  });

  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_bespoke_lifecycle_policy")));
});

test("oci artifact contract fails when a required trust-governed publisher bypasses the canonical trust helper", () => {
  const analysis = analyzeOciArtifactContract({
    artifactClasses: [sampleClass()],
    readFile(path) {
      if (path === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return [
          'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";',
          "const attestation = 'custom';",
        ].join("\n");
      }
      return "";
    },
  });

  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_governed_publisher_missing_trust_helper")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("oci_bespoke_trust_material")));
});
