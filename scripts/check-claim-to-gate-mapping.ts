#!/usr/bin/env node

import { analyzeReopenedPhaseGovernance } from "./lib/reopened-phase-governance-contract.ts";

const result = await analyzeReopenedPhaseGovernance({
  repoRoot: process.cwd(),
  includeWorkflowIrRuntimeParity: false,
});
const diagnostics = result.diagnostics.filter((entry) =>
  entry.startsWith("phase_claim_missing_gate_reference")
  || entry.startsWith("phase_claim_missing_gate_status")
  || entry.startsWith("phase_claim_conflicting_checklist_state"),
);
for (const diagnostic of diagnostics) {
  process.stdout.write(`[claim_to_gate_mapping] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[claim_to_gate_mapping] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
