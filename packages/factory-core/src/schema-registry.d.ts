import type { $ZodError, $ZodIssue, ZodType } from "zod/v4/core";

export const z: typeof import("zod").z;

export interface BoundarySchemaDefinition<TSchema extends ZodType = ZodType> {
  id: string;
  version: string;
  title: string;
  description?: string;
  schema: TSchema;
  outputPath: string;
  sourcePath: string;
  documentVersionField?: string;
}

export interface SchemaIssueRecord {
  path: string;
  message: string;
}

export function formatSchemaPath(path?: PropertyKey[]): string;

export function createIssueList(
  error: $ZodError,
  mapIssue?: (issue: $ZodIssue, path: string) => SchemaIssueRecord,
): SchemaIssueRecord[];

export function defineBoundarySchema<TSchema extends ZodType>(
  definition: BoundarySchemaDefinition<TSchema>,
): Readonly<BoundarySchemaDefinition<TSchema>>;

export function sortJson(value: unknown): unknown;

export function exportBoundaryJsonSchema(
  definition: BoundarySchemaDefinition,
): Record<string, unknown>;

export function stringifySchemaDocument(document: unknown): string;
