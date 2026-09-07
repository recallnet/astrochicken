#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runFactoryHealthCheck } from "./factory-health-check.mjs";
import {
  SCAFFOLD_CONFORMANCE_CONTEXT,
  compareScaffoldSnapshots,
  snapshotScaffoldTree,
} from "./lib/normalize-scaffold-tree.ts";
import { scaffoldFactoryFixture } from "./lib/scaffold-factory-fixture.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
// Treat scaffold output as a shipped artifact: intentional surface changes must update this golden.
const defaultGoldenPath = join(repoRoot, "scripts", "test", "golden", "scaffolded-factory-structure.json");

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-scaffolded-factory-conformance.mjs [--skip-unit-contracts] [--skip-build] [--golden <path>] [--keep-temp]",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    skipUnitContracts: false,
    skipBuild: false,
    keepTemp: false,
    goldenPath: defaultGoldenPath,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-unit-contracts") {
      options.skipUnitContracts = true;
      continue;
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (arg === "--golden") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--golden requires a path");
      }
      options.goldenPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runPhase(command, args, phase) {
  const commandString = [command, ...args].join(" ");
  process.stdout.write(`scaffold_conformance phase=${phase} action=run command=${JSON.stringify(commandString)}\n`);

  const run = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (run.error) {
    process.stderr.write(
      `scaffold_conformance phase=${phase} result=fail exit=1 error=${JSON.stringify(run.error.message)}\n`,
    );
    return { ok: false, exitStatus: 1 };
  }

  const exitStatus = Number.isInteger(run.status) ? run.status : 1;
  if (exitStatus !== 0) {
    process.stderr.write(`scaffold_conformance phase=${phase} result=fail exit=${exitStatus}\n`);
    return { ok: false, exitStatus };
  }

  process.stdout.write(`scaffold_conformance phase=${phase} result=ok exit=0\n`);
  return { ok: true, exitStatus: 0 };
}

function seedWorkspace(tempRoot) {
  const templateSource = join(repoRoot, "factories", "_templates", "factory");
  const templateTarget = join(tempRoot, "factories", "_templates", "factory");
  const policyPackSource = join(repoRoot, "factories", "_templates", "policy-pack");
  const policyPackTarget = join(tempRoot, "factories", "_templates", "policy-pack");

  mkdirSync(dirname(templateTarget), { recursive: true });
  cpSync(templateSource, templateTarget, { recursive: true });
  cpSync(policyPackSource, policyPackTarget, { recursive: true });

  writeFileSync(
    join(tempRoot, "factory-registry.json"),
    `${JSON.stringify({ schema: "hatch.factory.registry.v1", factories: [] }, null, 2)}\n`,
  );
}

async function scaffoldFactoryInWorkspace(tempRoot) {
  const initModulePath = join(repoRoot, "apps", "hatch", "dist", "factory", "init.js");
  if (!existsSync(initModulePath)) {
    throw new Error(`compiled init module not found: ${initModulePath}`);
  }
  return scaffoldFactoryFixture({
    repoRoot,
    rootDir: tempRoot,
    factoryId: SCAFFOLD_CONFORMANCE_CONTEXT.factoryId,
    repo: SCAFFOLD_CONFORMANCE_CONTEXT.repo,
    controlPlane: SCAFFOLD_CONFORMANCE_CONTEXT.controlPlane,
    runsDir: SCAFFOLD_CONFORMANCE_CONTEXT.runsDir,
    trackingIssue: {
      url: SCAFFOLD_CONFORMANCE_CONTEXT.trackingIssueUrl,
      number: SCAFFOLD_CONFORMANCE_CONTEXT.trackingIssueNumber,
      created: false,
    },
  });
}

export async function verifyScaffoldedFactoryConformance(options = {}) {
  const effectiveOptions = {
    skipUnitContracts: Boolean(options.skipUnitContracts),
    skipBuild: Boolean(options.skipBuild),
    keepTemp: Boolean(options.keepTemp),
    goldenPath: resolve(options.goldenPath ?? defaultGoldenPath),
  };

  if (!existsSync(effectiveOptions.goldenPath)) {
    throw new Error(`golden snapshot not found: ${effectiveOptions.goldenPath}`);
  }

  if (!effectiveOptions.skipUnitContracts) {
    const unitPhase = runPhase(
      "pnpm",
      [
        "--silent",
        "--filter",
        "hatch",
        "test",
        "--",
        "src/factory/config-schema.test.ts",
        "src/factory/scaffold.test.ts",
        "src/factory/init.test.ts",
      ],
      "unit_contract",
    );
    if (!unitPhase.ok) {
      return {
        ok: false,
        exitStatus: unitPhase.exitStatus,
      };
    }
  }

  if (!effectiveOptions.skipBuild) {
    const buildPhase = runPhase("pnpm", ["--filter", "hatch", "--silent", "build"], "build_hatch");
    if (!buildPhase.ok) {
      return {
        ok: false,
        exitStatus: buildPhase.exitStatus,
      };
    }
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "scaffold-conformance-"));

  try {
    seedWorkspace(tempRoot);
    const scaffoldResult = await scaffoldFactoryInWorkspace(tempRoot);

    const healthResult = await runFactoryHealthCheck({
      factoryRoot: scaffoldResult.factoryRoot,
      repoRoot: tempRoot,
      commandCwd: repoRoot,
      phases: ["config_schema", "policy_pack_conformance", "graph_validate", "dot_lint", "recovery_ownership"],
    });
    if (!healthResult.ok || !healthResult.harnessResult) {
      process.stderr.write(
        `scaffold_conformance phase=shared_harness result=fail failed_phase=${healthResult.failedPhase || ""} error=${JSON.stringify(healthResult.error || "harness_failed")}\n`,
      );
      return {
        ok: false,
        exitStatus: healthResult.exitStatus || 1,
        healthResult,
      };
    }
    const harnessResult = healthResult.harnessResult;
    process.stdout.write(
      `scaffold_conformance phase=shared_harness result=ok phases=${harnessResult.phases.length}\n`,
    );

    const actualSnapshot = snapshotScaffoldTree({
      factoryRoot: scaffoldResult.factoryRoot,
      factoryId: SCAFFOLD_CONFORMANCE_CONTEXT.factoryId,
      workspaceRoot: tempRoot,
      trackingIssueUrl: SCAFFOLD_CONFORMANCE_CONTEXT.trackingIssueUrl,
    });

    const expectedSnapshot = JSON.parse(readFileSync(effectiveOptions.goldenPath, "utf8"));
    const comparison = compareScaffoldSnapshots(expectedSnapshot, actualSnapshot);

    if (!comparison.ok) {
      process.stderr.write(
        `scaffold_conformance result=diff added=${comparison.addedPaths.length} removed=${comparison.removedPaths.length} changed=${comparison.changedFiles.length} expected_files=${comparison.expectedFileCount} actual_files=${comparison.actualFileCount}\n`,
      );
      process.stderr.write(`${JSON.stringify(comparison)}\n`);
      return {
        ok: false,
        exitStatus: 1,
        comparison,
      };
    }

    process.stdout.write(
      `scaffold_conformance result=ok files=${comparison.actualFileCount} golden=${JSON.stringify(effectiveOptions.goldenPath)}\n`,
    );

    return {
      ok: true,
      exitStatus: 0,
      comparison,
    };
  } finally {
    if (effectiveOptions.keepTemp) {
      process.stdout.write(`scaffold_conformance temp_root=${JSON.stringify(tempRoot)}\n`);
    } else {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await verifyScaffoldedFactoryConformance(options);
  if (!result.ok) {
    process.exit(result.exitStatus || 1);
  }
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
