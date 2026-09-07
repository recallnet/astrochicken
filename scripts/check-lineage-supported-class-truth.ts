#!/usr/bin/env node

import {
  analyzeLineageGovernanceContract,
  LINEAGE_GATE_MODES,
  lineageDiagnosticMatchesMode,
} from "./lib/lineage-governance-contract.ts";

const result = await analyzeLineageGovernanceContract({ repoRoot: process.cwd() });
const diagnostics = result.diagnostics.filter((entry) => lineageDiagnosticMatchesMode(entry, LINEAGE_GATE_MODES.lineage_supported_class_truth));
for (const diagnostic of diagnostics) {
  process.stdout.write(`[lineage_supported_class_truth] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[lineage_supported_class_truth] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
