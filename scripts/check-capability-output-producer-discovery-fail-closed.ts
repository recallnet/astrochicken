#!/usr/bin/env node

import {
  analyzeCapabilityOutputContract,
  CAPABILITY_OUTPUT_GATE_MODES,
  capabilityOutputDiagnosticMatchesMode,
} from "./lib/capability-output-contract.ts";

async function main() {
  const result = await analyzeCapabilityOutputContract({ repoRoot: process.cwd() });
  const diagnostics = result.report.diagnostics.filter((entry) =>
    capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.capability_output_producer_discovery_fail_closed),
  );
  for (const diagnostic of diagnostics) {
    process.stdout.write(`[capability_output_producer_discovery_fail_closed] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[capability_output_producer_discovery_fail_closed] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`,
  );
  process.exit(diagnostics.length === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});
