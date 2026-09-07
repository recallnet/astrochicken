import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHatchRunLifecycleLineageProjection,
  buildOciArtifactLineageDataset,
  buildReleaseRolloutLineageProjection,
  exportOpenLineageRegistryDocument,
  normalizeOpenLineageProjection,
  stringifyOpenLineageRegistryDocument,
} from "../src/openlineage-registry.ts";

test("buildHatchRunLifecycleLineageProjection maps lifecycle events into canonical lineage facts", () => {
  const startProjection = buildHatchRunLifecycleLineageProjection({
    event: "run-start",
    graph: "wave_execute",
    runId: "run-123",
  });
  assert.deepEqual(startProjection, {
    eventType: "START",
    inputs: [],
    job: { namespace: "hatch.graph", name: "wave_execute" },
    run: { runId: "run-123" },
  });

  const artifactProjection = buildHatchRunLifecycleLineageProjection({
    event: "artifact",
    graph: "wave_execute",
    runId: "run-123",
    artifactUrl: "https://example.test/artifacts/review-123",
  });
  assert.deepEqual(artifactProjection, {
    eventType: "OUTPUT",
    job: { namespace: "hatch.graph", name: "wave_execute" },
    outputs: [{ namespace: "artifact", name: "https://example.test/artifacts/review-123" }],
    run: { runId: "run-123" },
  });
});

test("buildReleaseRolloutLineageProjection emits downstream-compatible release rollout lineage", () => {
  const promoted = buildReleaseRolloutLineageProjection({
    action: "promote",
    channel: "stable",
    status: "promoted",
    release_id: "v2.1.0",
    run_id: "release-run-7",
    asset_url: "https://example.test/assets/release-manifest.json",
  });
  assert.deepEqual(promoted, {
    eventType: "COMPLETE",
    job: { namespace: "factory.release.rollout", name: "stable" },
    outputs: [{ namespace: "release.asset", name: "https://example.test/assets/release-manifest.json" }],
    run: { runId: "release-run-7" },
  });

  const pending = buildReleaseRolloutLineageProjection({
    action: "publish",
    channel: "canary",
    status: "pending",
    release_id: "v2.1.0",
    run_id: "",
  });
  assert.deepEqual(pending, {
    eventType: "RUN",
    job: { namespace: "factory.release.rollout", name: "canary" },
    run: { runId: "release-rollout:v2.1.0:publish:canary" },
  });
});

test("buildOciArtifactLineageDataset emits canonical governed artifact dataset identities", () => {
  assert.deepEqual(
    buildOciArtifactLineageDataset({
      artifactClassKey: "workflow_ir_bundle",
      artifactRef: "ghcr.io/recallnet/factory/workflow-ir:mothership-write-scenarios",
    }),
    {
      namespace: "oci.artifact.workflow_ir_bundle",
      name: "ghcr.io/recallnet/factory/workflow-ir:mothership-write-scenarios",
    },
  );
});

test("normalizeOpenLineageProjection rejects invalid payloads and registry output is deterministic", () => {
  assert.equal(normalizeOpenLineageProjection({ eventType: "BROKEN" }), undefined);

  const report = exportOpenLineageRegistryDocument({
    runClasses: [
      {
        key: "release_rollout",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json",
        sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
        producerPaths: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.mjs"],
      },
    ],
    artifactClasses: [
      {
        key: "release_report_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.mjs"],
      },
    ],
    diagnostics: [],
  });

  assert.equal(report.schema_version, "openlineage_registry/v1");
  assert.equal(report.summary.supported_run_classes, 1);
  assert.equal(report.summary.supported_artifact_classes, 1);
  assert.match(stringifyOpenLineageRegistryDocument(report), /"schema_version": "openlineage_registry\/v1"/);
});

test("publication-intent-only artifact classes are excluded from supported OpenLineage artifact coverage", () => {
  const report = exportOpenLineageRegistryDocument({
    runClasses: [],
    artifactClasses: [
      {
        key: "workflow_ir_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "release_report_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.mjs"],
      },
    ],
    diagnostics: [],
  });

  assert.equal(report.summary.supported_artifact_classes, 1);
  assert.deepEqual(report.artifact_classes.map((entry) => entry.key), ["release_report_bundle"]);
});
