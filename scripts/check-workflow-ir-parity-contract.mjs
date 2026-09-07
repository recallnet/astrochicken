#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeWorkflowIrParityContract,
  WORKFLOW_IR_REGISTRY_JSON_PATH,
  WORKFLOW_IR_REGISTRY_MARKDOWN_PATH,
  writeWorkflowIrParityOutputs,
} from "./lib/workflow-ir-parity-contract.ts";

function readOptional(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

const writeMode = process.argv.includes("--write");

let analysis = await analyzeWorkflowIrParityContract({
  expectedRegistryJson: readOptional(WORKFLOW_IR_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readOptional(WORKFLOW_IR_REGISTRY_MARKDOWN_PATH).trimEnd(),
});

if (writeMode) {
  analysis = await writeWorkflowIrParityOutputs();
}

if (!analysis.ok) {
  console.error(`[workflow_ir_parity_contract] result=fail diagnostics=${analysis.diagnostics.length}`);
  for (const diagnostic of analysis.diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[workflow_ir_parity_contract] result=ok diagnostics=${analysis.diagnostics.length}`);
console.log(JSON.stringify(analysis.report.summary));
