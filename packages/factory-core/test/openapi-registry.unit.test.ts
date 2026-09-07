import assert from "node:assert/strict";
import test from "node:test";

import { defineSyncHttpSurface, exportSyncOpenApiDocument, z } from "../src/openapi-registry.ts";

test("exportSyncOpenApiDocument renders OpenAPI 3.1 paths from the canonical sync surface", () => {
  const surface = defineSyncHttpSurface({
    id: "https://recallnet.dev/contracts/sample-openapi.json",
    version: "sample_openapi/v1",
    title: "Sample",
    description: "Sample sync API",
    sourcePath: "apps/sample/src/server/openapi-contract.ts",
    outputPath: "docs/contracts/sample-openapi.v1.json",
    consumers: ["apps/sample/src/server/server.ts"],
    operations: [
      {
        method: "POST",
        path: "/pipelines",
        operationId: "createPipeline",
        summary: "Create a pipeline run",
        requestBody: {
          schema: z.object({ dot: z.string().min(1) }),
        },
        responses: {
          201: {
            description: "Created",
            schema: z.object({ id: z.string().uuid() }),
          },
        },
      },
    ],
  });

  const document = exportSyncOpenApiDocument(surface);

  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.version, "sample_openapi/v1");
  assert.equal(document.paths["/pipelines"].post.operationId, "createPipeline");
  assert.equal(document.paths["/pipelines"].post.requestBody.required, true);
});
