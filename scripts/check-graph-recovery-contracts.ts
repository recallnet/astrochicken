#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write("[graph-recovery-contracts] result=fail reason=spawn_error\n");
    throw result.error;
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    process.stderr.write(`[graph-recovery-contracts] result=fail exit=${exitStatus}\n`);
    process.exit(exitStatus);
  }
}

run("node", [
  "--test",
  "packages/factory-ops/test/commands/post-review-merge-chain.contract.test.ts",
  "packages/factory-ops/test/wave/wave-merge-results.test.ts",
  "packages/factory-ops/test/commands/judge-evidence-graph-coverage.test.ts",
  "packages/factory-ops/test/supervisor/factory-recovery-sweep.contract.test.ts",
  "packages/factory-ops/test/supervisor/supervisor-fast-route-routing.contract.test.ts",
  // Mandatory lifecycle contract coverage for test:platform:supervisor-recovery.
  "packages/factory-ops/test/supervisor/supervisor-external-factory-lifecycle.test.ts",
  "packages/factory-ops/test/supervisor/supervisor-external-factory-lifecycle-state-machine-contract.test.ts",
  "packages/factory-ops/test/supervisor/supervisor-external-factory-lifecycle-convergence.contract.test.ts",
  "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
  "packages/factory-ops/test/packets/packet-takeover-cold-start.contract.test.ts",
]);
run("node", [
  "scripts/check-named-packet-contract.ts",
]);
run("node", [
  "scripts/check-packet-registry-contract.ts",
]);
run("node", [
  "scripts/check-packet-family-coverage.ts",
]);
run("node", [
  "scripts/check-packet-takeover-contract.ts",
]);
run("node", [
  "scripts/check-goal-packet-contract.ts",
]);
run("node", [
  "scripts/check-factory-template-packet-contract.ts",
]);

process.stdout.write("[graph-recovery-contracts] result=ok exit=0\n");
