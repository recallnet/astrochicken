#!/usr/bin/env node

import { analyzeWorkflowSourceContract } from "./lib/workflow-source-contract.ts";

const result = await analyzeWorkflowSourceContract({ repoRoot: process.cwd() });
const diagnostics = result.diagnostics.filter((entry) =>
  /workflow_source_active_mothership_graph_not_migrated|workflow_source_missing_runtime_graph_marker|workflow_source_runtime_graph_path_drift|workflow_source_missing_for_runtime_graph/.test(entry),
);
for (const diagnostic of diagnostics) {
  process.stdout.write(`[no_handwritten_dot_for_migrated_families] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[no_handwritten_dot_for_migrated_families] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
);
process.exit(diagnostics.length === 0 ? 0 : 1);
