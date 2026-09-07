#!/usr/bin/env node
import { analyzeFactoryCompositionContract, writeFactoryCompositionOutputs } from "./lib/factory-composition-contract.ts";

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");

const result = shouldWrite
  ? await writeFactoryCompositionOutputs()
  : await analyzeFactoryCompositionContract();

process.stdout.write(`[factory-composition-contract] result=${result.ok ? "ok" : "fail"} factories=${result.report.summary.registered_factories} diagnostics=${result.report.summary.diagnostics}\n`);

if (!result.ok) {
  for (const diagnostic of result.report.diagnostics) {
    process.stderr.write(`${diagnostic}\n`);
  }
  process.exit(1);
}
