import assert from "node:assert/strict";
import test from "node:test";

import { defineArtifactTrustPolicy } from "../packages/factory-core/src/artifact-trust-registry.ts";
import { analyzeArtifactTrustContract } from "./lib/artifact-trust-contract.ts";

function sampleTrustClass() {
  return {
    key: "release_report_bundle",
    version: "release_report_bundle/v1",
    sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    trustPolicy: defineArtifactTrustPolicy({
      rationale: "Release reports are governed signed artifacts.",
    }),
    governedPublisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
  };
}

test("artifact trust contract fails when governed publishers bypass the shared trust helper", () => {
  const analysis = analyzeArtifactTrustContract({
    artifactClasses: [sampleTrustClass()],
    readFile(path) {
      if (path === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return 'import { buildOciArtifactPublicationPlan } from "@hatch/factory-core/oci-artifact-registry";';
      }
      if (path === "packages/factory-ops/src/lib/host-runtime-release-schema.ts") return "artifactTrustBundleSchema";
      if (path === "packages/factory-ops/src/commands/host-runtime-release-manifest.ts") return "buildArtifactTrustBundle";
      if (path === "packages/factory-ops/src/lib/runtime-signature.ts") return "parsed?.trust?.signature";
      return "";
    },
  });

  assert.ok(analysis.diagnostics.some((entry) => entry.includes("artifact_trust_missing_publisher_helper")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("artifact_trust_missing_publisher_execution")));
});

test("artifact trust contract fails when release manifest boundary is not using canonical trust schema", () => {
  const analysis = analyzeArtifactTrustContract({
    artifactClasses: [sampleTrustClass()],
    readFile(path) {
      if (path === "packages/factory-ops/src/commands/release-emit-narrative-document.ts") {
        return 'import "@hatch/factory-core/artifact-trust-registry"; const applyOciArtifactTrustFn = true;';
      }
      return "";
    },
  });

  assert.ok(analysis.diagnostics.some((entry) => entry.includes("artifact_trust_release_manifest_missing_trust_schema")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("artifact_trust_release_manifest_missing_trust_helper")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("artifact_trust_release_verification_missing_canonical_signature_read")));
});
