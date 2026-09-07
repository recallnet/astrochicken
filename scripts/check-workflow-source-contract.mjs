#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeWorkflowSourceContract,
  WORKFLOW_SOURCE_REGISTRY_JSON_PATH,
  WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH,
  writeWorkflowSourceOutputs,
} from "./lib/workflow-source-contract.ts";

const writeMode = process.argv.includes("--write");

function readOptional(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

let analysis = await analyzeWorkflowSourceContract({
  expectedRegistryJson: readOptional(WORKFLOW_SOURCE_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readOptional(WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH).trimEnd(),
});

if (writeMode) {
  analysis = await writeWorkflowSourceOutputs();
}

if (!analysis.ok) {
  console.error(`[workflow_source_contract] result=fail diagnostics=${analysis.diagnostics.length}`);
  for (const diagnostic of analysis.diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[workflow_source_contract] result=ok diagnostics=${analysis.diagnostics.length}`);
console.log(JSON.stringify(analysis.report.summary));
