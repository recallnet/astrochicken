#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const hatchDistIndex = join(repoRoot, "apps", "hatch", "dist", "index.js");

function usage() {
  return [
    "Usage:",
    "  node scripts/run-conformance-harness.mjs --factory-root <path> [--repo-root <path>] [--runs-dir <path>] [--json]",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    factoryRoot: "",
    repoRoot: "",
    runsDir: "",
    json: false,
    help: false,
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

    if (arg === "--runs-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--runs-dir requires a path");
      }
      options.runsDir = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
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

function emitPhaseRun(event) {
  const parts = [
    `factory_conformance phase=${event.phase}`,
    "action=run",
  ];
  if (event.phase_label) parts.push(`label=${JSON.stringify(event.phase_label)}`);
  if (event.command) parts.push(`command=${JSON.stringify(event.command)}`);
  process.stderr.write(`${parts.join(" ")}\n`);
}

function emitPhaseResult(event) {
  const status = event.ok ? "ok" : "fail";
  const duration = Number.isFinite(event.duration_ms) ? Number(event.duration_ms) : 0;
  const parts = [
    `factory_conformance phase=${event.phase}`,
    `result=${status}`,
    `duration_ms=${duration}`,
  ];
  if (event.phase_label) parts.push(`label=${JSON.stringify(event.phase_label)}`);
  if (event.command) parts.push(`command=${JSON.stringify(event.command)}`);
  if (event.error) parts.push(`error=${JSON.stringify(event.error)}`);
  if (Number.isInteger(event.exit_code)) parts.push(`exit=${event.exit_code}`);
  process.stderr.write(`${parts.join(" ")}\n`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!options.factoryRoot) {
    throw new Error("--factory-root is required");
  }

  if (!existsSync(hatchDistIndex)) {
    throw new Error(`compiled hatch index not found: ${hatchDistIndex}`);
  }

  const { runFactoryConformanceHarness } = await import(pathToFileURL(hatchDistIndex).href);
  if (typeof runFactoryConformanceHarness !== "function") {
    throw new Error("runFactoryConformanceHarness export missing from hatch dist index");
  }

  const result = await runFactoryConformanceHarness({
    factoryRoot: options.factoryRoot,
    repoRoot: options.repoRoot || undefined,
    runsDir: options.runsDir || undefined,
    commandCwd: repoRoot,
    onPhaseEvent(event) {
      if (event.action === "run") {
        emitPhaseRun(event);
        return;
      }
      emitPhaseResult(event);
    },
  });

  process.stderr.write(
    `factory_conformance result=${result.ok ? "ok" : "fail"} failed_phase=${result.failed_phase || ""}\n`,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  if (!result.ok) {
    process.exit(1);
  }
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
