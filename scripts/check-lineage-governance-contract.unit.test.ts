import test from "node:test";
import assert from "node:assert/strict";

import { analyzeLineageGovernanceContract } from "./lib/lineage-governance-contract.ts";

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
    loadRunClasses: async () => ([
      {
        key: "hatch_run_lifecycle",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json",
        sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
        producerPaths: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
      },
    ]),
    loadArtifactClasses: async () => ([
      {
        key: "release_report_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
      },
    ]),
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
    loadRunClasses: async () => ([
      {
        key: "hatch_run_lifecycle",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json",
        sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
        producerPaths: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
      },
      {
        key: "release_rollout",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json",
        sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
        producerPaths: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts"],
      },
    ]),
    loadArtifactClasses: async () => ([
      {
        key: "workflow_ir_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "run_snapshot_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "release_report_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
      },
    ]),
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
      if (filePath.endsWith("daemon.mjs")) {
        return "const client = new MarquezClient();";
      }
      if (filePath.endsWith("run-lifecycle.ts")) {
        return "function buildOpenLineageProjection() {}";
      }
      return "";
    },
    loadRunClasses: async () => ([
      {
        key: "hatch_run_lifecycle",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json",
        sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
        producerPaths: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
      },
      {
        key: "release_rollout",
        cloudEventSurfaceId: "https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json",
        sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
        producerPaths: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts"],
      },
    ]),
    loadArtifactClasses: async () => ([
      {
        key: "workflow_ir_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "run_snapshot_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "judge_evidence_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "release_report_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: ["packages/factory-ops/src/commands/release-emit-narrative-document.ts"],
      },
      {
        key: "release_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "telemetry_summary_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
      {
        key: "contract_spec_bundle",
        sourcePath: "packages/factory-ops/src/lib/oci-artifact-taxonomy.ts",
        publisherPaths: [],
      },
    ]),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /lineage_hot_path_governance_dependency/);
  assert.match(result.diagnostics.join("\n"), /lineage_duplicate_projection_owner/);
});
