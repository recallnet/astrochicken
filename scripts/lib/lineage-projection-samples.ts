import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildHatchRunLifecycleLineageProjection,
  buildReleaseRolloutLineageProjection,
  buildOciArtifactLineageDataset,
} from "../../packages/factory-core/src/openlineage-registry.ts";

export const OPENLINEAGE_SAMPLES_JSON_PATH = "docs/contracts/openlineage-samples.json";
export const OPENLINEAGE_SAMPLES_MARKDOWN_PATH = "docs/contracts/openlineage-samples.md";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildOpenLineageSamples() {
  const hatchRunLifecycle = buildHatchRunLifecycleLineageProjection({
    event: "artifact",
    graph: "wave_execute",
    runId: "sample-run",
    artifactUrl: "oci://ghcr.io/recallnet/factory/release-report:sample",
  });
  const releaseRollout = buildReleaseRolloutLineageProjection({
    channel: "stable",
    release_id: "sample-release",
    action: "publish",
    status: "published",
    asset_url: "oci://ghcr.io/recallnet/factory/release-report:sample",
  });
  const releaseReportArtifact = {
    eventType: "OUTPUT",
    outputs: [
      buildOciArtifactLineageDataset({
        artifactClassKey: "release_report_bundle",
        artifactRef: "oci://ghcr.io/recallnet/factory/release-report:sample",
      }),
    ].filter(Boolean),
  };

  return {
    schema_version: "openlineage_samples/v1",
    samples: {
      hatch_run_lifecycle: hatchRunLifecycle,
      release_rollout: releaseRollout,
      release_report_bundle: releaseReportArtifact,
    },
  };
}

function renderMarkdown(document) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Concrete OpenLineage-compatible sample projections for supported run and artifact classes."',
    'tags: [contracts, generated, lineage, openlineage, samples]',
    'written: "2026-03-21"',
    "---",
    "",
    "# OpenLineage Samples",
    "",
    "- `hatch_run_lifecycle` sample present",
    "- `release_rollout` sample present",
    "- `release_report_bundle` sample present",
    "",
  ].join("\n");
}

export function analyzeLineageProjectionSamples({ expectedJson = "", expectedMarkdown = "" } = {}) {
  const document = buildOpenLineageSamples();
  const renderedJson = stableJson(document);
  const renderedMarkdown = `${renderMarkdown(document)}\n`;
  const diagnostics = [];
  for (const [key, sample] of Object.entries(document.samples || {})) {
    if (!sample) {
      diagnostics.push(`lineage_projection_sample_missing key=${JSON.stringify(key)}`);
    }
  }
  if (expectedJson && expectedJson !== renderedJson) {
    diagnostics.push(`lineage_projection_sample_drift path=${JSON.stringify(OPENLINEAGE_SAMPLES_JSON_PATH)}`);
  }
  if (expectedMarkdown && expectedMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`lineage_projection_sample_drift path=${JSON.stringify(OPENLINEAGE_SAMPLES_MARKDOWN_PATH)}`);
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    renderedJson,
    renderedMarkdown,
    document,
  };
}

export function writeLineageProjectionSamples({ repoRoot = process.cwd() } = {}) {
  const analysis = analyzeLineageProjectionSamples();
  writeFileSync(path.join(repoRoot, OPENLINEAGE_SAMPLES_JSON_PATH), analysis.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, OPENLINEAGE_SAMPLES_MARKDOWN_PATH), analysis.renderedMarkdown, "utf8");
  return analyzeLineageProjectionSamples({
    expectedJson: analysis.renderedJson,
    expectedMarkdown: analysis.renderedMarkdown,
  });
}
