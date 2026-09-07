#!/usr/bin/env node

import {
  analyzeCapabilityOutputContract,
  writeCapabilityOutputContractOutputs,
} from "./lib/capability-output-contract.ts";

async function main() {
  const repoRoot = process.cwd();
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  const result = write
    ? await writeCapabilityOutputContractOutputs({ repoRoot })
    : await analyzeCapabilityOutputContract({ repoRoot });

  for (const diagnostic of result.report.diagnostics) {
    process.stdout.write(`[capability_output_contract] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[capability_output_contract] result=${result.ok ? "ok" : "fail"} capabilities=${result.report.summary.registered_capabilities} events=${result.report.summary.documented_events} artifacts=${result.report.summary.documented_artifacts} telemetry=${result.report.summary.documented_telemetry_expectations} diagnostics=${result.report.summary.diagnostics}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-capability-output-contract.ts") || process.argv[1]?.endsWith("check-capability-output-contract.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  });
}
