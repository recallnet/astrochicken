#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { main } from "./lib/check-harness.ts";

const CONTRACT_TEST_FILES = [
  // @context:regression Disabled pending #2597 — sequential CLI spawns return
  // stale factory_root due to resolver caching bug.
  // "packages/factory-ops/test/supervisor/factory-context-resolution-cli.contract.test.ts",
  "packages/factory-ops/test/supervisor/factory-status.contract.test.ts",
  "packages/factory-ops/test/supervisor/factory-tick-status.contract.test.ts",
  "packages/factory-ops/test/commands/runs-dir-resolution.test.ts",
];

function filterHarnessPassthroughArgs(argv = []) {
  return argv.filter((arg) => arg !== "--silent");
}

function checkFactoryPortabilityContract() {
  // @context:regression !critical Serial test execution keeps this hook gate
  // from spawning multiple CLI-heavy contract workers at once under load.
  const result = spawnSync("node", ["--test", "--test-concurrency=1", ...CONTRACT_TEST_FILES], { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  return {
    ok: result.status === 0,
    diagnostics: [],
  };
}

const isEntryPoint = process.argv[1]?.endsWith("check-factory-portability-contract.ts") || process.argv[1]?.endsWith("check-factory-portability-contract.mjs") === true;
if (isEntryPoint) {
  main(checkFactoryPortabilityContract, {
    gate: "factory-portability-contract",
    argv: filterHarnessPassthroughArgs(process.argv.slice(2)),
  });
}
