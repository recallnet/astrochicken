#!/usr/bin/env node

import { analyzeWorkflowIrAcceptanceContract } from "./lib/workflow-ir-acceptance-contract.ts";

const result = await analyzeWorkflowIrAcceptanceContract({ repoRoot: process.cwd(), includeRuntimeParity: false });
for (const diagnostic of result.publishStateDiagnostics) {
  process.stdout.write(`[workflow_ir_publish_or_plan_exclusive] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[workflow_ir_publish_or_plan_exclusive] result=${result.publishStateDiagnostics.length === 0 ? "ok" : "fail"} diagnostics=${result.publishStateDiagnostics.length}\n`,
);
process.exit(result.publishStateDiagnostics.length === 0 ? 0 : 1);
