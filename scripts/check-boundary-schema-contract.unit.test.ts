import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBoundarySchemaContract } from "./lib/boundary-schema-contract.ts";
import { defineBoundarySchema, z } from "../packages/factory-core/src/schema-registry.ts";

function sampleDefinition({
  outputPath = "docs/contracts/sample.json",
} = {}) {
  return defineBoundarySchema({
    id: `https://example.invalid/${outputPath}`,
    version: "sample/v1",
    title: "Sample",
    description: "Sample boundary schema",
    schema: z.strictObject({
      schema_version: z.literal("sample/v1"),
      name: z.string().min(1),
    }),
    sourcePath: "packages/sample/src/sample-schema.mjs",
    outputPath,
  });
}

test("boundary schema contract fails on unregistered governed output", () => {
  const analysis = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    governedOutputPaths: ["docs/contracts/sample.json", "docs/contracts/missing.json"],
    readFile(path) {
      if (path === "docs/contracts/sample.json") {
        return "{\n}\n";
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("boundary_schema_unregistered_output")));
});

test("boundary schema contract fails on generated output drift", () => {
  const analysis = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    readFile() {
      return "{\n}\n";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("boundary_schema_output_drift")));
});

test("boundary schema contract fails on discovered but unregistered schema sources", () => {
  const analysis = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    discoveredSourcePaths: [
      "packages/sample/src/sample-schema.mjs",
      "packages/sample/src/unregistered-schema.mjs",
    ],
    readFile() {
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("boundary_schema_unregistered_source")));
});

test("boundary schema contract passes matching generated outputs and reports", () => {
  const outputOnlyPass = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    readFile(path) {
      if (path === "docs/contracts/sample.json") {
        return "";
      }
      return "";
    },
  });

  const expectedOutput = outputOnlyPass.generatedOutputs.get("docs/contracts/sample.json");
  const reportPass = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    readFile(path) {
      if (path === "docs/contracts/sample.json") {
        return expectedOutput;
      }
      return "";
    },
  });

  const secondPass = analyzeBoundarySchemaContract({
    definitions: [sampleDefinition()],
    expectedRegistryJson: reportPass.renderedJson,
    expectedRegistryMarkdown: reportPass.renderedMarkdown,
    readFile(path) {
      if (path === "docs/contracts/sample.json") {
        return expectedOutput;
      }
      return "";
    },
  });

  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.report.summary.registered_boundaries, 1);
});
