#!/usr/bin/env node

import {
  analyzeLineageGovernanceContract,
  writeLineageGovernanceOutputs,
} from "./lib/lineage-governance-contract.ts";

async function main() {
  const repoRoot = process.cwd();
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  const result = write
    ? await writeLineageGovernanceOutputs({ repoRoot })
    : await analyzeLineageGovernanceContract({ repoRoot });

  for (const diagnostic of result.report.diagnostics) {
    process.stdout.write(`[lineage_governance_contract] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[lineage_governance_contract] result=${result.ok ? "ok" : "fail"} run_classes=${result.report.summary.supported_run_classes} artifact_classes=${result.report.summary.supported_artifact_classes} diagnostics=${result.report.summary.diagnostics}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-lineage-governance-contract.ts") || process.argv[1]?.endsWith("check-lineage-governance-contract.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  });
}
