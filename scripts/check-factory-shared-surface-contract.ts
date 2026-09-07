#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/sync-shared-factory-surfaces.mjs", "--check"], {
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write("[factory-shared-surface-contract] result=fail reason=spawn_error\n");
  throw result.error;
}

const exitStatus = Number.isInteger(result.status) ? result.status : 1;
if (exitStatus !== 0) {
  process.stderr.write(`[factory-shared-surface-contract] result=fail exit=${exitStatus}\n`);
  process.exit(exitStatus);
}

process.stdout.write("[factory-shared-surface-contract] result=ok exit=0\n");
