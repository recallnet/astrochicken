#!/usr/bin/env node

import { analyzeReopenedPhaseGovernance } from "./lib/reopened-phase-governance-contract.ts";
import { extractPhaseSection, isChecklistLineChecked, readRoadmap } from "./lib/roadmap-phase-status.ts";

const roadmap = readRoadmap(process.cwd());
const section = extractPhaseSection(roadmap, "Phase 10: Factory Composition Model");
const claimsChecked = [
  "New factories are mostly composition and configuration.",
  "New factories do not require a factory-local DSL or private composition substrate beyond the shared model.",
].some((label) => isChecklistLineChecked(section, label));

const result = await analyzeReopenedPhaseGovernance({
  repoRoot: process.cwd(),
  includeWorkflowIrRuntimeParity: false,
});
const diagnostics = claimsChecked
  ? [
      ...result.report.legacy_inventory_details.thin_factory_execution_semantics,
      ...result.report.legacy_inventory_details.fake_factory_stub_claims,
    ]
  : [];
for (const diagnostic of diagnostics) {
  process.stdout.write(`[thin_factory_end_state_guard] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[thin_factory_end_state_guard] result=${diagnostics.length === 0 ? "ok" : "fail"} checked_claims=${claimsChecked} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
