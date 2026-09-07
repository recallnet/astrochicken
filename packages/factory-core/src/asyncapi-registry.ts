import { toJSONSchema } from "zod";

import { sortJson, stringifySchemaDocument, z } from "./schema-registry.ts";

function normalizeSchema(schema: unknown): unknown {
  if (!schema) return undefined;
  const document: Record<string, unknown> = { ...toJSONSchema(schema as import("zod").ZodType) };
  delete document.$schema;
  return sortJson(document);
}

function sortStrings(values: string[] = []): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeChannelMessages(messages: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((messages || []).map((message) => Object.freeze({
    id: String(message.id || "").trim(),
    title: String(message.title || "").trim(),
    summary: String(message.summary || "").trim(),
    contentType: String(message.contentType || "application/json").trim(),
    schema: message.schema,
  })));
}

function normalizeChannels(channels: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((channels || []).map((channel) => Object.freeze({
    name: String(channel.name || "").trim(),
    address: String(channel.address || channel.name || "").trim(),
    description: String(channel.description || "").trim(),
    operation: String(channel.operation || "subscribe").trim().toLowerCase(),
    messages: normalizeChannelMessages(channel.messages as Record<string, unknown>[]),
  })));
}

export function defineAsyncEventSurface(definition: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: String(definition?.id || "").trim(),
    version: String(definition?.version || "").trim(),
    title: String(definition?.title || "").trim(),
    description: String(definition?.description || "").trim(),
    sourcePath: String(definition?.sourcePath || "").trim(),
    outputPath: String(definition?.outputPath || "").trim(),
    producers: Object.freeze(sortStrings(definition?.producers as string[] || [])),
    consumers: Object.freeze(sortStrings(definition?.consumers as string[] || [])),
    channels: normalizeChannels(definition?.channels as Record<string, unknown>[] || []),
  });
}

export function exportAsyncApiDocument(surface: Record<string, unknown>): Record<string, unknown> {
  const channels: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};

  for (const channel of (surface.channels as Record<string, unknown>[]) || []) {
    const operation = channel.operation === "publish" ? "publish" : "subscribe";
    const refs: Record<string, string>[] = [];

    for (const message of (channel.messages as Record<string, unknown>[]) || []) {
      const messageId = String(message.id || "").trim();
      if (!messageId) continue;
      messages[messageId] = sortJson({
        name: messageId,
        title: message.title,
        summary: message.summary,
        contentType: message.contentType,
        payload: normalizeSchema(message.schema),
      });
      refs.push({ $ref: `#/components/messages/${messageId}` });
    }

    channels[channel.name as string] = sortJson({
      address: channel.address,
      description: channel.description,
      [operation]: refs.length === 1
        ? { message: refs[0] }
        : { messages: refs },
    });
  }

  return sortJson({
    asyncapi: "2.6.0",
    info: {
      title: surface.title,
      version: surface.version,
      description: surface.description,
    },
    channels,
    components: {
      messages,
    },
  }) as Record<string, unknown>;
}

export function stringifyAsyncApiDocument(surface: Record<string, unknown>): string {
  return stringifySchemaDocument(exportAsyncApiDocument(surface));
}

export { z };
