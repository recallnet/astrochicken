import { z, toJSONSchema } from "zod";

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

export function formatSchemaPath(path: Array<string | number> = []): string {
  if (!Array.isArray(path) || path.length === 0) {
    return "";
  }

  let out = "";
  for (const part of path) {
    if (typeof part === "number") {
      out += `[${part}]`;
      continue;
    }
    out += out ? `.${part}` : String(part);
  }
  return out;
}

export function createIssueList(
  error: { issues: Array<{ path?: Array<string | number>; message: string }> },
  mapIssue?: (issue: Record<string, unknown>, path: string) => { path: string; message: string },
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => {
    const path = formatSchemaPath(issue.path);
    if (typeof mapIssue === "function") {
      return mapIssue(issue, path);
    }
    return {
      path,
      message: issue.message,
    };
  });
}

export function defineBoundarySchema({
  id,
  version,
  title,
  description = "",
  schema,
  outputPath,
  sourcePath,
  documentVersionField = "schema_version",
}: {
  id: string;
  version: string;
  title: string;
  description?: string;
  schema: unknown;
  outputPath: string;
  sourcePath: string;
  documentVersionField?: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    version,
    title,
    description,
    schema,
    outputPath,
    sourcePath,
    documentVersionField,
  });
}

export function exportBoundaryJsonSchema(definition: Record<string, any>): Record<string, unknown> {
  const exported = toJSONSchema(definition.schema);
  return sortJson({
    ...exported,
    $id: definition.id,
    title: definition.title,
    description: definition.description,
  }) as Record<string, unknown>;
}

export function stringifySchemaDocument(document: unknown): string {
  return `${JSON.stringify(sortJson(document), null, 2)}\n`;
}

export { z };
