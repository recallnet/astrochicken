#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeAsyncApiContract,
  ASYNCAPI_REGISTRY_JSON_PATH,
  ASYNCAPI_REGISTRY_MARKDOWN_PATH,
  discoverAsyncApiSourceModules,
  loadAsyncApiSurfaces,
  writeAsyncApiArtifacts,
} from "./lib/asyncapi-contract.ts";

const writeMode = process.argv.includes("--write");

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const surfaces = await loadAsyncApiSurfaces();
const discoveredSourcePaths = discoverAsyncApiSourceModules();
let analysis = analyzeAsyncApiContract({
  surfaces,
  discoveredSourcePaths,
  expectedRegistryJson: readOptional(ASYNCAPI_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readOptional(ASYNCAPI_REGISTRY_MARKDOWN_PATH).trimEnd(),
});

if (writeMode) {
  writeAsyncApiArtifacts(analysis);
  analysis = analyzeAsyncApiContract({
    surfaces,
    discoveredSourcePaths,
    expectedRegistryJson: readOptional(ASYNCAPI_REGISTRY_JSON_PATH),
    expectedRegistryMarkdown: readOptional(ASYNCAPI_REGISTRY_MARKDOWN_PATH).trimEnd(),
  });
}

if (!analysis.ok) {
  console.error(`[asyncapi_contract] result=fail diagnostics=${analysis.diagnostics.length}`);
  for (const diagnostic of analysis.diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[asyncapi_contract] result=ok diagnostics=${analysis.diagnostics.length}`);
console.log(JSON.stringify(analysis.report.summary));
