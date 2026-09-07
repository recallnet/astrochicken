import {
  analyzeReopenedPhaseGovernance,
  writeReopenedPhaseGovernance,
} from "./lib/reopened-phase-governance-contract.ts";
import { extractPhaseSection, isChecklistLineChecked, readRoadmap } from "./lib/roadmap-phase-status.ts";

const write = process.argv.includes("--write");
const result = write
  ? await writeReopenedPhaseGovernance({ repoRoot: process.cwd() })
  : await analyzeReopenedPhaseGovernance({
    repoRoot: process.cwd(),
    includeWorkflowIrRuntimeParity: false,
  });
const roadmap = readRoadmap(process.cwd());
const phase10Section = extractPhaseSection(roadmap, "Phase 10: Factory Composition Model");
const diagnostics = [];
for (const [key, count] of Object.entries(result.report.legacy_inventory || {})) {
  if (Number(count) < 1) continue;
  const claimStillChecked = key === "thin_factory_execution_semantics" || key === "fake_factory_stub_claims"
    ? (
        isChecklistLineChecked(phase10Section, "New factories are mostly composition and configuration.")
        || isChecklistLineChecked(phase10Section, "Shared capabilities can be reused with minimal factory-specific glue.")
        || isChecklistLineChecked(phase10Section, "New factories do not require a factory-local DSL or private composition substrate beyond the shared model.")
      )
    : true;
  if (claimStillChecked) {
    diagnostics.push(`legacy_pattern_nonzero key=${JSON.stringify(key)} count=${count}`);
  }
}
for (const diagnostic of diagnostics) {
  process.stdout.write(`[legacy_pattern_zero_inventory] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[legacy_pattern_zero_inventory] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}${write ? " wrote=true" : ""}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
