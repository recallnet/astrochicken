import { toJSONSchema } from "zod";

import { sortJson, stringifySchemaDocument, z } from "./schema-registry.ts";

function normalizeSchema(schema: unknown): unknown {
  if (!schema) {
    return undefined;
  }

  const document: Record<string, unknown> = { ...toJSONSchema(schema as import("zod").ZodType) };
  delete document.$schema;
  return sortJson(document);
}

function normalizeParameters(parameters: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return parameters.map((parameter) => ({
    name: String(parameter.name || "").trim(),
    in: String(parameter.in || "").trim(),
    description: String(parameter.description || "").trim(),
    required: Boolean(parameter.required),
    schema: parameter.schema,
  }));
}

export function defineSyncHttpSurface(definition: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: (definition as Record<string, unknown>).id,
    version: (definition as Record<string, unknown>).version,
    title: (definition as Record<string, unknown>).title,
    description: (definition as Record<string, unknown>).description || "",
    sourcePath: (definition as Record<string, unknown>).sourcePath,
    outputPath: (definition as Record<string, unknown>).outputPath,
    consumers: Object.freeze([...((definition as Record<string, unknown>).consumers as unknown[] || [])]),
    operations: Object.freeze(
      (((definition as Record<string, unknown>).operations as Record<string, unknown>[]) || []).map((operation) => Object.freeze({
        ...operation,
        method: String(operation.method || "").trim().toUpperCase(),
        path: String(operation.path || "").trim(),
        operationId: String(operation.operationId || "").trim(),
        summary: String(operation.summary || "").trim(),
        description: String(operation.description || "").trim(),
        parameters: Object.freeze(normalizeParameters(operation.parameters as Record<string, unknown>[])),
        requestBody: operation.requestBody ? Object.freeze({
          required: (operation.requestBody as Record<string, unknown>).required !== false,
          description: String((operation.requestBody as Record<string, unknown>).description || "").trim(),
          contentType: String((operation.requestBody as Record<string, unknown>).contentType || "application/json").trim(),
          schema: (operation.requestBody as Record<string, unknown>).schema,
        }) : undefined,
        responses: Object.freeze(
          Object.fromEntries(
            Object.entries(operation.responses as Record<string, Record<string, unknown>> || {}).map(([statusCode, response]) => [
              String(statusCode),
              Object.freeze({
                description: String(response.description || "").trim(),
                contentType: String(response.contentType || "application/json").trim(),
                schema: response.schema,
              }),
            ]),
          ),
        ),
      })),
    ),
  });
}

export function exportSyncOpenApiDocument(surface: Record<string, unknown>): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of (surface.operations as Record<string, unknown>[]) || []) {
    const pathItem = paths[operation.path as string] || {};
    const normalizedOperation: Record<string, unknown> = {
      operationId: operation.operationId,
      summary: operation.summary,
      description: operation.description,
      responses: Object.fromEntries(
        Object.entries(operation.responses as Record<string, Record<string, unknown>> || {}).map(([statusCode, response]) => {
          const content = response.schema
            ? {
                [response.contentType as string]: {
                  schema: normalizeSchema(response.schema),
                },
              }
            : undefined;
          return [
            statusCode,
            sortJson({
              description: response.description,
              ...(content ? { content } : {}),
            }),
          ];
        }),
      ),
    };

    if (((operation.parameters as unknown[]) || []).length > 0) {
      normalizedOperation.parameters = (operation.parameters as Record<string, unknown>[]).map((parameter) => sortJson({
        name: parameter.name,
        in: parameter.in,
        description: parameter.description,
        required: parameter.in === "path" ? true : Boolean(parameter.required),
        schema: normalizeSchema(parameter.schema),
      }));
    }

    if (operation.requestBody) {
      normalizedOperation.requestBody = sortJson({
        required: (operation.requestBody as Record<string, unknown>).required !== false,
        description: (operation.requestBody as Record<string, unknown>).description,
        content: {
          [(operation.requestBody as Record<string, unknown>).contentType as string]: {
            schema: normalizeSchema((operation.requestBody as Record<string, unknown>).schema),
          },
        },
      });
    }

    pathItem[(operation.method as string).toLowerCase()] = sortJson(normalizedOperation);
    paths[operation.path as string] = pathItem;
  }

  return sortJson({
    openapi: "3.1.0",
    info: {
      title: surface.title,
      version: surface.version,
      description: surface.description,
    },
    paths,
  }) as Record<string, unknown>;
}

export function stringifyOpenApiDocument(surface: Record<string, unknown>): string {
  return stringifySchemaDocument(exportSyncOpenApiDocument(surface));
}

export { z };
