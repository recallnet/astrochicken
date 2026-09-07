#!/usr/bin/env node

import {
  analyzeReopenedPhaseGovernance,
  GOVERNED_SURFACE_OWNER_GATES,
} from "./lib/reopened-phase-governance-contract.ts";

const result = await analyzeReopenedPhaseGovernance({
  repoRoot: process.cwd(),
  includeWorkflowIrRuntimeParity: false,
});
const diagnostics = GOVERNED_SURFACE_OWNER_GATES
  .filter((gateId) => result.report.supporting_gate_status?.[gateId] !== true)
  .map((gateId) => `governed_surface_totality_missing_owner gate=${JSON.stringify(gateId)}`);
for (const diagnostic of diagnostics) {
  process.stdout.write(`[governed_surface_totality] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[governed_surface_totality] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
