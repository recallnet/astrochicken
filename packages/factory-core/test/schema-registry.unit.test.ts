import assert from "node:assert/strict";
import test from "node:test";

import {
  createIssueList,
  defineBoundarySchema,
  exportBoundaryJsonSchema,
  formatSchemaPath,
  stringifySchemaDocument,
  z,
} from "../src/schema-registry.ts";

test("formatSchemaPath renders object and array paths deterministically", () => {
  assert.equal(formatSchemaPath([]), "");
  assert.equal(formatSchemaPath(["profiles", "operator", "goals", 1]), "profiles.operator.goals[1]");
});

test("createIssueList maps zod issues into stable path/message records", () => {
  const schema = z.object({
    name: z.string(),
    items: z.array(z.object({ id: z.string() })),
  });

  const result = schema.safeParse({
    name: 1,
    items: [{ id: "ok" }, { id: 2 }],
  });

  assert.equal(result.success, false);
  assert.deepEqual(createIssueList(result.error), [
    {
      path: "name",
      message: "Invalid input: expected string, received number",
    },
    {
      path: "items[1].id",
      message: "Invalid input: expected string, received number",
    },
  ]);
});

test("exportBoundaryJsonSchema emits deterministic JSON schema metadata", () => {
  const definition = defineBoundarySchema({
    id: "https://example.invalid/schemas/sample.json",
    version: "sample/v1",
    title: "Sample",
    description: "Example schema",
    outputPath: "docs/contracts/sample.json",
    sourcePath: "src/sample.mjs",
    schema: z.strictObject({
      schema_version: z.literal("sample/v1"),
      name: z.string().min(1),
    }),
  });

  const exported = exportBoundaryJsonSchema(definition);
  assert.equal(exported.$id, "https://example.invalid/schemas/sample.json");
  assert.equal(exported.title, "Sample");
  assert.deepEqual(exported.required, ["schema_version", "name"]);
  assert.equal(exported.additionalProperties, false);
  assert.match(stringifySchemaDocument(exported), /"schema_version"/);
});
