import { z } from "@hatch/factory-core/schema-registry";
import { defineSyncHttpSurface } from "@hatch/factory-core/openapi-registry";

import { VALIDATION_MODES } from "../pipeline/validate.js";

const validationModeSchema = z.enum(VALIDATION_MODES);
const pipelineContextSchema = z.record(z.string(), z.string());

const createPipelineRequestSchema = z.strictObject({
	dot: z.string().trim().min(1),
	context: pipelineContextSchema.optional(),
	validation_mode: validationModeSchema.optional(),
});

const pipelineCreatedResponseSchema = z.strictObject({
	id: z.string().uuid(),
	status: z.literal("created"),
});

const pipelineErrorResponseSchema = z.strictObject({
	error: z.string().min(1),
});

const pipelineRunResponseSchema = z.strictObject({
	id: z.string().uuid(),
	name: z.string(),
	status: z.enum(["created", "running", "completed", "failed"]),
	graph: z.record(z.string(), z.unknown()).optional(),
	events: z.array(z.record(z.string(), z.unknown())),
});

const healthResponseSchema = z.strictObject({
	status: z.literal("ok"),
});

export const HATCH_SERVER_OPENAPI_SURFACE = defineSyncHttpSurface({
	id: "https://recallnet.dev/contracts/hatch-server-openapi.v1.json",
	version: "hatch_server_openapi/v1",
	title: "Hatch Server API",
	description: "Governed synchronous HTTP capability surface for the Hatch runtime server.",
	sourcePath: "apps/hatch/src/server/openapi-contract.ts",
	outputPath: "docs/contracts/hatch-server-openapi.v1.json",
	consumers: ["apps/hatch/src/server/server.ts"],
	operations: [
		{
			method: "GET",
			path: "/health",
			operationId: "getHealth",
			summary: "Health check",
			description: "Returns the current process health status.",
			responses: {
				200: {
					description: "Healthy process response.",
					schema: healthResponseSchema,
				},
			},
		},
		{
			method: "POST",
			path: "/pipelines",
			operationId: "createPipeline",
			summary: "Create a pipeline run",
			description: "Parses and validates a DOT graph, then starts execution in the background.",
			requestBody: {
				required: true,
				description: "Pipeline submission payload.",
				schema: createPipelineRequestSchema,
			},
			responses: {
				201: {
					description: "Pipeline run created successfully.",
					schema: pipelineCreatedResponseSchema,
				},
				400: {
					description: "Invalid JSON, parse, or validation failure.",
					schema: pipelineErrorResponseSchema,
				},
			},
		},
		{
			method: "GET",
			path: "/pipelines/{id}",
			operationId: "getPipeline",
			summary: "Get pipeline run state",
			description: "Returns the current execution state and event trail for a pipeline run.",
			parameters: [
				{
					name: "id",
					in: "path",
					required: true,
					description: "Pipeline run identifier.",
					schema: z.string().uuid(),
				},
			],
			responses: {
				200: {
					description: "Pipeline run found.",
					schema: pipelineRunResponseSchema,
				},
				404: {
					description: "Pipeline run not found.",
					schema: pipelineErrorResponseSchema,
				},
			},
		},
	],
});
