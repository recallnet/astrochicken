import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSyncOpenApiContract } from "./lib/sync-openapi-contract.ts";
import { defineSyncHttpSurface, z } from "../packages/factory-core/src/openapi-registry.ts";

function sampleSurface() {
  return defineSyncHttpSurface({
    id: "https://recallnet.dev/contracts/sample-openapi.json",
    version: "sample_openapi/v1",
    title: "Sample OpenAPI",
    description: "Sample synchronous HTTP surface.",
    sourcePath: "apps/sample/src/server/openapi-contract.ts",
    outputPath: "docs/contracts/sample-openapi.v1.json",
    consumers: ["apps/sample/src/server/server.ts"],
    operations: [
      {
        method: "GET",
        path: "/health",
        operationId: "getHealth",
        summary: "Health check",
        responses: {
          200: {
            description: "Healthy",
            schema: z.object({ status: z.literal("ok") }),
          },
        },
      },
    ],
  });
}

test("sync OpenAPI contract fails on generated spec drift", () => {
  const analysis = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "apps/sample/src/server/server.ts") {
        return 'import { SAMPLE_OPENAPI_SURFACE } from "./openapi-contract.js";';
      }
      return "{\n}\n";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("sync_openapi_output_drift")));
});

test("sync OpenAPI contract fails when a consumer bypasses the canonical route contract", () => {
  const analysis = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "docs/contracts/sample-openapi.v1.json") {
        return "";
      }
      if (path === "apps/sample/src/server/server.ts") {
        return "export function createServer() {}";
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("sync_openapi_consumer_missing_contract_import")));
});

test("sync OpenAPI contract fails on discovered but unregistered source modules", () => {
  const analysis = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    discoveredSourcePaths: [
      "apps/sample/src/server/openapi-contract.ts",
      "apps/sample/src/server/hidden-openapi-contract.ts",
    ],
    readFile(path) {
      if (path === "apps/sample/src/server/server.ts") {
        return 'import { SAMPLE_OPENAPI_SURFACE } from "./openapi-contract.js";';
      }
      return "";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("sync_openapi_unregistered_source")));
});

test("sync OpenAPI contract passes matching generated output and registry reports", () => {
  const outputPass = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "apps/sample/src/server/server.ts") {
        return 'import { SAMPLE_OPENAPI_SURFACE } from "./openapi-contract.js";';
      }
      return "";
    },
  });

  const expectedOutput = outputPass.generatedOutputs.get("docs/contracts/sample-openapi.v1.json");
  const reportPass = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    readFile(path) {
      if (path === "docs/contracts/sample-openapi.v1.json") {
        return expectedOutput;
      }
      if (path === "apps/sample/src/server/server.ts") {
        return 'import { SAMPLE_OPENAPI_SURFACE } from "./openapi-contract.js";';
      }
      return "";
    },
  });

  const secondPass = analyzeSyncOpenApiContract({
    surfaces: [sampleSurface()],
    expectedRegistryJson: reportPass.renderedJson,
    expectedRegistryMarkdown: reportPass.renderedMarkdown,
    readFile(path) {
      if (path === "docs/contracts/sample-openapi.v1.json") {
        return expectedOutput;
      }
      if (path === "apps/sample/src/server/server.ts") {
        return 'import { SAMPLE_OPENAPI_SURFACE } from "./openapi-contract.js";';
      }
      return "";
    },
  });

  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.report.summary.registered_surfaces, 1);
});
