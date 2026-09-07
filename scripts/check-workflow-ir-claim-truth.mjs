#!/usr/bin/env node

import { analyzeWorkflowIrAcceptanceContract } from "./lib/workflow-ir-acceptance-contract.ts";

const result = await analyzeWorkflowIrAcceptanceContract({ repoRoot: process.cwd(), includeRuntimeParity: false });
for (const diagnostic of result.claimTruthDiagnostics) {
  process.stdout.write(`[workflow_ir_claim_truth] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[workflow_ir_claim_truth] result=${result.claimTruthDiagnostics.length === 0 ? "ok" : "fail"} diagnostics=${result.claimTruthDiagnostics.length}\n`,
);
process.exit(result.claimTruthDiagnostics.length === 0 ? 0 : 1);
