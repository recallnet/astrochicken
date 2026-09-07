import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCloudEventsContract } from "./lib/cloudevents-contract.ts";

function sampleSurface() {
  return {
    id: "https://recallnet.dev/contracts/cloudevents/sample.v1.json",
    version: "sample_cloudevents/v1",
    title: "Sample CloudEvents",
    sourcePath: "packages/sample/src/sample-cloudevents.mjs",
    outputPath: "docs/contracts/sample.asyncapi.v1.json",
    producers: ["packages/sample/src/producer.mjs"],
    consumers: ["packages/sample/src/consumer.mjs"],
    governedPaths: ["packages/sample/src/producer.mjs", "packages/sample/src/consumer.mjs"],
    payloadSchemaVersion: "sample_event/v1",
    payloadSchemaId: "https://recallnet.dev/contracts/sample-event.v1.schema.json",
  };
}

test("cloudevents contract fails when producers or consumers bypass the canonical contract module", () => {
  const analysis = analyzeCloudEventsContract({
    surfaces: [sampleSurface()],
    readFile() {
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("cloudevents_producer_missing_contract_import")));
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("cloudevents_consumer_missing_contract_import")));
});

test("cloudevents contract fails on discovered but unregistered source modules", () => {
  const analysis = analyzeCloudEventsContract({
    surfaces: [sampleSurface()],
    discoveredSourcePaths: [
      "packages/sample/src/sample-cloudevents.mjs",
      "packages/sample/src/hidden-cloudevents.mjs",
    ],
    readFile(path) {
      if (path.includes("producer") || path.includes("consumer")) {
        return 'import "./sample-cloudevents.mjs";';
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("cloudevents_unregistered_source")));
});

test("cloudevents contract fails on legacy envelope patterns in governed files", () => {
  const analysis = analyzeCloudEventsContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "packages/sample/src/producer.mjs") {
        return 'import "./sample-cloudevents.mjs";\nconst prefix = "RELEASE_ROLLOUT_EVENT ";';
      }
      if (path === "packages/sample/src/consumer.mjs") {
        return 'import "./sample-cloudevents.mjs";';
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("cloudevents_legacy_envelope_pattern")));
});

test("cloudevents contract passes with registered sources and clean governed files", () => {
  const firstPass = analyzeCloudEventsContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path.includes("producer") || path.includes("consumer")) {
        return 'import "./sample-cloudevents.mjs";';
      }
      return "";
    },
    discoveredSourcePaths: ["packages/sample/src/sample-cloudevents.mjs"],
  });

  const secondPass = analyzeCloudEventsContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path.includes("producer") || path.includes("consumer")) {
        return 'import "./sample-cloudevents.mjs";';
      }
      return "";
    },
    discoveredSourcePaths: ["packages/sample/src/sample-cloudevents.mjs"],
    expectedRegistryJson: firstPass.renderedJson,
    expectedRegistryMarkdown: firstPass.renderedMarkdown,
  });

  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.report.summary.registered_surfaces, 1);
});
