import { describe, expect, it } from "vitest";

import { exportSyncOpenApiDocument } from "@hatch/factory-core/openapi-registry";

import { HATCH_SERVER_OPENAPI_SURFACE } from "./openapi-contract.js";

describe("Hatch server OpenAPI contract", () => {
	it("generates a governed OpenAPI document for the sync HTTP surface", () => {
		const document = exportSyncOpenApiDocument(HATCH_SERVER_OPENAPI_SURFACE);

		expect(document.openapi).toBe("3.1.0");
		expect(document.info.title).toBe("Hatch Server API");
		expect(document.info.version).toBe("hatch_server_openapi/v1");
		expect(document.paths["/health"]?.get?.operationId).toBe("getHealth");
		expect(document.paths["/pipelines"]?.post?.requestBody?.required).toBe(true);
		expect(document.paths["/pipelines/{id}"]?.get?.responses?.["404"]?.description).toContain("not found");
	});
});
