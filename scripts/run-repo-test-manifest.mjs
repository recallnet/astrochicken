#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_TEST_MANIFEST_PATH, validateManifestCollection } from "./check-repo-test-manifest-contract.ts";
import { ensureRuntimeDirs } from "./postinstall-bootstrap.mjs";
import { parseArgs, resolveSuite, resolveSuiteCommand } from "./run-package-test-manifest.mjs";

function loadRepoManifest({ repoRoot, manifestPath }) {
  const result = validateManifestCollection({ repoRoot, manifest: manifestPath });
  if (!result.ok) {
    throw new Error(result.diagnostics.join("\n"));
  }
  const absolutePath = resolve(repoRoot, manifestPath || REPO_TEST_MANIFEST_PATH);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

export function runManifestSuite({ repoRoot, manifestPath, suiteName, extraArgs = [] }) {
  const relativeManifestPath = manifestPath || REPO_TEST_MANIFEST_PATH;
  ensureRuntimeDirs(repoRoot);
  const manifest = loadRepoManifest({ repoRoot, manifestPath: relativeManifestPath });
  const suite = resolveSuite(manifest, suiteName);
  const cwd = resolve(repoRoot, suite.working_directory);
  const command = resolveSuiteCommand(suite, extraArgs);
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const exitCode = runManifestSuite({
    repoRoot: options.repoRoot,
    manifestPath: options.manifest || REPO_TEST_MANIFEST_PATH,
    suiteName: options.suite,
    extraArgs: options.extraArgs,
  });
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
