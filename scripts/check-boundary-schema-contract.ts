#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeBoundarySchemaContract,
  BOUNDARY_SCHEMA_REGISTRY_JSON_PATH,
  BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH,
  discoverBoundarySchemaSourceModules,
  loadBoundarySchemaDefinitions,
  writeBoundarySchemaArtifacts,
} from "./lib/boundary-schema-contract.ts";

const writeMode = process.argv.includes("--write");

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const definitions = await loadBoundarySchemaDefinitions();
const discoveredSourcePaths = discoverBoundarySchemaSourceModules();
let analysis = analyzeBoundarySchemaContract({
  definitions,
  discoveredSourcePaths,
  expectedRegistryJson: readOptional(BOUNDARY_SCHEMA_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readOptional(BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH).trimEnd(),
});

if (writeMode) {
  writeBoundarySchemaArtifacts(analysis);
  analysis = analyzeBoundarySchemaContract({
    definitions,
    discoveredSourcePaths,
    expectedRegistryJson: readOptional(BOUNDARY_SCHEMA_REGISTRY_JSON_PATH),
    expectedRegistryMarkdown: readOptional(BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH).trimEnd(),
  });
}

if (!analysis.ok) {
  console.error(`[boundary_schema_contract] result=fail diagnostics=${analysis.diagnostics.length}`);
  for (const diagnostic of analysis.diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[boundary_schema_contract] result=ok diagnostics=${analysis.diagnostics.length}`);
console.log(JSON.stringify(analysis.report.summary));
