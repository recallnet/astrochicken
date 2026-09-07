import assert from "node:assert/strict";
import test from "node:test";

import { analyzeAsyncApiContract } from "./lib/asyncapi-contract.ts";
import { defineAsyncEventSurface, z } from "../packages/factory-core/src/asyncapi-registry.ts";

function sampleSurface() {
  return defineAsyncEventSurface({
    id: "https://recallnet.dev/contracts/sample-events.asyncapi.v1.json",
    version: "sample_events_asyncapi/v1",
    title: "Sample Event Feed",
    description: "Sample async event feed.",
    sourcePath: "packages/sample/src/sample-asyncapi-contract.mjs",
    outputPath: "docs/contracts/sample-events.asyncapi.v1.json",
    producers: ["packages/sample/src/producer.mjs"],
    consumers: ["packages/sample/src/consumer.mjs"],
    channels: [
      {
        name: "sample.events",
        operation: "subscribe",
        messages: [
          {
            id: "SampleEvent",
            title: "Sample Event",
            schema: z.object({ event: z.literal("sample") }),
          },
        ],
      },
    ],
  });
}

test("asyncapi contract fails on generated output drift", () => {
  const analysis = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "packages/sample/src/producer.mjs" || path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-asyncapi-contract.mjs";';
      }
      return "{\n}\n";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("asyncapi_output_drift")));
});

test("asyncapi contract fails when producers or consumers bypass the canonical contract module", () => {
  const analysis = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    readFile() {
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("asyncapi_producer_missing_contract_import")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("asyncapi_consumer_missing_contract_import")));
});

test("asyncapi contract fails on discovered but unregistered source modules", () => {
  const analysis = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    discoveredSourcePaths: [
      "packages/sample/src/sample-asyncapi-contract.mjs",
      "packages/sample/src/hidden-asyncapi-contract.mjs",
    ],
    readFile(path) {
      if (path === "packages/sample/src/producer.mjs" || path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-asyncapi-contract.mjs";';
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("asyncapi_unregistered_source")));
});

test("asyncapi contract passes matching generated output and registry reports", () => {
  const outputPass = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "packages/sample/src/producer.mjs" || path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-asyncapi-contract.mjs";';
      }
      return "";
    },
  });

  const expectedOutput = outputPass.generatedOutputs.get("docs/contracts/sample-events.asyncapi.v1.json");
  const reportPass = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "docs/contracts/sample-events.asyncapi.v1.json") {
        return expectedOutput;
      }
      if (path === "packages/sample/src/producer.mjs" || path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-asyncapi-contract.mjs";';
      }
      return "";
    },
  });

  const secondPass = analyzeAsyncApiContract({
    surfaces: [sampleSurface()],
    expectedRegistryJson: reportPass.renderedJson,
    expectedRegistryMarkdown: reportPass.renderedMarkdown,
    readFile(path) {
      if (path === "docs/contracts/sample-events.asyncapi.v1.json") {
        return expectedOutput;
      }
      if (path === "packages/sample/src/producer.mjs" || path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-asyncapi-contract.mjs";';
      }
      return "";
    },
  });

  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.report.summary.registered_surfaces, 1);
});
