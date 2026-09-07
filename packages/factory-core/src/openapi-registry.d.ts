import type { ZodType } from "zod/v4/core";

export const z: typeof import("zod").z;

export interface SyncHttpParameterDefinition<TSchema extends ZodType = ZodType> {
  name: string;
  in: "path" | "query" | "header";
  description?: string;
  required?: boolean;
  schema: TSchema;
}

export interface SyncHttpResponseDefinition<TSchema extends ZodType = ZodType> {
  description: string;
  contentType?: string;
  schema?: TSchema;
}

export interface SyncHttpRequestBodyDefinition<TSchema extends ZodType = ZodType> {
  description?: string;
  required?: boolean;
  contentType?: string;
  schema: TSchema;
}

export interface SyncHttpOperationDefinition<
  TRequestSchema extends ZodType = ZodType,
  TResponseSchema extends ZodType = ZodType,
> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  parameters?: SyncHttpParameterDefinition[];
  requestBody?: SyncHttpRequestBodyDefinition<TRequestSchema>;
  responses: Record<string | number, SyncHttpResponseDefinition<TResponseSchema>>;
}

export interface SyncHttpSurfaceDefinition {
  id: string;
  version: string;
  title: string;
  description?: string;
  sourcePath: string;
  outputPath: string;
  consumers?: string[];
  operations: SyncHttpOperationDefinition[];
}

export function defineSyncHttpSurface(
  definition: SyncHttpSurfaceDefinition,
): Readonly<SyncHttpSurfaceDefinition>;

export function exportSyncOpenApiDocument(surface: SyncHttpSurfaceDefinition): Record<string, unknown>;
export function stringifyOpenApiDocument(surface: SyncHttpSurfaceDefinition): string;
