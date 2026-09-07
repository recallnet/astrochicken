#!/usr/bin/env node

import { analyzeFactoryCompositionContract } from "./lib/factory-composition-contract.ts";

const result = await analyzeFactoryCompositionContract({ repoRoot: process.cwd() });
const diagnostics = result.report.diagnostics.filter((entry) => entry.startsWith("factory_composition_ungoverned_shared_graph"));
for (const diagnostic of diagnostics) {
  process.stdout.write(`[factory_composition_binding_truth] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[factory_composition_binding_truth] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
