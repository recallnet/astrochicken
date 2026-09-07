import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildArtifactVerificationRecord,
  buildCosignSignatureRecord,
} from "@hatch/factory-core/artifact-trust-registry";
import { emitReleaseNarrativeDocument } from "../../src/commands/release-emit-narrative-document.ts";

function makeContext() {
  return {
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    generated_at: "2026-03-21T05:45:00.000Z",
    since_iso: "2026-03-20T05:45:00.000Z",
    goals: [
      {
        number: 2367,
        title: "Goal: Emit standard narrative documents from Daily Lens and release narrator",
        url: "https://github.com/recallnet/astrochicken/issues/2367",
      },
    ],
    issues: [
      {
        number: 2521,
        title: "Add deterministic narrative-document emission to release-report flow",
        url: "https://github.com/recallnet/astrochicken/issues/2521",
      },
    ],
    prs: [],
    metrics: {
      goals_closed: 1,
      issues_closed: 1,
      commits_landed: 4,
    },
    diff_stats: {
      text: "+204 -83",
    },
    timing: {
      avg_wave_minutes: 28,
      sample_count: 2,
    },
    errors: [],
  };
}

function makeNarrative() {
  return {
    delivery_decision: "slack_and_issue",
    headline: "Release reporting now emits durable narrative documents",
    before_state: "Consumers had to parse report issue markdown for structured release metadata.",
    after_state: "The release flow now emits a contract-valid narrative document artifact after issue publication.",
    summary: "Release reports now ship deterministic narrative artifacts in parallel with existing issue outputs.",
    conceptual_shift: "Release comprehension moved from issue-only transport to dual transport with contract-backed artifacts.",
    why_it_matters: "Downstream systems can consume stable metadata without scraping markdown.",
    proof_points: ["release_report_flow now emits release narrative artifacts immediately after publish_release_report."],
    structural_changes: ["A deterministic release.emit_narrative_document node now persists narrative artifacts."],
    behavioral_shifts: ["Release consumers can read JSON/markdown narrative artifacts directly from reports/release/narratives."],
    implicit_decisions: ["Narrative document contract validation remains fail-closed in the emission path."],
    entry_points: [
      "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
      "packages/factory-ops/src/commands/release-emit-narrative-document.ts",
    ],
    watch_items: ["Ensure downstream consumers migrate from issue markdown scraping to artifact reads."],
  };
}

test("emitReleaseNarrativeDocument writes contract-valid JSON/markdown artifacts and exposes durable paths", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "release-narrative-emit-"));
  const result = await emitReleaseNarrativeDocument({
    context: makeContext(),
    narrative: makeNarrative(),
    issueUrl: "https://github.com/recallnet/astrochicken/issues/3001",
    repoPath: repoRoot,
    outputDir: "reports/release/narratives",
    factoryId: "mothership",
  });

  assert.equal(result.ok, true);
  assert.match(result.narrative_id, /recallnet_astrochicken--mothership--2026-03-21T054500000Z--issue-3001/);
  assert.match(result.json_path, /reports\/release\/narratives\/.*\.json$/);
  assert.match(result.markdown_path, /reports\/release\/narratives\/.*\.md$/);
  assert.equal(result.metadata.category, "delivery");
  assert.equal(result.metadata.astro.canonical_issue_url, "https://github.com/recallnet/astrochicken/issues/3001");
  assert.equal(result.metadata.astro.visibility, "public");

  const jsonPayload = JSON.parse(await fsPromises.readFile(result.json_path, "utf8"));
  assert.equal(jsonPayload.astrochicken.backlinks.canonical_issue, "https://github.com/recallnet/astrochicken/issues/3001");
  assert.equal(jsonPayload.astrochicken.privacy.publishable, true);
  assert.equal(jsonPayload.astrochicken.privacy.contains_internal_only, false);
  assert.deepEqual(jsonPayload.metadata.taxonomy, ["delivery", "operations"]);

  const markdownPayload = await fsPromises.readFile(result.markdown_path, "utf8");
  assert.match(markdownPayload, /^---/);
  assert.match(markdownPayload, /# Release reporting now emits durable narrative documents/);
});

test("emitReleaseNarrativeDocument can publish the narrative bundle through the canonical OCI helper", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "release-narrative-emit-oci-"));
  const calls = [];
  const trustCalls = [];

  const result = await emitReleaseNarrativeDocument({
    context: makeContext(),
    narrative: makeNarrative(),
    issueUrl: "https://github.com/recallnet/astrochicken/issues/3004",
    repoPath: repoRoot,
    outputDir: "reports/release/narratives",
    factoryId: "mothership",
    runId: "run-3004",
    workflowId: "release_report_flow",
    workflowSourceRevision: "abc123def456",
    correlationId: "corr-3004",
    ociRegistryRepository: "registry.example.dev/astrochicken",
    ociSubjectArtifactRef: "registry.example.dev/astrochicken:release-bundle-run-3004",
    publishOciArtifactFn(plan) {
      calls.push(plan);
      return { ok: true, artifact_ref: plan.artifact_ref, digest: "sha256:deadbeef", signature: "c2lnbmF0dXJl" };
    },
    applyOciArtifactTrustFn({ publicationPlan, publishResult, defaultAttestation }) {
      trustCalls.push({ publicationPlan, publishResult, defaultAttestation });
      return {
        signature: buildCosignSignatureRecord({
          keyId: "release-reporting-key",
          signature: "c2lnbmF0dXJl",
          payloadRef: publicationPlan.artifact_ref,
          payloadType: "oci_artifact",
          payloadDigest: publishResult.digest,
        }),
        attestations: [defaultAttestation],
        verifications: ["release", "promotion"].map((boundary) => buildArtifactVerificationRecord({
          boundary,
          status: "verified",
          verifiedAt: "2026-03-21T05:45:00.000Z",
        })),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(trustCalls.length, 1);
  assert.equal(result.oci_publication.artifact_class, "release_report_bundle");
  assert.equal(result.oci_publication.artifact_ref, "registry.example.dev/astrochicken:release-report-mothership-run-3004");
  assert.equal(result.oci_publication.publish_result.digest, "sha256:deadbeef");
  assert.equal(result.oci_publication.trust.policy.signing_stack, "cosign");
  assert.equal(result.oci_publication.trust.attestations[0].predicate_type, "https://slsa.dev/provenance/v1");
  assert.equal(result.oci_publication.trust.verifications[0].boundary, "release");
  assert.equal(result.oci_publication.lifecycle_policy.enforcement_mode, "shared_policy_engine");
  assert.equal(result.oci_publication.lifecycle_evaluation.status, "retained");
  assert.equal(result.oci_publication.lifecycle_evaluation.retain_until, "2027-03-21T05:45:00.000Z");
  assert.equal(
    result.oci_publication.subject_discovery.subject_artifact_ref,
    "registry.example.dev/astrochicken:release-bundle-run-3004",
  );
  assert.deepEqual(result.oci_publication.subject_discovery.args, [
    "oras",
    "discover",
    "--output",
    "json",
    "registry.example.dev/astrochicken:release-bundle-run-3004",
  ]);
  assert.equal(calls[0].metadata.artifact_identity.factory_id, "mothership");
  assert.equal(calls[0].metadata.artifact_identity.run_id, "run-3004");
  assert.equal(calls[0].metadata.artifact_identity.workflow_id, "release_report_flow");
  assert.equal(calls[0].subject.subject_artifact_ref, "registry.example.dev/astrochicken:release-bundle-run-3004");
  assert.equal(calls[0].subject.relationship_name, "release_report_for");
  assert.match(calls[0].args.join(" "), /--subject registry\.example\.dev\/astrochicken:release-bundle-run-3004/);
});

test("emitReleaseNarrativeDocument fails closed when trust material is missing for governed OCI publication", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "release-narrative-emit-oci-trust-fail-"));

  await assert.rejects(
    () => emitReleaseNarrativeDocument({
      context: makeContext(),
      narrative: makeNarrative(),
      issueUrl: "https://github.com/recallnet/astrochicken/issues/3005",
      repoPath: repoRoot,
      outputDir: "reports/release/narratives",
      factoryId: "mothership",
      runId: "run-3005",
      ociRegistryRepository: "registry.example.dev/astrochicken",
      publishOciArtifactFn(plan) {
        return { ok: true, artifact_ref: plan.artifact_ref, digest: "sha256:deadbeef" };
      },
    }),
    /oci_artifact_trust_required/,
  );
});

test("emitReleaseNarrativeDocument fails closed when issue URL is missing", async () => {
  await assert.rejects(
    () => emitReleaseNarrativeDocument({
      context: makeContext(),
      narrative: makeNarrative(),
      issueUrl: "",
      repoPath: mkdtempSync(join(tmpdir(), "release-narrative-emit-fail-")),
    }),
    /release_narrative_emit_failed:missing_issue_url/,
  );
});

test("emitReleaseNarrativeDocument enforces metadata taxonomy/category contract", async () => {
  await assert.rejects(
    () => emitReleaseNarrativeDocument({
      context: makeContext(),
      narrative: makeNarrative(),
      issueUrl: "https://github.com/recallnet/astrochicken/issues/3002",
      repoPath: mkdtempSync(join(tmpdir(), "release-narrative-emit-fail-taxonomy-")),
      taxonomy: ["delivery", "discovery"],
    }),
    /narrative_taxonomy_invalid:discovery/,
  );

  await assert.rejects(
    () => emitReleaseNarrativeDocument({
      context: makeContext(),
      narrative: makeNarrative(),
      issueUrl: "https://github.com/recallnet/astrochicken/issues/3003",
      repoPath: mkdtempSync(join(tmpdir(), "release-narrative-emit-fail-category-")),
      taxonomy: ["delivery"],
      category: "quality",
    }),
    /narrative_document_metadata_category_mismatch:quality/,
  );
});
