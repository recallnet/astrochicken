#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write("[docs-skills-templates-contract] result=fail reason=spawn_error\n");
    throw result.error;
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    process.stderr.write(`[docs-skills-templates-contract] result=fail exit=${exitStatus}\n`);
    process.exit(exitStatus);
  }
}

run("pnpm", ["--silent", "docs:check"]);

run("node", [
  "--test",
  "scripts/factory-architect-subagent.test.mjs",
  "packages/factory-ops/test/commands/hatch-factory-architect-skill-contract.test.ts",
]);

process.stdout.write("[docs-skills-templates-contract] result=ok exit=0\n");
