#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_PACKAGE_TEST_TRIGGERS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "turbo.json",
]);

const REPO_TRIGGER_ROOTS = Object.freeze([
  ".githooks/",
  ".github/workflows/",
  "config/testing/",
  "docs/architecture/pre-commit-gates.md",
  "docs/architecture/test-system-architecture.md",
  "package.json",
  "scripts/",
]);

function parseNulDelimited(text) {
  return String(text || "")
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function pathMatchesPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function workspaceRootForPath(path) {
  const match = String(path || "").match(/^(apps|packages)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : "";
}

function packageJsonPathForWorkspaceRoot(workspaceRoot, repoRoot) {
  return resolve(repoRoot, workspaceRoot, "package.json");
}

export function collectWorkspaceTargets({ repoRoot = process.cwd(), workspaceRoots = [] } = {}) {
  const targets = [];

  for (const workspaceRoot of workspaceRoots) {
    const packageJsonPath = packageJsonPathForWorkspaceRoot(workspaceRoot, repoRoot);
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof packageJson.name !== "string" || packageJson.name.trim() === "") {
      throw new Error(`workspace missing package name: ${packageJsonPath}`);
    }

    targets.push({
      workspaceRoot,
      packageName: packageJson.name,
    });
  }

  return targets.sort((left, right) => left.workspaceRoot.localeCompare(right.workspaceRoot));
}

export function resolvePackageTestPlan(paths, workspaceTargets) {
  const changedPaths = uniqueSorted(paths);
  const hasChangedPaths = changedPaths.length > 0;
  const hasRootPackageTrigger = changedPaths.some((path) => ROOT_PACKAGE_TEST_TRIGGERS.includes(path));

  if (!hasChangedPaths || hasRootPackageTrigger) {
    return {
      runPackageTests: true,
      packageTestMode: "all",
      packageTestFilters: [],
    };
  }

  const changedWorkspaceRoots = uniqueSorted(
    changedPaths
      .map((path) => workspaceRootForPath(path))
      .filter(Boolean),
  );

  const packageTestFilters = changedWorkspaceRoots
    .map((workspaceRoot) => workspaceTargets.find((target) => target.workspaceRoot === workspaceRoot)?.packageName || "")
    .filter(Boolean);

  return {
    runPackageTests: packageTestFilters.length > 0,
    packageTestMode: packageTestFilters.length > 0 ? "changed" : "skip",
    packageTestFilters,
  };
}

export function classifyChangedPaths(paths, { workspaceTargets = [] } = {}) {
  const changedPaths = uniqueSorted(paths);
  const hasChangedPaths = changedPaths.length > 0;
  const runRepoTests = !hasChangedPaths || changedPaths.some((path) => pathMatchesPrefix(path, REPO_TRIGGER_ROOTS));
  const packagePlan = resolvePackageTestPlan(changedPaths, workspaceTargets);

  return {
    changedPaths,
    hasChangedPaths,
    runPackageTests: packagePlan.runPackageTests,
    packageTestMode: packagePlan.packageTestMode,
    packageTestFilters: packagePlan.packageTestFilters,
    runRepoTests,
  };
}

export function collectChangedPaths({ cwd = process.cwd() } = {}) {
  const tracked = parseNulDelimited(
    execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD", "--"], {
      cwd,
      encoding: "utf8",
    }),
  );
  const untracked = parseNulDelimited(
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd,
      encoding: "utf8",
    }),
  );
  return uniqueSorted([...tracked, ...untracked]);
}

function runCommand(command, args, { cwd = process.cwd() } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function discoverWorkspaceRoots({ repoRoot = process.cwd() } = {}) {
  const workspacePackageJsons = parseNulDelimited(
    execFileSync("find", ["apps", "packages", "-maxdepth", "2", "-name", "package.json", "-print0"], {
      cwd: repoRoot,
      encoding: "buffer",
    }),
  );

  return uniqueSorted(
    workspacePackageJsons.map((filePath) => dirname(filePath)),
  );
}

function packageTestCommandForPlan(plan) {
  if (plan.packageTestMode === "all") {
    return {
      command: "pnpm",
      args: ["--silent", "test:packages"],
    };
  }

  return {
    command: "turbo",
    args: [
      "run",
      "test",
      "--output-logs=errors-only",
      ...plan.packageTestFilters.flatMap((packageName) => ["--filter", packageName]),
    ],
  };
}

function main() {
  const changedPaths = collectChangedPaths();
  const workspaceTargets = collectWorkspaceTargets({
    workspaceRoots: discoverWorkspaceRoots(),
  });
  const plan = classifyChangedPaths(changedPaths, { workspaceTargets });

  process.stdout.write(
    `[fast-tests] changed_paths=${plan.changedPaths.length} repo_tests=${plan.runRepoTests} package_tests=${plan.runPackageTests} package_mode=${plan.packageTestMode} package_filters=${plan.packageTestFilters.join(",") || "all"}\n`,
  );

  if (plan.runRepoTests) {
    const exitCode = runCommand("node", ["scripts/run-repo-test-manifest.mjs", "--repo-root", ".", "--suite", "default"]);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } else {
    process.stdout.write("[fast-tests] skip repo_tests reason=no_matching_changed_paths\n");
  }

  if (plan.runPackageTests) {
    const packageCommand = packageTestCommandForPlan(plan);
    const exitCode = runCommand(packageCommand.command, packageCommand.args);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } else {
    process.stdout.write("[fast-tests] skip package_tests reason=no_matching_changed_paths\n");
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
