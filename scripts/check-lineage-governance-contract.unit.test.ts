import test from "node:test";
import assert from "node:assert/strict";

import { analyzeLineageGovernanceContract } from "./lib/lineage-governance-contract.ts";

function runClassFixtures(keys) {
  const classes = {
    hatch_run_lifecycle: {
      key: "hatch_run_lifecycle",
      cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json",
      sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
      producerPaths: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
    },
    release_rollout: {
      key: "release_rollout",
      cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json",
      sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
      producerPaths: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts"],
    },
  };
  return keys.map((key) => classes[key]);
}

function artifactClassFixtures(keys) {
  return keys.map((key) => ({
    key,
    sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    publisherPaths: key === "release_report_bundle"
      ? ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"]
      : [],
  }));
}

test("lineage governance contract fails when required run or artifact classes are missing from the registry", async () => {
  const result = await analyzeLineageGovernanceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "apps/hatch/src/pipeline/run-lifecycle.ts",
      "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
      "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    ],
    readFile() {
      return "";
    },
    loadRunClasses: async () => runClassFixtures(["hatch_run_lifecycle"]),
    loadArtifactClasses: async () => artifactClassFixtures(["release_report_bundle"]),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /lineage_missing_run_class/);
});

test("lineage governance registry counts only artifact classes with actual publisher ownership as supported", async () => {
  const result = await analyzeLineageGovernanceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "apps/hatch/src/pipeline/run-lifecycle.ts",
      "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
      "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
    ],
    readFile() {
      return "";
    },
    loadRunClasses: async () => runClassFixtures(["hatch_run_lifecycle", "release_rollout"]),
    loadArtifactClasses: async () => artifactClassFixtures(["workflow_ir_bundle", "run_snapshot_bundle", "release_report_bundle"]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.summary.supported_artifact_classes, 1);
  assert.ok(result.report.artifact_classes.every((entry) => entry.publisherPaths.length > 0));
  assert.match(result.diagnostics.join("\n"), /lineage_registry_missing/);
});

test("lineage governance contract fails when hot-path files depend on governance systems or duplicate lineage normalization", async () => {
  const result = await analyzeLineageGovernanceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "apps/hatch/src/pipeline/run-lifecycle.ts",
      "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
      "packages/factory-ops/src/lib/daemon.ts",
    ],
    readFile(filePath) {
      if (filePath.endsWith("daemon.ts")) {
        return "const client = new MarquezClient();";
      }
      if (filePath.endsWith("run-lifecycle.ts")) {
        return "function buildOpenLineageProjection() {}";
      }
      return "";
    },
    loadRunClasses: async () => runClassFixtures(["hatch_run_lifecycle", "release_rollout"]),
    loadArtifactClasses: async () => artifactClassFixtures([
      "workflow_ir_bundle",
      "run_snapshot_bundle",
      "judge_evidence_bundle",
      "release_report_bundle",
      "release_bundle",
      "telemetry_summary_bundle",
      "contract_spec_bundle",
    ]),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /lineage_hot_path_governance_dependency/);
  assert.match(result.diagnostics.join("\n"), /lineage_duplicate_projection_owner/);
});
