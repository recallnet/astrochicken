#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeSyncOpenApiContract,
  discoverSyncOpenApiSourceModules,
  loadSyncOpenApiSurfaces,
  SYNC_OPENAPI_REGISTRY_JSON_PATH,
  SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH,
  writeSyncOpenApiArtifacts,
} from "./lib/sync-openapi-contract.ts";

const writeMode = process.argv.includes("--write");

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const surfaces = await loadSyncOpenApiSurfaces();
const discoveredSourcePaths = discoverSyncOpenApiSourceModules();
let analysis = analyzeSyncOpenApiContract({
  surfaces,
  discoveredSourcePaths,
  expectedRegistryJson: readOptional(SYNC_OPENAPI_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readOptional(SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH).trimEnd(),
});

if (writeMode) {
  writeSyncOpenApiArtifacts(analysis);
  analysis = analyzeSyncOpenApiContract({
    surfaces,
    discoveredSourcePaths,
  });
  writeSyncOpenApiArtifacts(analysis);
  analysis = analyzeSyncOpenApiContract({
    surfaces,
    discoveredSourcePaths,
    expectedRegistryJson: readOptional(SYNC_OPENAPI_REGISTRY_JSON_PATH),
    expectedRegistryMarkdown: readOptional(SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH).trimEnd(),
  });
}

if (!analysis.ok) {
  console.error(`[sync_openapi_contract] result=fail diagnostics=${analysis.diagnostics.length}`);
  for (const diagnostic of analysis.diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[sync_openapi_contract] result=ok diagnostics=${analysis.diagnostics.length}`);
console.log(JSON.stringify(analysis.report.summary));
