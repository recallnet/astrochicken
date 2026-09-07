#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const hatchDistIndex = join(repoRoot, "apps", "hatch", "dist", "index.js");

function usage() {
  return [
    "Usage:",
    "  node scripts/factory-health-check.mjs --factory-root <path> [--repo-root <path>] [--runs-dir <path>] [--skip-build] [--skip-conformance] [--json]",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    factoryRoot: "",
    repoRoot: "",
    runsDir: "",
    skipBuild: false,
    skipConformance: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--factory-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--factory-root requires a path");
      options.factoryRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--repo-root requires a path");
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--runs-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--runs-dir requires a path");
      options.runsDir = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--skip-conformance") {
      options.skipConformance = true;
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

function marker(phase, ok, detail) {
  return `factory_health phase=${phase} result=${ok ? "ok" : "fail"} detail=${JSON.stringify(detail)}`;
}

function emitMarker(line, emitter) {
  if (typeof emitter === "function") {
    emitter(line);
    return;
  }
  process.stderr.write(`${line}\n`);
}

async function loadConformanceHarness() {
  if (!existsSync(hatchDistIndex)) {
    throw new Error(`compiled hatch index not found: ${hatchDistIndex}`);
  }

  const mod = await import(pathToFileURL(hatchDistIndex).href);
  if (typeof mod.runFactoryConformanceHarness !== "function") {
    throw new Error("runFactoryConformanceHarness export missing from hatch dist index");
  }
  return mod.runFactoryConformanceHarness;
}

function runBuildPhase({ emit }) {
  try {
    ensureHatchBuild({ repoRoot });
  } catch (error) {
    const detail = String(error?.message || error).trim();
    emit(marker("build_hatch", false, detail));
    return {
      ok: false,
      phase: "build_hatch",
      detail,
      exitStatus: 1,
    };
  }

  emit(marker("build_hatch", true, "build complete"));
  return {
    ok: true,
    phase: "build_hatch",
    detail: "build complete",
    exitStatus: 0,
  };
}

export async function runFactoryHealthCheck(options = {}) {
  const emit = (line) => emitMarker(line, options.emitMarker);
  const factoryRoot = options.factoryRoot ? resolve(options.factoryRoot) : "";
  const repoRootOverride = options.repoRoot ? resolve(options.repoRoot) : "";
  const runsDirOverride = options.runsDir ? resolve(options.runsDir) : "";
  const skipBuild = Boolean(options.skipBuild);
  const skipConformance = Boolean(options.skipConformance);
  const dotLintStrictWarnings = Boolean(options.dotLintStrictWarnings);
  const commandTimeoutMs = Math.max(1_000, Number(options.commandTimeoutMs || 90_000));
  const smokeTimeoutMs = Math.max(1_000, Number(options.smokeTimeoutMs || 240_000));

  if (!factoryRoot) {
    const detail = "--factory-root is required";
    emit(marker("parse_args", false, detail));
    return {
      ok: false,
      exitStatus: 1,
      failedPhase: "parse_args",
      phases: [],
      error: detail,
      harnessResult: null,
    };
  }

  if (!existsSync(factoryRoot)) {
    const detail = `factory root not found: ${factoryRoot}`;
    emit(marker("parse_args", false, detail));
    return {
      ok: false,
      exitStatus: 1,
      failedPhase: "parse_args",
      phases: [],
      error: detail,
      harnessResult: null,
    };
  }

  const phases = [];

  if (!skipBuild) {
    const buildResult = runBuildPhase({ emit });
    phases.push(buildResult);
    if (!buildResult.ok) {
      return {
        ok: false,
        exitStatus: buildResult.exitStatus || 1,
        failedPhase: "build_hatch",
        phases,
        error: buildResult.detail,
        harnessResult: null,
      };
    }
  } else {
    const skipped = {
      ok: true,
      phase: "build_hatch",
      detail: "skipped (--skip-build)",
      exitStatus: 0,
    };
    phases.push(skipped);
    emit(marker("build_hatch", true, skipped.detail));
  }

  if (skipConformance) {
    const skipped = {
      ok: true,
      phase: "conformance",
      detail: "skipped (--skip-conformance)",
      exitStatus: 0,
    };
    phases.push(skipped);
    emit(marker("conformance", true, skipped.detail));
    return {
      ok: true,
      exitStatus: 0,
      failedPhase: "",
      phases,
      error: "",
      harnessResult: null,
    };
  }

  let runFactoryConformanceHarness;
  try {
    runFactoryConformanceHarness = await loadConformanceHarness();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emit(marker("load_harness", false, detail));
    return {
      ok: false,
      exitStatus: 1,
      failedPhase: "load_harness",
      phases,
      error: detail,
      harnessResult: null,
    };
  }

  const harnessResult = await runFactoryConformanceHarness({
    factoryRoot,
    repoRoot: repoRootOverride || undefined,
    runsDir: runsDirOverride || undefined,
    commandCwd: repoRoot,
    commandTimeoutMs,
    smokeTimeoutMs,
    dotLintStrictWarnings,
    phases: Array.isArray(options.phases) ? options.phases : undefined,
    onPhaseEvent(event) {
      if (event.action !== "result") return;
      const detail = event.error
        ? `${event.error}${Number.isInteger(event.exit_code) ? ` (exit=${event.exit_code})` : ""}`
        : `duration_ms=${Number.isFinite(event.duration_ms) ? Number(event.duration_ms) : 0}`;
      emit(marker(event.phase, Boolean(event.ok), detail));
    },
  });

  phases.push({
    ok: harnessResult.ok,
    phase: "conformance",
    detail: harnessResult.ok ? "conformance complete" : harnessResult.first_failure?.error || "conformance failed",
    exitStatus: harnessResult.ok ? 0 : 1,
  });

  return {
    ok: harnessResult.ok,
    exitStatus: harnessResult.ok ? 0 : 1,
    failedPhase: harnessResult.failed_phase || "",
    phases,
    error: harnessResult.first_failure?.error || "",
    harnessResult,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${marker("parse_args", false, detail)}\n`);
    process.exit(1);
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await runFactoryHealthCheck(options);
  process.stderr.write(`factory_health result=${result.ok ? "ok" : "fail"} failed_phase=${result.failedPhase || ""}\n`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  if (!result.ok) {
    process.exit(result.exitStatus || 1);
  }
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${marker("run", false, detail)}\n`);
    process.exit(1);
  });
}
