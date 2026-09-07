#!/usr/bin/env node

import { analyzeLineageProjectionSamples } from "./lib/lineage-projection-samples.ts";
import { analyzeWorkflowIrAcceptanceContract } from "./lib/workflow-ir-acceptance-contract.ts";

const diagnostics = [];
const workflowIr = await analyzeWorkflowIrAcceptanceContract({ repoRoot: process.cwd(), includeRuntimeParity: true });
const lineageSamples = analyzeLineageProjectionSamples();
if (!workflowIr.ok) diagnostics.push(...workflowIr.runtimeParityDiagnostics);
if (!lineageSamples.ok) diagnostics.push(...lineageSamples.diagnostics.map((entry) => `runtime_conformance_${entry}`));
for (const diagnostic of diagnostics) {
  process.stdout.write(`[runtime_conformance_matrix] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[runtime_conformance_matrix] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
