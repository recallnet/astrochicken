#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  ACTIVE_SURFACE_MANIFEST_PATH,
  classifyActiveSurfaceFiles,
  loadActiveSurfaceManifest,
  validateActiveSurfaceManifest,
} from "./lib/active-surface-manifest.ts";

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readPathList(path) {
  if (!path || !existsSync(path)) return [];
  const cwd = process.cwd();
  return readFileSync(path, "utf8")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => existsSync(entry) || existsSync(`${cwd}/${entry}`));
}

function collectTrackedFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => existsSync(entry) || existsSync(`${cwd}/${entry}`));
}

export function analyzeActiveSurfaceManifest({
  manifest = loadActiveSurfaceManifest(),
  files = [],
} = {}) {
  const existingFiles = files.filter((file) => existsSync(file) || existsSync(`${process.cwd()}/${file}`));
  const diagnostics = [
    ...validateActiveSurfaceManifest(manifest),
  ];
  let classification = {
    diagnostics: [],
    candidateFiles: { graphs: 0, runtime: 0, commands: 0 },
  };
  if (diagnostics.length === 0) {
    classification = classifyActiveSurfaceFiles({ manifest, files: existingFiles });
    diagnostics.push(...classification.diagnostics);
  }

  return {
    schema_version: "active_surface_manifest_check/v1",
    manifest_path: ACTIVE_SURFACE_MANIFEST_PATH,
    ok: diagnostics.length === 0,
    checked: classification.candidateFiles.graphs.length
      + classification.candidateFiles.runtime.length
      + classification.candidateFiles.commands.length,
    graph_candidates: classification.candidateFiles.graphs.length,
    runtime_candidates: classification.candidateFiles.runtime.length,
    command_candidates: classification.candidateFiles.commands.length,
    diagnostics,
  };
}

function main() {
  const args = process.argv.slice(2);
  const fileListPath = argValue(args, "--file-list");
  const allTracked = args.includes("--all-tracked");
  const jsonOutput = args.includes("--json");

  if (allTracked && fileListPath) {
    throw new Error("Use only one input mode: --file-list or --all-tracked");
  }

  const files = allTracked ? collectTrackedFiles() : readPathList(fileListPath);
  const result = analyzeActiveSurfaceManifest({ files });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  for (const diagnostic of result.diagnostics) {
    process.stdout.write(`[active-surface-manifest] fail ${diagnostic}\n`);
  }
  process.stdout.write(
    `[active-surface-manifest] result=${result.ok ? "ok" : "fail"} manifest=${JSON.stringify(result.manifest_path)} checked=${result.checked} graph=${result.graph_candidates} runtime=${result.runtime_candidates} command=${result.command_candidates} diagnostics=${result.diagnostics.length}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-active-surface-manifest.ts") || process.argv[1]?.endsWith("check-active-surface-manifest.mjs")) {
  main();
}
