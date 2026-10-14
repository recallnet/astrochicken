import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listActiveLocalIntentGraphPaths, listLocalIntentGraphPaths, migrateLocalIntentGraphTrustContracts, validateLocalIntentGraphTrustContracts } from "../../src/commands/graph-trust-contract.ts";
import { validateManagedDomainContract } from "../../src/commands/supervisor-managed-domain-contract.ts";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "typed-graph-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const document = {
    schemaVersion: "workflow_source_module/v1", workflowId: "typed_domain", familyId: "contract_test", title: "Typed domain",
    sourcePath: "domain.workflow-source.mjs", runtimeGraphPath: "domain.dot", jsonSchemaOutputPath: "schema.json",
    sourceMap: { graphName: "typed_domain", nodeMappings: ["start", "produce", "done"].map((id) => ({ sourceNodeId: id, runtimeNodeId: id })) },
    invariants: { mustPreserve: ["node.id"], mayNormalize: ["whitespace"] },
    nodes: [{ id: "start", kind: "start" }, { id: "produce", kind: "tool_action", handlerType: "tool", actionId: "common.resolve_default", binding: { outputKey: "domain_result" } }, { id: "done", kind: "terminal" }],
    edges: [{ from: "start", to: "produce" }, { from: "produce", to: "done" }],
  };
  const path = join(directory, "domain.workflow-source.mjs");
  writeFileSync(path, `export const WORKFLOW_SOURCE_MODULE = ${JSON.stringify(document)};\n`);
  return { directory, path };
}

test("trust validation inspects typed workflow participants rather than raw module syntax", (t) => {
  const { path } = fixture(t);
  const result = validateLocalIntentGraphTrustContracts({ paths: [path], strict: true });
  assert.ok(result.trust_participants > 0);
  assert.equal(result.ok, false, "missing trust attributes must fail strict validation");
});

test("managed domain validation observes the typed module's actual output binding", (t) => {
  const { path } = fixture(t);
  const result = validateManagedDomainContract({ dotPath: path });
  assert.equal(result.required_output_present, "true");
  assert.equal(result.ok, true);
});

test("trust migration cannot overwrite authored workflow modules with generated DOT", (t) => {
  const { path } = fixture(t);
  const before = readFileSync(path, "utf8");
  assert.throws(() => migrateLocalIntentGraphTrustContracts({ paths: [path], write: true }), /typed_workflow_trust_migration_requires_source_edit/);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("local graph discovery includes nested typed workflow modules", (t) => {
  const { directory, path } = fixture(t);
  const nested = join(directory, "nested");
  mkdirSync(nested);
  const dot = join(nested, "extra.dot");
  writeFileSync(dot, "digraph extra { start -> done; }");
  assert.deepEqual(listLocalIntentGraphPaths({ graphsDir: directory }), [path, dot].sort());
});

test("default active trust validation targets existing canonical mothership sources", () => {
  const paths = listActiveLocalIntentGraphPaths();
  assert.equal(paths.length, 3);
  assert.ok(paths.every((path) => path.startsWith("factories/mothership/workflows/") && existsSync(path)));
});
