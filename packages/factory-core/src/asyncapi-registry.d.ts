import type { ZodType } from "zod/v4/core";

export const z: typeof import("zod").z;

export interface AsyncEventMessageDefinition<TSchema extends ZodType = ZodType> {
  id: string;
  title: string;
  summary?: string;
  contentType?: string;
  schema: TSchema;
}

export interface AsyncEventChannelDefinition<TSchema extends ZodType = ZodType> {
  name: string;
  address?: string;
  description?: string;
  operation?: "publish" | "subscribe";
  messages: AsyncEventMessageDefinition<TSchema>[];
}

export interface AsyncEventSurfaceDefinition<TSchema extends ZodType = ZodType> {
  id: string;
  version: string;
  title: string;
  description?: string;
  sourcePath: string;
  outputPath: string;
  producers?: string[];
  consumers?: string[];
  channels: AsyncEventChannelDefinition<TSchema>[];
}

export function defineAsyncEventSurface(
  definition: AsyncEventSurfaceDefinition,
): Readonly<AsyncEventSurfaceDefinition>;

export function exportAsyncApiDocument(surface: AsyncEventSurfaceDefinition): Record<string, unknown>;
export function stringifyAsyncApiDocument(surface: AsyncEventSurfaceDefinition): string;
