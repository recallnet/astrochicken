import { promises as fsPromises } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  buildArtifactTrustBundle,
  buildArtifactVerificationRecord,
  buildCosignSignatureRecord,
  buildSlsaAttestation,
  buildSlsaProvenancePredicate,
} from "@hatch/factory-core/artifact-trust-registry";
import {
  buildOciArtifactIdentity,
  buildOciArtifactDiscoverPlan,
  buildOciArtifactLifecycleEvaluation,
  buildOciArtifactPublicationPlan,
  buildOciArtifactRef,
  buildOciSubjectReferrerRelation,
} from "@hatch/factory-core/oci-artifact-registry";

import { emitNarrativeDocument } from "../lib/narrative-document/emit.ts";
import { getOciArtifactClass } from "../lib/oci-artifact-taxonomy.ts";

function asString(value) {
  return String(value ?? "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (value === undefined) return [];
  const source = Array.isArray(value) ? value : [value];
  return source.map((entry) => asString(entry)).filter(Boolean);
}

function parseIssueNumberFromUrl(url = "") {
  const match = asString(url).match(/\/issues\/(\d+)(?:$|[/?#])/u);
  return Number(match?.[1] || 0);
}

function renderList(items = [], fallback = "") {
  const rows = asArray(items).map((item) => `- ${item}`);
  return rows.length > 0 ? rows.join("\n") : fallback;
}

function resolveOutputDir({ outputDir = "", repoPath = "." } = {}) {
  const normalizedOutputDir = asString(outputDir);
  if (!normalizedOutputDir) return join(asString(repoPath) || ".", "reports", "release", "narratives");
  if (isAbsolute(normalizedOutputDir)) return normalizedOutputDir;
  return join(asString(repoPath) || ".", normalizedOutputDir);
}

function normalizePublishedOn(value = "") {
  const parsed = Date.parse(asString(value));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function resolveReleaseNarrativeId({ context = {}, factoryId = "", issueUrl = "" } = {}) {
  const generatedAt = asString(context?.generated_at);
  const normalizedFactoryId = asString(factoryId || context?.factory_id) || "unknown-factory";
  const normalizedRepo = asString(context?.repo) || "unknown-repo";
  const normalizedIssueNumber = Number(parseIssueNumberFromUrl(issueUrl) || 0);

  if (!generatedAt) {
    throw new Error("release_narrative_emit_failed:missing_generated_at");
  }

  const releaseStamp = generatedAt
    .replace(/[:.]/g, "")
    .replace(/\+|\//g, "-")
    .replace(/\s+/g, "_");

  const repoSlug = normalizedRepo.replace(/[^a-zA-Z0-9._-]/g, "_");
  const issueSuffix = Number.isFinite(normalizedIssueNumber) && normalizedIssueNumber > 0
    ? `issue-${Math.trunc(normalizedIssueNumber)}`
    : "issue-unknown";

  return `${repoSlug}--${normalizedFactoryId}--${releaseStamp}--${issueSuffix}`;
}

function inferVisibility({ publishable = true, containsInternalOnly = false } = {}) {
  if (containsInternalOnly) return "internal-only";
  return publishable ? "public" : "internal-only";
}

function buildReleaseNarrativeDocument({ context = {}, narrative = {}, issueUrl = "" } = {}) {
  const headline = asString(narrative?.headline) || "Release understanding report";
  const summary = asString(narrative?.summary) || "Release summary was not provided.";
  const reportBody = asString(narrative?.report_body);

  const document = {
    title: headline,
    abstract: summary,
    sections: reportBody
      ? [{ heading: "Report", body: reportBody }]
      : [{ heading: "Summary", body: summary }],
    metadata: {
      taxonomy: ["delivery", "operations"],
      source: "release-report",
    },
    astrochicken: {
      backlinks: {
        canonical_issue: asString(issueUrl),
      },
      privacy: {
        publishable: true,
        contains_internal_only: false,
      },
    },
  };

  const metadata = {
    title: headline,
    summary,
    category: "delivery",
    published_on: normalizePublishedOn(context?.generated_at),
    tags: ["release-report", "factory-ops"],
    topics: [asString(context?.repo), asString(context?.factory_id)].filter(Boolean),
    astro: {
      canonical_issue_url: asString(issueUrl),
      visibility: "public",
      internal_only_sections: [],
    },
  };

  return { document, metadata };
}

export async function emitReleaseNarrativeDocument(options = {}) {
  const {
    context = {},
    narrative = {},
    issueUrl = "",
    repoPath = ".",
    outputDir = "",
    factoryId = "",
    taxonomy = undefined,
    category = "",
    tags = undefined,
    topics = undefined,
    publishable = undefined,
    containsInternalOnly = undefined,
    internalOnlySections = undefined,
    runId = "",
    workflowId = "",
    workflowSourceRevision = "",
    correlationId = "",
    traceparent = "",
    tracestate = "",
    ociRegistryRepository = "",
    ociSubjectArtifactRef = "",
    publishOciArtifactFn = null,
    applyOciArtifactTrustFn = null,
    ociTrustKeyId = "",
    provenanceBuilderId = "",
    fs = {},
  } = options;

  const normalizedContext = asObject(context);
  const normalizedNarrative = asObject(narrative);
  const normalizedIssueUrl = asString(issueUrl || narrative?.report_issue_url || context?.report_issue_url);

  if (!normalizedIssueUrl) {
    throw new Error("release_narrative_emit_failed:missing_issue_url");
  }

  if (!asString(normalizedContext?.generated_at)) {
    throw new Error("release_narrative_emit_failed:missing_generated_at");
  }

  const resolvedOutputDir = resolveOutputDir({ outputDir, repoPath });
  const narrativeId = resolveReleaseNarrativeId({
    context: normalizedContext,
    factoryId,
    issueUrl: normalizedIssueUrl,
  });
  const narrativeJsonPath = join(resolvedOutputDir, `${narrativeId}.json`);
  const narrativeMarkdownPath = join(resolvedOutputDir, `${narrativeId}.md`);

  const { document, metadata } = buildReleaseNarrativeDocument({
    context: normalizedContext,
    narrative: normalizedNarrative,
    issueUrl: normalizedIssueUrl,
  });

  const normalizedTaxonomy = asArray(taxonomy);
  if (normalizedTaxonomy.length > 0) {
    document.metadata.taxonomy = normalizedTaxonomy;
  }

  const normalizedCategory = asString(category);
  if (normalizedCategory) metadata.category = normalizedCategory;

  const normalizedTags = asArray(tags);
  if (normalizedTags.length > 0) metadata.tags = normalizedTags;

  const normalizedTopics = asArray(topics);
  if (normalizedTopics.length > 0) metadata.topics = normalizedTopics;

  const resolvedPublishable = typeof publishable === "boolean"
    ? publishable
    : document.astrochicken.privacy.publishable;
  const resolvedContainsInternalOnly = typeof containsInternalOnly === "boolean"
    ? containsInternalOnly
    : document.astrochicken.privacy.contains_internal_only;

  const normalizedInternalOnlySections = asArray(internalOnlySections);

  document.astrochicken.privacy.publishable = resolvedPublishable;
  document.astrochicken.privacy.contains_internal_only = resolvedContainsInternalOnly;
  metadata.astro.visibility = inferVisibility({
    publishable: resolvedPublishable,
    containsInternalOnly: resolvedContainsInternalOnly,
  });
  metadata.astro.internal_only_sections = normalizedInternalOnlySections;

  const emitted = emitNarrativeDocument({
    document,
    metadata,
    astroContext: {
      canonical_issue: normalizedIssueUrl,
      publishable: resolvedPublishable,
      contains_internal_only: resolvedContainsInternalOnly,
      internal_only_sections: normalizedInternalOnlySections,
    },
    outputPath: narrativeMarkdownPath,
  });

  const runtimeFs = {
    mkdir: fs?.mkdir || fsPromises.mkdir.bind(fsPromises),
    writeFile: fs?.writeFile || fsPromises.writeFile.bind(fsPromises),
  };

  await runtimeFs.mkdir(resolvedOutputDir, { recursive: true });
  await runtimeFs.writeFile(narrativeJsonPath, `${JSON.stringify(emitted.documentJson, null, 2)}\n`, "utf8");
  await runtimeFs.writeFile(narrativeMarkdownPath, `${String(emitted.markdown || "").replace(/\n?$/, "\n")}`, "utf8");

  let ociPublication = null;
  if (asString(ociRegistryRepository)) {
    const artifactClass = getOciArtifactClass("release_report_bundle");
    const normalizedFactoryId = asString(factoryId || normalizedContext?.factory_id) || "unknown-factory";
    const normalizedRunId = asString(runId) || narrativeId;
    const artifactRef = buildOciArtifactRef({
      registryRepository: asString(ociRegistryRepository),
      tag: `release-report-${normalizedFactoryId}-${normalizedRunId}`.replace(/[^A-Za-z0-9._-]+/g, "-"),
    });
    const plan = buildOciArtifactPublicationPlan({
      artifactClass,
      artifactRef,
      metadata: {
        schema_version: "release_report_artifact_metadata/v1",
        artifact_identity: buildOciArtifactIdentity({
          factoryId: normalizedFactoryId,
          runId: normalizedRunId,
          capabilityId: "release-reporting",
          workflowId: asString(workflowId) || "release_report_flow",
          workflowSourceRevision: asString(workflowSourceRevision),
          correlationId: asString(correlationId) || narrativeId,
          traceparent,
          tracestate,
        }),
        report_kind: "release_narrative",
        report_issue_url: normalizedIssueUrl,
        generated_at: asString(normalizedContext.generated_at),
      },
      files: [
        { path: narrativeJsonPath, mediaType: "application/json" },
        { path: narrativeMarkdownPath, mediaType: "text/markdown" },
      ],
      ...(asString(ociSubjectArtifactRef)
        ? {
          subject: buildOciSubjectReferrerRelation({
            subjectArtifactRef: asString(ociSubjectArtifactRef),
            relationshipName: "release_report_for",
          }),
        }
        : {}),
    });
    const publishResult = typeof publishOciArtifactFn === "function" ? await publishOciArtifactFn(plan) : null;
    if (artifactClass?.trustPolicy?.required === true && typeof applyOciArtifactTrustFn !== "function") {
      throw new Error("oci_artifact_trust_required");
    }
    let trust = null;
    if (typeof applyOciArtifactTrustFn === "function") {
      const defaultAttestation = buildSlsaAttestation({
        predicate: buildSlsaProvenancePredicate({
          buildType: "https://recallnet.dev/build/release-report-bundle",
          builderId: asString(provenanceBuilderId) || "https://recallnet.dev/builders/release-reporting",
          invocationId: normalizedRunId,
          startedOn: asString(normalizedContext.generated_at),
          finishedOn: asString(normalizedContext.generated_at),
          externalParameters: {
            artifact_ref: plan.artifact_ref,
            report_issue_url: normalizedIssueUrl,
          },
          internalParameters: {
            factory_id: normalizedFactoryId,
            workflow_id: asString(workflowId) || "release_report_flow",
            workflow_source_revision: asString(workflowSourceRevision),
          },
          resolvedDependencies: [{
            uri: asString(ociSubjectArtifactRef) || plan.artifact_ref,
            digest: {
              sha256: asString(publishResult?.digest || "").replace(/^sha256:/, "") || "unknown",
            },
          }],
        }),
        keyId: asString(ociTrustKeyId) || "release-reporting-key",
        signature: asString(publishResult?.signature || "c2lnbmF0dXJl"),
      });
      const trustResult = await applyOciArtifactTrustFn({
        artifactClass,
        publicationPlan: plan,
        publishResult,
        defaultAttestation,
      });
      trust = buildArtifactTrustBundle({
        policy: artifactClass.trustPolicy,
        signature: trustResult?.signature || buildCosignSignatureRecord({
          keyId: asString(ociTrustKeyId) || "release-reporting-key",
          signature: asString(publishResult?.signature || "c2lnbmF0dXJl"),
          payloadRef: plan.artifact_ref,
          payloadType: "oci_artifact",
          payloadDigest: asString(publishResult?.digest || "sha256:unknown"),
        }),
        attestations: Array.isArray(trustResult?.attestations) && trustResult.attestations.length > 0
          ? trustResult.attestations
          : [defaultAttestation],
        verifications: Array.isArray(trustResult?.verifications) && trustResult.verifications.length > 0
          ? trustResult.verifications
          : artifactClass.trustPolicy.verification_boundaries.map((boundary) => buildArtifactVerificationRecord({
            boundary,
            status: "verified",
            verifiedAt: asString(normalizedContext.generated_at),
          })),
      });
    }
    ociPublication = {
      artifact_class: plan.artifact_class,
      artifact_ref: plan.artifact_ref,
      media_type: plan.media_type,
      lifecycle_policy: plan.lifecycle_policy,
      ...(plan.trust_policy ? { trust_policy: plan.trust_policy } : {}),
      lifecycle_evaluation: buildOciArtifactLifecycleEvaluation({
        artifactClass,
        artifactRef: plan.artifact_ref,
        publishedAt: asString(normalizedContext.generated_at),
      }),
      ...(plan.subject ? { subject: plan.subject } : {}),
      ...(plan.subject ? {
        subject_discovery: buildOciArtifactDiscoverPlan({
          subjectArtifactRef: plan.subject.subject_artifact_ref,
        }),
      } : {}),
      publish_result: publishResult,
      ...(trust ? { trust } : {}),
    };
  }

  return {
    ok: true,
    narrative_id: narrativeId,
    issue_url: normalizedIssueUrl,
    json_path: narrativeJsonPath,
    markdown_path: narrativeMarkdownPath,
    metadata: emitted.metadata,
    ...(ociPublication ? { oci_publication: ociPublication } : {}),
  };
}
