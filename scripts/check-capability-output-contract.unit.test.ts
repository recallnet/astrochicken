import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeCapabilityOutputContract } from "./lib/capability-output-contract.ts";

test("capability output registry passes for governed capability packages", async () => {
  const result = await analyzeCapabilityOutputContract();
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.diagnostics, []);
  assert.ok(result.report.summary.registered_capabilities > 0);
  assert.ok(result.report.summary.documented_telemetry_expectations > 0);
});

function writeRepoFile(repoRoot, relativePath, content) {
  const targetPath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
}

function createCapabilityOutputFixture({ contractBody, producerBody }) {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "capability-output-contract-"));
  writeRepoFile(
    repoRoot,
    "packages/factory-core/src/capability-contract-registry.ts",
    [
      "export function defineCapabilitySurface(definition) {",
      "  return definition;",
      "}",
      "",
    ].join("\n"),
  );
  writeRepoFile(
    repoRoot,
    "docs/contracts/cloudevents-registry.json",
    JSON.stringify({ surfaces: [] }, null, 2),
  );
  writeRepoFile(
    repoRoot,
    "docs/contracts/oci-artifact-taxonomy.json",
    JSON.stringify({ classes: [] }, null, 2),
  );
  writeRepoFile(
    repoRoot,
    "packages/factory-telemetry/src/otel-contract.json",
    JSON.stringify({ naming: { event_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$" } }, null, 2),
  );
  writeRepoFile(repoRoot, "packages/capability-demo/package.json", JSON.stringify({ name: "@hatch/capability-demo" }, null, 2));
  writeRepoFile(repoRoot, "packages/capability-demo/capability-contract.mjs", contractBody);
  writeRepoFile(repoRoot, "packages/capability-demo/src/in-process-action-owners.mjs", producerBody);
  writeRepoFile(repoRoot, "packages/capability-demo/graphs/demo.dot", "digraph demo { start -> done }\n");
  writeRepoFile(
    repoRoot,
    "packages/factory-ops/src/commands/reviewer-context-contract.ts",
    [
      'export const REVIEWER_CONTEXT_SCHEMA_VERSION = "reviewer_context/v1";',
      "export function buildAndPersistReviewerContextContract() {",
      "  return REVIEWER_CONTEXT_SCHEMA_VERSION;",
      "}",
      "",
    ].join("\n"),
  );
  return repoRoot;
}

function defaultTrackedFiles() {
  return [
    "packages/capability-demo/package.json",
    "packages/capability-demo/capability-contract.mjs",
    "packages/capability-demo/src/in-process-action-owners.mjs",
    "packages/capability-demo/graphs/demo.dot",
    "packages/factory-core/src/capability-contract-registry.ts",
    "packages/factory-ops/src/commands/reviewer-context-contract.ts",
    "docs/contracts/cloudevents-registry.json",
    "docs/contracts/oci-artifact-taxonomy.json",
    "packages/factory-telemetry/src/otel-contract.json",
  ];
}

test("capability output contract fails closed when a producer file imports a governed output owner without producerPaths registration", async () => {
  const repoRoot = createCapabilityOutputFixture({
    contractBody: [
      'import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";',
      "",
      "export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({",
      '  packageName: "@hatch/capability-demo",',
      '  capabilityId: "demo",',
      '  version: "0.1.0",',
      '  sourcePath: "packages/capability-demo/capability-contract.mjs",',
      '  outputPath: "packages/capability-demo/capability-contract.v1.json",',
      "  entrypoints: [],",
      "  outputSurfaces: {",
      "    artifacts: [",
      "      {",
      '        id: "reviewer_context",',
      '        standard: "platform_contract_artifact",',
      '        ref: "reviewer_context/v1",',
      '        producerPaths: ["graphs/demo.dot"],',
      "      },",
      "    ],",
      "  },",
      "  sourceFileOutputCoverage: [",
      "    { path: \"src/in-process-action-owners.mjs\", refs: [] },",
      "  ],",
      "});",
      "",
    ].join("\n"),
    producerBody: [
      'import { buildAndPersistReviewerContextContract } from "../../../packages/factory-ops/src/commands/reviewer-context-contract.ts";',
      "",
      "export { buildAndPersistReviewerContextContract };",
      "",
    ].join("\n"),
  });

  const result = await analyzeCapabilityOutputContract({
    repoRoot,
    trackedFiles: defaultTrackedFiles(),
  });

  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /capability_output_unregistered_producer_file/);
});

test("capability output contract fails closed when a producer file references a governed output ref directly without producerPaths registration", async () => {
  const repoRoot = createCapabilityOutputFixture({
    contractBody: [
      'import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";',
      "",
      "export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({",
      '  packageName: "@hatch/capability-demo",',
      '  capabilityId: "demo",',
      '  version: "0.1.0",',
      '  sourcePath: "packages/capability-demo/capability-contract.mjs",',
      '  outputPath: "packages/capability-demo/capability-contract.v1.json",',
      "  entrypoints: [],",
      "  outputSurfaces: {",
      "    telemetry: [",
      "      {",
      '        id: "review_verdict",',
      '        standard: "otel_event",',
      '        ref: "hatch.review_verdict",',
      '        producerPaths: ["graphs/demo.dot"],',
      "      },",
      "    ],",
      "  },",
      "  sourceFileOutputCoverage: [",
      "    { path: \"src/in-process-action-owners.mjs\", refs: [] },",
      "  ],",
      "});",
      "",
    ].join("\n"),
    producerBody: [
      "export function emitDirectVerdict(payload) {",
      '  return { event_name: "hatch.review_verdict", payload };',
      "}",
      "",
    ].join("\n"),
  });

  const result = await analyzeCapabilityOutputContract({
    repoRoot,
    trackedFiles: defaultTrackedFiles(),
  });

  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /capability_output_unregistered_producer_file/);
});

test("capability output contract fails closed when a local file writer is not registered in producerPaths", async () => {
  const repoRoot = createCapabilityOutputFixture({
    contractBody: [
      'import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";',
      "",
      "export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({",
      '  packageName: "@hatch/capability-demo",',
      '  capabilityId: "demo",',
      '  version: "0.1.0",',
      '  sourcePath: "packages/capability-demo/capability-contract.mjs",',
      '  outputPath: "packages/capability-demo/capability-contract.v1.json",',
      "  entrypoints: [],",
      "  outputSurfaces: {",
      "    artifacts: [",
      "      {",
      '        id: "local_artifact",',
      '        standard: "platform_contract_artifact",',
      '        ref: "local_artifact/v1",',
      '        producerPaths: ["graphs/demo.dot"],',
      "      },",
      "    ],",
      "  },",
      "  sourceFileOutputCoverage: [",
      "    { path: \"src/in-process-action-owners.mjs\", refs: [] },",
      "  ],",
      "});",
      "",
    ].join("\n"),
    producerBody: [
      'import { writeFile } from "node:fs/promises";',
      "",
      "export async function persistArtifact(targetPath, payload) {",
      '  await writeFile(targetPath, payload, "utf8");',
      "}",
      "",
    ].join("\n"),
  });

  const result = await analyzeCapabilityOutputContract({
    repoRoot,
    trackedFiles: defaultTrackedFiles(),
  });

  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /capability_output_unregistered_local_file_writer/);
});

test("capability output contract fails closed when a new capability source file is not classified in sourceFileOutputCoverage", async () => {
  const repoRoot = createCapabilityOutputFixture({
    contractBody: [
      'import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";',
      "",
      "export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({",
      '  packageName: "@hatch/capability-demo",',
      '  capabilityId: "demo",',
      '  version: "0.1.0",',
      '  sourcePath: "packages/capability-demo/capability-contract.mjs",',
      '  outputPath: "packages/capability-demo/capability-contract.v1.json",',
      "  entrypoints: [],",
      "  outputSurfaces: {",
      "    artifacts: [",
      "      {",
      '        id: "reviewer_context",',
      '        standard: "platform_contract_artifact",',
      '        ref: "reviewer_context/v1",',
      '        producerPaths: ["src/in-process-action-owners.mjs"],',
      "      },",
      "    ],",
      "  },",
      "  sourceFileOutputCoverage: [",
      "    { path: \"src/in-process-action-owners.mjs\", refs: [\"reviewer_context/v1\"] },",
      "  ],",
      "});",
      "",
    ].join("\n"),
    producerBody: [
      'import { buildAndPersistReviewerContextContract } from "../../../packages/factory-ops/src/commands/reviewer-context-contract.ts";',
      "",
      "export { buildAndPersistReviewerContextContract };",
      "",
    ].join("\n"),
  });
  writeRepoFile(
    repoRoot,
    "packages/capability-demo/src/new-governed-producer.mjs",
    [
      "export function emitUndeclared() {",
      '  return "reviewer_context/v1";',
      "}",
      "",
    ].join("\n"),
  );

  const result = await analyzeCapabilityOutputContract({
    repoRoot,
    trackedFiles: [
      ...defaultTrackedFiles(),
      "packages/capability-demo/src/new-governed-producer.mjs",
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /capability_output_unclassified_source_file/);
});

test("capability output contract fails closed when sourceFileOutputCoverage claims a governed ref without a matching producerPath", async () => {
  const repoRoot = createCapabilityOutputFixture({
    contractBody: [
      'import { defineCapabilitySurface } from "../factory-core/src/capability-contract-registry.ts";',
      "",
      "export const CAPABILITY_CONTRACT_SURFACE = defineCapabilitySurface({",
      '  packageName: "@hatch/capability-demo",',
      '  capabilityId: "demo",',
      '  version: "0.1.0",',
      '  sourcePath: "packages/capability-demo/capability-contract.mjs",',
      '  outputPath: "packages/capability-demo/capability-contract.v1.json",',
      "  entrypoints: [],",
      "  outputSurfaces: {",
      "    artifacts: [",
      "      {",
      '        id: "reviewer_context",',
      '        standard: "platform_contract_artifact",',
      '        ref: "reviewer_context/v1",',
      '        producerPaths: ["graphs/demo.dot"],',
      "      },",
      "    ],",
      "  },",
      "  sourceFileOutputCoverage: [",
      "    { path: \"src/in-process-action-owners.mjs\", refs: [\"reviewer_context/v1\"] },",
      "  ],",
      "});",
      "",
    ].join("\n"),
    producerBody: [
      "export function noop() {",
      "  return true;",
      "}",
      "",
    ].join("\n"),
  });

  const result = await analyzeCapabilityOutputContract({
    repoRoot,
    trackedFiles: defaultTrackedFiles(),
  });

  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /capability_output_source_coverage_ref_missing_producer_path/);
});
