#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(label, command, args) {
  process.stderr.write(`[external-factory-portability-matrix] start label=${label} command=${JSON.stringify([command, ...args].join(" "))}\n`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`[external-factory-portability-matrix] fail label=${label} reason=spawn_error message=${JSON.stringify(String(result.error))}\n`);
    process.stderr.write(`[external-factory-portability-matrix] result=fail label=${label} reason=spawn_error\n`);
    throw result.error;
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    process.stderr.write(`[external-factory-portability-matrix] fail label=${label} reason=portability_contract_failure exit=${exitStatus}\n`);
    process.stderr.write(`[external-factory-portability-matrix] result=fail label=${label} exit=${exitStatus}\n`);
    process.exit(exitStatus);
  }
  process.stderr.write(`[external-factory-portability-matrix] pass label=${label}\n`);
}

// Run each contract test in isolation (not through the package manifest runner) so
// that vitest receives only the target file as a pattern and does not pull in the
// full 150+ test suite, which causes flaky parallel-state contamination.
run("external_factory_portability", "pnpm", [
  "--silent",
  "--filter",
  "hatch",
  "exec",
  "vitest",
  "--run",
  "src/factory/external-factory-portability.contract.test.ts",
]);

run("supervisor_snapshot_context_portability", "pnpm", [
  "--silent",
  "--filter",
  "hatch",
  "exec",
  "vitest",
  "--run",
  "src/factory/supervisor-snapshot-context-portability.contract.test.ts",
]);

process.stdout.write("[external-factory-portability-matrix] result=ok checks=2\n");
