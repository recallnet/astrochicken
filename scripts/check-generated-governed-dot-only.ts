#!/usr/bin/env node

import { analyzeWorkflowSourceContract } from "./lib/workflow-source-contract.ts";

const analysis = await analyzeWorkflowSourceContract();
const diagnostics = analysis.diagnostics.filter((entry) =>
  /workflow_source_governed_execution_dot_input_forbidden|workflow_source_governed_execution_dot_exemption_/.test(entry),
);

if (diagnostics.length > 0) {
  console.error(`[generated_governed_dot_only] result=fail diagnostics=${diagnostics.length}`);
  for (const diagnostic of diagnostics) {
    console.error(diagnostic);
  }
  process.exit(1);
}

console.log(`[generated_governed_dot_only] result=ok diagnostics=${diagnostics.length}`);
