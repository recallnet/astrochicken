#!/usr/bin/env node

import { analyzeWorkflowIrAcceptanceContract } from "./lib/workflow-ir-acceptance-contract.ts";

const result = await analyzeWorkflowIrAcceptanceContract({ repoRoot: process.cwd(), includeRuntimeParity: true });
for (const diagnostic of result.runtimeParityDiagnostics) {
  process.stdout.write(`[workflow_ir_runtime_parity_e2e] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[workflow_ir_runtime_parity_e2e] result=${result.runtimeParityDiagnostics.length === 0 ? "ok" : "fail"} diagnostics=${result.runtimeParityDiagnostics.length}\n`,
);
process.exit(result.runtimeParityDiagnostics.length === 0 ? 0 : 1);
