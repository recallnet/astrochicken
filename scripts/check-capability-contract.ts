#!/usr/bin/env node

import {
  analyzeCapabilityContract,
  writeCapabilityContractOutputs,
} from "./lib/capability-contract.ts";

async function main() {
  const repoRoot = process.cwd();
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  const result = write
    ? await writeCapabilityContractOutputs({ repoRoot })
    : await analyzeCapabilityContract({ repoRoot });

  for (const diagnostic of result.report.diagnostics) {
    process.stdout.write(`[capability_contract] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[capability_contract] result=${result.ok ? "ok" : "fail"} capabilities=${result.report.summary.registered_capabilities} diagnostics=${result.report.summary.diagnostics}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-capability-contract.ts") || process.argv[1]?.endsWith("check-capability-contract.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  });
}
