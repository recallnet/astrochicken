#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { scenarioCountGate } from "../packages/factory-ops/src/commands/scenario-count-gate.ts";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
}

function parseArgs(argv) {
  const registryRoot = argValue(argv, "--registry-root") || "factories/mothership/scenarios";
  const maxCount = argValue(argv, "--max-count") || "30";
  const json = argv.includes("--json");
  return { registryRoot, maxCount, json };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const out = scenarioCountGate({
    registryRoot: options.registryRoot,
    maxCount: options.maxCount,
  });

  if (options.json) {
    console.log(JSON.stringify(out));
  }

  console.log(`[scenario_count_gate] result=${out.ok ? "ok" : "fail"} count=${out.scenario_count} max=${out.max_count} root=${JSON.stringify(out.registry_root)}`);
  if (!out.ok) {
    console.error(`[scenario_count_gate] error=${out.error}`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
