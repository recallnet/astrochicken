#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadPackageManifest } from "./check-test-manifest-contract.ts";
import { ensureRuntimeDirs } from "./postinstall-bootstrap.mjs";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  const consumed = new Set();
  const takeValue = (flag) => {
    const index = argv.indexOf(flag);
    if (index >= 0 && index + 1 < argv.length) {
      consumed.add(index);
      consumed.add(index + 1);
      return argv[index + 1];
    }
    return "";
  };

  return {
    repoRoot: takeValue("--repo-root") || process.cwd(),
    manifest: takeValue("--manifest"),
    suite: takeValue("--suite"),
    extraArgs: argv.filter((_, index) => !consumed.has(index)),
  };
}

export function resolveSuite(manifest, suiteName) {
  const targetSuite = suiteName || manifest.default_suite;
  const suite = Array.isArray(manifest.suites)
    ? manifest.suites.find((entry) => entry?.name === targetSuite)
    : null;
  if (!suite) {
    throw new Error(`suite "${targetSuite}" not found in manifest for ${manifest.package_name}`);
  }
  return suite;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function commandStartsWithExecutable(command, executable) {
  const normalized = String(command || "").trim();
  return normalized === executable || normalized.startsWith(`${executable} `);
}

export function resolveSuiteCommand(suite, extraArgs = []) {
  const baseCommand = String(suite?.command || "").trim();
  const commandWithArgs = extraArgs.length > 0
    ? `${baseCommand} ${extraArgs.map(shellQuote).join(" ")}`
    : baseCommand;
  if (suite?.runner === "vitest" && !commandStartsWithExecutable(commandWithArgs, "pnpm")) {
    return `pnpm exec ${commandWithArgs}`;
  }
  return commandWithArgs;
}

export function runManifestSuite({ repoRoot, manifestPath, suiteName, extraArgs = [] }) {
  if (!manifestPath) {
    throw new Error("--manifest is required");
  }
  ensureRuntimeDirs(repoRoot);
  const manifest = loadPackageManifest({ repoRoot, relativePath: manifestPath });
  const suite = resolveSuite(manifest, suiteName);
  const cwd = resolve(repoRoot, suite.working_directory);
  const command = resolveSuiteCommand(suite, extraArgs);
  // Strip live-factory context env vars so that test processes do not inherit
  // path-policy enforcement or context resolution that overrides test fixtures.
  const testEnv = { ...process.env };
  delete testEnv["HATCH_FACTORY_MUTATION_CONTEXT_JSON"];
  delete testEnv["FACTORY_CONTEXT_REPO_PATH"];
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: testEnv,
  });
  return result.status ?? 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const exitCode = runManifestSuite({
    repoRoot: options.repoRoot,
    manifestPath: options.manifest,
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
