import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncWorkspaceBins, WORKSPACE_BIN_ENTRIES } from "./sync-workspace-bins.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptsDir, "..");

export const REQUIRED_RUNTIME_DIRS = [
  ["apps", "hatch", "coverage", ".tmp"],
];

export const REQUIRED_ROOT_WORKSPACE_PACKAGE_LINKS = [
  { scope: "@hatch", name: "eslint-config", relativeTarget: ["packages", "eslint-config"] },
  { scope: "@hatch", name: "factory-core", relativeTarget: ["packages", "factory-core"] },
  { scope: "@hatch", name: "factory-ops", relativeTarget: ["packages", "factory-ops"] },
  { scope: "@hatch", name: "github-adapter", relativeTarget: ["packages", "github-adapter"] },
  { scope: "@hatch", name: "tsconfig", relativeTarget: ["packages", "tsconfig"] },
  { scope: "@recallnet", name: "factory-telemetry", relativeTarget: ["packages", "factory-telemetry"] },
];

export const REQUIRED_ROOT_DEPENDENCY_LINKS = [
  // @context:regression !critical Hook-spawned child gates scrub NODE_PATH and
  // NODE_OPTIONS to avoid global-env contamination. Root script deps used by
  // repo-wide audits must therefore be materialized under repo-owned
  // node_modules or strict pre-commit will fail closed only inside hook env.
  { dependency: "acorn", packagePath: [] },
  { dependency: "@recallnet/codecontext-eslint-plugin", packagePath: [] },
  { dependency: "@recallnet/docs-governance-preset", packagePath: [] },
  { dependency: "@typescript-eslint/parser", packagePath: [] },
  { dependency: "eslint", packagePath: [] },
  { dependency: "eslint-plugin-boundaries", packagePath: [] },
  { dependency: "eslint-plugin-import-x", packagePath: [] },
  { dependency: "globals", packagePath: [] },
  { dependency: "sharp", packagePath: [] },
  { dependency: "typescript", packagePath: [] },
  // @context:regression !critical Repo-wide workflow governance gates render
  // diagram assets from fresh worktrees during pre-commit. The root package
  // owns @viz-js/viz, so the bootstrap must materialize its root symlink or
  // worktree commits fail only inside hook-local gate runs.
  { dependency: "@viz-js/viz", packagePath: [] },
  // @context:integration !critical Pi-coding-agent imports Ajv from its own
  // pnpm store path during factory-ops CLI portability runs. Root ESM
  // resolution must materialize a canonical ajv symlink even though the root
  // package does not declare it directly, or hook-local child processes fail
  // with ERR_MODULE_NOT_FOUND only inside the scrubbed hook env.
  { dependency: "ajv", packagePath: [], versionSpec: "^8.18.0" },
  { dependency: "zod", packagePath: [] },
];

export const REQUIRED_RUNTIME_PACKAGE_PATHS = [
  ["apps", "hatch"],
  ["packages", "capability-foreman"],
  ["packages", "factory-core"],
  ["packages", "github-adapter"],
  ["packages", "factory-ops"],
  ["packages", "factory-telemetry"],
];

export function ensureRuntimeDirs(repoRoot = defaultRepoRoot) {
  for (const segments of REQUIRED_RUNTIME_DIRS) {
    mkdirSync(path.resolve(repoRoot, ...segments), { recursive: true });
  }
}

export function ensureCanonicalCheckoutMarker(repoRoot = defaultRepoRoot) {
  const markerPath = path.resolve(repoRoot, ".canonical-checkout");
  if (!existsSync(markerPath)) {
    writeFileSync(markerPath, "This file protects the canonical checkout from accidental deletion.\n");
  }
  if (process.platform === "darwin") {
    try {
      spawnSync("chflags", ["uchg", markerPath], { stdio: "ignore" });
    } catch {}
  }
}

export function ensureRootWorkspacePackageLinks(repoRoot = defaultRepoRoot) {
  for (const entry of REQUIRED_ROOT_WORKSPACE_PACKAGE_LINKS) {
    const targetPath = path.resolve(repoRoot, ...entry.relativeTarget);
    if (!existsSync(targetPath)) continue;

    const scopeDir = path.resolve(repoRoot, "node_modules", entry.scope);
    mkdirSync(scopeDir, { recursive: true });

    const linkPath = path.resolve(scopeDir, entry.name);
    const relativeTarget = path.relative(path.dirname(linkPath), targetPath);

    try {
      const current = lstatSync(linkPath);
      if (current.isSymbolicLink() && readlinkSync(linkPath) === relativeTarget) continue;
      unlinkSync(linkPath);
    } catch {}

    symlinkSync(relativeTarget, linkPath);
  }
}

function ensureSymlink(linkPath, relativeTarget) {
  try {
    const current = lstatSync(linkPath);
    if (current.isSymbolicLink() && symlinkTargetsMatch(linkPath, readlinkSync(linkPath), relativeTarget)) return;
    unlinkSync(linkPath);
  } catch {}

  try {
    symlinkSync(relativeTarget, linkPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      try {
        const current = lstatSync(linkPath);
        if (current.isSymbolicLink() && symlinkTargetsMatch(linkPath, readlinkSync(linkPath), relativeTarget)) return;
        unlinkSync(linkPath);
        symlinkSync(relativeTarget, linkPath);
        return;
      } catch {}
    }
    throw error;
  }
}

function symlinkTargetsMatch(linkPath, currentTarget, expectedTarget) {
  if (currentTarget === expectedTarget) return true;
  try {
    return realpathSync(path.resolve(path.dirname(linkPath), currentTarget))
      === realpathSync(path.resolve(path.dirname(linkPath), expectedTarget));
  } catch {
    return false;
  }
}

function readPackageJson(packageDir) {
  const packageJsonPath = path.resolve(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function escapePnpmPackageName(packageName) {
  return packageName.replaceAll("/", "+");
}

function normalizeDependencyVersionSpec(versionSpec) {
  const normalized = String(versionSpec || "").trim();
  if (!normalized) return "";
  const match = normalized.match(/^[/^~<>=\s]*([0-9]+(?:\.[0-9]+){0,2})/);
  return match ? match[1] : "";
}

function resolveRootDependencyStoreTarget(repoRoot, dependency, versionSpec = "") {
  const pnpmRoot = path.resolve(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmRoot)) return "";
  const expectedSuffix = path.join("node_modules", dependency);
  const expectedPrefix = `${escapePnpmPackageName(dependency)}@`;
  const normalizedVersion = normalizeDependencyVersionSpec(versionSpec);
  const preferredPrefix = normalizedVersion ? `${expectedPrefix}${normalizedVersion}` : "";
  const fallbackCandidates = [];

  for (const entry of readdirSync(pnpmRoot)) {
    if (!entry.startsWith(expectedPrefix)) continue;
    const candidate = path.resolve(pnpmRoot, entry, expectedSuffix);
    if (!existsSync(candidate)) continue;
    if (preferredPrefix && entry.startsWith(preferredPrefix)) return candidate;
    fallbackCandidates.push(candidate);
  }

  return fallbackCandidates[0] || "";
}

function readPackageDependencies(repoRoot, packagePathSegments) {
  const packageJson = readPackageJson(path.resolve(repoRoot, ...packagePathSegments));
  if (!packageJson) return {};
  return {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
}

function collectWorkspacePackageTargets(repoRoot) {
  const workspaceTargets = new Map();
  for (const topLevel of ["apps", "packages"]) {
    const rootDir = path.resolve(repoRoot, topLevel);
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir)) {
      const packageDir = path.resolve(rootDir, entry);
      const packageJsonPath = path.resolve(packageDir, "package.json");
      if (!existsSync(packageJsonPath)) continue;
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        const packageName = String(packageJson.name || "").trim();
        if (packageName) {
          workspaceTargets.set(packageName, packageDir);
        }
      } catch {}
    }
  }
  return workspaceTargets;
}

export function ensureRuntimeDependencyLinks(repoRoot = defaultRepoRoot) {
  const workspaceTargets = collectWorkspacePackageTargets(repoRoot);

  for (const entry of REQUIRED_ROOT_DEPENDENCY_LINKS) {
    const dependencyMap = readPackageDependencies(repoRoot, entry.packagePath);
    const dependencyVersion = entry.versionSpec || dependencyMap[entry.dependency];
    if (!dependencyVersion) continue;
    const rootLinkPath = path.resolve(repoRoot, "node_modules", entry.dependency);
    const targetPath = workspaceTargets.get(entry.dependency) || resolveRootDependencyStoreTarget(repoRoot, entry.dependency, dependencyVersion);
    if (!targetPath) continue;
    mkdirSync(path.dirname(rootLinkPath), { recursive: true });
    ensureSymlink(rootLinkPath, path.relative(path.dirname(rootLinkPath), targetPath));
  }

  for (const packagePath of REQUIRED_RUNTIME_PACKAGE_PATHS) {
    const dependencyMap = readPackageDependencies(repoRoot, packagePath);
    for (const [dependency, dependencyVersion] of Object.entries(dependencyMap)) {
      const targetPath = workspaceTargets.get(dependency) || resolveRootDependencyStoreTarget(repoRoot, dependency, dependencyVersion);
      if (!targetPath) continue;
      const packageLinkPath = path.resolve(repoRoot, ...packagePath, "node_modules", dependency);
      mkdirSync(path.dirname(packageLinkPath), { recursive: true });
      ensureSymlink(packageLinkPath, path.relative(path.dirname(packageLinkPath), targetPath));
    }
  }
}

function normalizePackageBinEntries(packageJson) {
  if (!packageJson || !packageJson.bin) return [];
  if (typeof packageJson.bin === "string") {
    const packageName = String(packageJson.name || "").trim();
    if (!packageName) return [];
    const binaryName = packageName.includes("/") ? packageName.split("/").at(-1) : packageName;
    return binaryName ? [[binaryName, packageJson.bin]] : [];
  }
  return Object.entries(packageJson.bin).filter(([, value]) => typeof value === "string");
}

export function ensureRuntimePackageBins(repoRoot = defaultRepoRoot) {
  const rootDependencyMap = readPackageDependencies(repoRoot, []);
  const rootBinDir = path.resolve(repoRoot, "node_modules", ".bin");
  const workspaceLaunchers = new Set(WORKSPACE_BIN_ENTRIES.map(({ name }) => name));
  for (const dependency of Object.keys(rootDependencyMap)) {
    const packageLinkPath = path.resolve(repoRoot, "node_modules", dependency);
    if (!existsSync(packageLinkPath)) continue;
    const dependencyPackageJson = readPackageJson(packageLinkPath);
    const binEntries = normalizePackageBinEntries(dependencyPackageJson);
    if (binEntries.length === 0) continue;
    mkdirSync(rootBinDir, { recursive: true });
    for (const [binName, relativeBinPath] of binEntries) {
      // @context:regression Keep root launchers owned by syncWorkspaceBins;
      // alternating shell and JavaScript targets races concurrent executions.
      if (workspaceLaunchers.has(binName)) continue;
      const binTarget = path.resolve(packageLinkPath, relativeBinPath);
      if (!existsSync(binTarget)) continue;
      const binLinkPath = path.resolve(rootBinDir, binName);
      ensureSymlink(binLinkPath, path.relative(path.dirname(binLinkPath), binTarget));
    }
  }

  for (const packagePath of REQUIRED_RUNTIME_PACKAGE_PATHS) {
    const packageDir = path.resolve(repoRoot, ...packagePath);
    const dependencyMap = readPackageDependencies(repoRoot, packagePath);
    const binDir = path.resolve(packageDir, "node_modules", ".bin");
    for (const dependency of Object.keys(dependencyMap)) {
      const packageLinkPath = path.resolve(packageDir, "node_modules", dependency);
      if (!existsSync(packageLinkPath)) continue;
      const dependencyPackageJson = readPackageJson(packageLinkPath);
      const binEntries = normalizePackageBinEntries(dependencyPackageJson);
      if (binEntries.length === 0) continue;
      mkdirSync(binDir, { recursive: true });
      for (const [binName, relativeBinPath] of binEntries) {
        const binTarget = path.resolve(packageLinkPath, relativeBinPath);
        if (!existsSync(binTarget)) continue;
        const binLinkPath = path.resolve(binDir, binName);
        ensureSymlink(binLinkPath, path.relative(path.dirname(binLinkPath), binTarget));
      }
    }
  }
}

export function runPostinstallBootstrap(repoRoot = defaultRepoRoot) {
  syncWorkspaceBins(repoRoot);
  ensureRootWorkspacePackageLinks(repoRoot);
  ensureRuntimeDependencyLinks(repoRoot);
  ensureRuntimePackageBins(repoRoot);
  ensureRuntimeDirs(repoRoot);
  ensureCanonicalCheckoutMarker(repoRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostinstallBootstrap();
}
