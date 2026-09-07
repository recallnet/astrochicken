#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write("[external-factory-compat] result=fail reason=spawn_error\n");
    throw result.error;
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    process.stderr.write(`[external-factory-compat] result=fail exit=${exitStatus}\n`);
    process.exit(exitStatus);
  }
}

run("node", [
  "--test",
  "packages/factory-ops/test/supervisor/factory-config-resolver.test.ts",
  "packages/factory-ops/test/supervisor/factory-daemon-config.contract.test.ts",
  "scripts/external-factory-shared-surface-consumption.contract.test.mjs",
]);

process.stdout.write("[external-factory-compat] result=ok exit=0\n");
