#!/usr/bin/env node

import { analyzeReopenedPhaseGovernance } from "./lib/reopened-phase-governance-contract.ts";
import { extractPhaseSection, isChecklistLineChecked, readRoadmap } from "./lib/roadmap-phase-status.ts";

const roadmap = readRoadmap(process.cwd());
const section = extractPhaseSection(roadmap, "Phase 10: Factory Composition Model");
const phaseClaimChecked = isChecklistLineChecked(section, "Shared capabilities can be reused with minimal factory-specific glue.");
const result = await analyzeReopenedPhaseGovernance({
  repoRoot: process.cwd(),
  includeWorkflowIrRuntimeParity: false,
});
const diagnostics = phaseClaimChecked
  ? result.report.legacy_inventory_details.thin_factory_execution_semantics.filter((entry) =>
      entry.startsWith("factory_thin_execution_semantics"),
    )
  : [];
for (const diagnostic of diagnostics) {
  process.stdout.write(`[factory_execution_glue_forbidden] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[factory_execution_glue_forbidden] result=${diagnostics.length === 0 ? "ok" : "fail"} checked_claim=${phaseClaimChecked} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
