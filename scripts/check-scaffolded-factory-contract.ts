#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { runPostinstallBootstrap } from "./postinstall-bootstrap.mjs";

function parseArgs(argv) {
  const options = {
    factoryRoot: "",
    repoRoot: "",
    silent: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--factory-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--factory-root requires a path");
      }
      options.factoryRoot = resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--repo-root requires a path");
      }
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--silent") {
      options.silent = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runPhase(phase, command, args) {
  const invocation = [command, ...args].join(" ");
  if (!options.silent) {
    process.stdout.write(`[scaffold-contract] phase=${phase} action=run command=${JSON.stringify(invocation)}\n`);
  }

  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    if (!options.silent) {
      process.stderr.write(`[scaffold-contract] phase=${phase} result=fail exit=1 error=${JSON.stringify(result.error.message)}\n`);
    }
    process.exit(1);
  }

  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    if (!options.silent) {
      process.stderr.write(`[scaffold-contract] phase=${phase} result=fail exit=${exitStatus}\n`);
    }
    process.exit(exitStatus);
  }

  if (!options.silent) {
    process.stdout.write(`[scaffold-contract] phase=${phase} result=ok exit=0\n`);
  }
}

const options = parseArgs(process.argv.slice(2));
runPostinstallBootstrap();

if (options.factoryRoot) {
  const args = [
    "run",
    "factory:health",
    "--silent",
    "--",
    "--factory-root",
    options.factoryRoot,
  ];

  if (options.repoRoot) {
    args.push("--repo-root", options.repoRoot);
  }

  runPhase("factory-health", "npm", args);
  process.exit(0);
}

// Use exec vitest directly to target only the specific files, avoiding the full
// 150+ test suite that the manifest runner would pull in via broad path patterns.
runPhase("unit-contract", "pnpm", [
  "--silent",
  "--filter",
  "hatch",
  "exec",
  "vitest",
  "--run",
  "src/factory/config-schema.test.ts",
  "src/factory/scaffold.test.ts",
  "src/factory/init.test.ts",
]);

runPhase("generated-conformance", "node", [
  "scripts/verify-scaffolded-factory-conformance.mjs",
  "--skip-unit-contracts",
]);
