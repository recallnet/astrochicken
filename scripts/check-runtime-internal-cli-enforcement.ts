#!/usr/bin/env node

import { analyzeInternalCliTransport } from "./check-internal-cli-transport.ts";
import { loadActiveSurfaceManifest, selectManifestScopedFiles } from "./lib/active-surface-manifest.ts";
import { PHASE1_GATE_SCOPE_CONTRACT } from "./lib/phase1-gate-scope-contract.ts";

const ENFORCED_CLASSIFICATIONS = PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.classifications;
export const RUNTIME_INTERNAL_CLI_ALLOWLIST = Object.freeze([]);

export function analyzeRuntimeInternalCliEnforcement({ files = [], readFile, manifest = loadActiveSurfaceManifest() } = {}) {
  const scopedFiles = selectManifestScopedFiles({
    manifest,
    files,
    surfaceType: "runtime",
    classifications: ENFORCED_CLASSIFICATIONS,
  });
  const analysis = analyzeInternalCliTransport({ files: scopedFiles, readFile, failOptedInGraphs: false });
  const runtimeViolations = analysis.violations.filter((entry) => entry.kind === "runtime_internal_cli_transport");
  return {
    schema_version: "runtime_internal_cli_enforcement/v1",
    ok: runtimeViolations.length === 0,
    checked: scopedFiles.length,
    enforced_classifications: [...ENFORCED_CLASSIFICATIONS],
    allowlisted_external_boundaries: [...RUNTIME_INTERNAL_CLI_ALLOWLIST],
    violations: runtimeViolations,
  };
}

function main() {
  const files = process.argv.slice(2);
  const result = analyzeRuntimeInternalCliEnforcement({ files });
  for (const violation of result.violations) {
    process.stdout.write(`[runtime-internal-cli] fail file=${JSON.stringify(violation.file)} count=${violation.internal_cli_calls}\n`);
  }
  process.stdout.write(`[runtime-internal-cli] result=${result.ok ? "ok" : "fail"} checked=${result.checked} violations=${result.violations.length}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-runtime-internal-cli-enforcement.ts") || process.argv[1]?.endsWith("check-runtime-internal-cli-enforcement.mjs")) {
  main();
}
