#!/usr/bin/env node

import { analyzeReopenedPhaseGovernance } from "./lib/reopened-phase-governance-contract.ts";

const result = await analyzeReopenedPhaseGovernance({
  repoRoot: process.cwd(),
  includeWorkflowIrRuntimeParity: false,
});
const diagnostics = result.report.legacy_inventory_details.thin_factory_execution_semantics.filter((entry) =>
  entry.startsWith("factory_local_pipeline_target"),
);
for (const diagnostic of diagnostics) {
  process.stdout.write(`[factory_local_dot_scope_guard] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[factory_local_dot_scope_guard] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
