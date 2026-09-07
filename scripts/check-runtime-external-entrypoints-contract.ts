#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "runtime-external-entrypoints-contract";
const DEFAULT_MANIFEST_PATH = "docs/contracts/runtime-release-manifest.json";
const ALLOWED_OWNERSHIP = new Set(["required", "optional", "internal"]);
const KNOWN_OWNERSHIP_EXPECTATIONS = Object.freeze({
  hatch: "required",
  "@hatch/factory-ops": "required",
  "@recallnet/factory-telemetry": "internal",
});

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function pushDiagnostic(diagnostics, { file, field, message }) {
  diagnostics.push(`file=${file} field=${field} message=${message}`);
}

function parsePackageBins(packageJson = {}) {
  if (!packageJson || typeof packageJson !== "object") {
    return new Map();
  }

  if (typeof packageJson.bin === "string") {
    const packageName = trim(packageJson.name);
    if (!packageName) {
      return new Map();
    }
    return new Map([[packageName, trim(packageJson.bin)]]);
  }

  if (!isPlainObject(packageJson.bin)) {
    return new Map();
  }

  return new Map(
    Object.entries(packageJson.bin)
      .map(([name, pathValue]) => [trim(name), trim(pathValue)])
      .filter(([name, pathValue]) => Boolean(name) && Boolean(pathValue)),
  );
}

function normalizeBinEntrypoints(binEntrypoints, diagnostics, file, fieldPrefix) {
  if (!Array.isArray(binEntrypoints)) {
    pushDiagnostic(diagnostics, {
      file,
      field: fieldPrefix,
      message: "binEntrypoints must be an array",
    });
    return [];
  }

  const normalized = [];
  for (let index = 0; index < binEntrypoints.length; index += 1) {
    const entry = binEntrypoints[index];
    const fieldBase = `${fieldPrefix}[${index}]`;

    if (typeof entry === "string") {
      const name = trim(entry);
      if (!name) {
        pushDiagnostic(diagnostics, {
          file,
          field: fieldBase,
          message: "string bin entrypoint must be non-empty",
        });
        continue;
      }
      normalized.push({
        name,
        packageBinPath: "",
        sourcePath: "",
      });
      continue;
    }

    if (!isPlainObject(entry)) {
      pushDiagnostic(diagnostics, {
        file,
        field: fieldBase,
        message: "bin entrypoint must be a string or object",
      });
      continue;
    }

    const name = trim(entry.name);
    if (!name) {
      pushDiagnostic(diagnostics, {
        file,
        field: `${fieldBase}.name`,
        message: "bin entrypoint name is required",
      });
      continue;
    }

    normalized.push({
      name,
      packageBinPath: trim(entry.packageBinPath),
      sourcePath: trim(entry.sourcePath),
    });
  }

  return normalized;
}

function validatePackageEntry({
  entry,
  index,
  manifest,
  manifestPath,
  repoRoot,
  diagnostics,
}) {
  const entryPrefix = `externalSurface.packages[${index}]`;

  if (!isPlainObject(entry)) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: entryPrefix,
      message: "package entry must be an object",
    });
    return null;
  }

  const name = trim(entry.name);
  const version = trim(entry.version);
  const ownership = trim(entry.ownership);
  const packageRepo = trim(entry.packageRepo);

  if (!name) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.name`,
      message: "package name is required",
    });
    return null;
  }

  if (!version) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.version`,
      message: "package version is required",
    });
  }

  if (!ownership) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.ownership`,
      message: "package ownership is required",
    });
  } else if (!ALLOWED_OWNERSHIP.has(ownership)) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.ownership`,
      message: `ownership must be one of ${[...ALLOWED_OWNERSHIP].join("|")}`,
    });
  }

  const expectedOwnership = KNOWN_OWNERSHIP_EXPECTATIONS[name];
  if (expectedOwnership && ownership && ownership !== expectedOwnership) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.ownership`,
      message: `ownership mismatch for ${name}; expected ${expectedOwnership}, received ${ownership}`,
    });
  }

  if (!packageRepo) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.packageRepo`,
      message: "packageRepo is required",
    });
    return null;
  }

  const packageJsonPath = join(repoRoot, packageRepo, "package.json");
  if (!existsSync(packageJsonPath)) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: `${entryPrefix}.packageRepo`,
      message: `package.json missing at ${packageRepo}/package.json`,
    });
    return null;
  }

  let packageJson;
  try {
    packageJson = readJson(packageJsonPath);
  } catch (error) {
    pushDiagnostic(diagnostics, {
      file: packageJsonPath,
      field: "package.json",
      message: `unable to parse package.json (${String(error?.message || error)})`,
    });
    return null;
  }

  const packageName = trim(packageJson.name);
  if (packageName !== name) {
    pushDiagnostic(diagnostics, {
      file: packageJsonPath,
      field: "name",
      message: `manifest package name ${name} does not match package.json name ${packageName || "<empty>"}`,
    });
  }

  const packageVersion = trim(packageJson.version);
  if (version && packageVersion !== version) {
    pushDiagnostic(diagnostics, {
      file: packageJsonPath,
      field: "version",
      message: `manifest version ${version} does not match package.json version ${packageVersion || "<empty>"}`,
    });
  }

  const topLevelManifestVersion = trim(manifest[name]);
  if (!topLevelManifestVersion) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: name,
      message: "top-level package version key missing",
    });
  } else if (version && topLevelManifestVersion !== version) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: name,
      message: `top-level version ${topLevelManifestVersion} does not match externalSurface.packages version ${version}`,
    });
  }

  const packageBins = parsePackageBins(packageJson);
  const normalizedEntrypoints = normalizeBinEntrypoints(
    entry.binEntrypoints,
    diagnostics,
    manifestPath,
    `${entryPrefix}.binEntrypoints`,
  );

  const trackedBinNames = new Set();
  for (const binEntrypoint of normalizedEntrypoints) {
    trackedBinNames.add(binEntrypoint.name);

    const packageBinPath = packageBins.get(binEntrypoint.name);
    if (!packageBinPath) {
      pushDiagnostic(diagnostics, {
        file: packageJsonPath,
        field: `bin.${binEntrypoint.name}`,
        message: `manifest declares bin '${binEntrypoint.name}' that is missing from package.json bin map`,
      });
      continue;
    }

    if (binEntrypoint.packageBinPath && packageBinPath !== binEntrypoint.packageBinPath) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `${entryPrefix}.binEntrypoints.${binEntrypoint.name}.packageBinPath`,
        message: `manifest bin path ${binEntrypoint.packageBinPath} does not match package.json bin path ${packageBinPath}`,
      });
    }

    const resolvedPackageBinPath = join(repoRoot, packageRepo, packageBinPath);
    const hasPackageBinPath = existsSync(resolvedPackageBinPath);

    let hasSourcePath = false;
    if (binEntrypoint.sourcePath) {
      const resolvedSourcePath = join(repoRoot, packageRepo, binEntrypoint.sourcePath);
      hasSourcePath = existsSync(resolvedSourcePath);
      if (!hasSourcePath) {
        pushDiagnostic(diagnostics, {
          file: manifestPath,
          field: `${entryPrefix}.binEntrypoints.${binEntrypoint.name}.sourcePath`,
          message: `source file missing at ${packageRepo}/${binEntrypoint.sourcePath}`,
        });
      }
    }

    if (!hasPackageBinPath && !hasSourcePath) {
      pushDiagnostic(diagnostics, {
        file: packageJsonPath,
        field: `bin.${binEntrypoint.name}`,
        message: `bin file missing at ${packageRepo}/${packageBinPath} and no valid sourcePath fallback declared`,
      });
    }
  }

  if (ownership !== "internal") {
    for (const [binName] of packageBins.entries()) {
      if (trackedBinNames.has(binName)) {
        continue;
      }
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `${entryPrefix}.binEntrypoints`,
        message: `manifest does not track package.json bin '${binName}'`,
      });
    }
  }

  return {
    name,
    ownership,
    binNames: [...trackedBinNames],
  };
}

function validateStableEntrypoints({
  manifest,
  manifestPath,
  packagesByName,
  diagnostics,
}) {
  const supportedCli = Array.isArray(manifest?.supported_entrypoints?.cli)
    ? manifest.supported_entrypoints.cli.map((entry) => trim(entry)).filter(Boolean)
    : [];

  if (supportedCli.length === 0) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: "supported_entrypoints.cli",
      message: "supported_entrypoints.cli must be a non-empty array",
    });
  }

  const stableEntryPoints = manifest?.externalSurface?.stableEntryPoints;
  if (!isPlainObject(stableEntryPoints)) {
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: "externalSurface.stableEntryPoints",
      message: "stableEntryPoints must be an object map",
    });
    return;
  }

  const stableCommands = Object.keys(stableEntryPoints)
    .map((entry) => trim(entry))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));

  for (const command of stableCommands) {
    const stableEntry = stableEntryPoints[command];
    if (!isPlainObject(stableEntry)) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}`,
        message: "stable entrypoint metadata must be an object",
      });
      continue;
    }

    const packageName = trim(stableEntry.packageName);
    const binEntrypoint = trim(stableEntry.binEntrypoint);
    const smokeCheck = trim(stableEntry.smokeCheck);

    if (!packageName) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}.packageName`,
        message: "packageName is required",
      });
      continue;
    }

    const packageEntry = packagesByName.get(packageName);
    if (!packageEntry) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}.packageName`,
        message: `unknown packageName '${packageName}'`,
      });
      continue;
    }

    if (!binEntrypoint) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}.binEntrypoint`,
        message: "binEntrypoint is required",
      });
    } else if (!packageEntry.binNames.includes(binEntrypoint)) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}.binEntrypoint`,
        message: `binEntrypoint '${binEntrypoint}' is not tracked for package '${packageName}'`,
      });
    }

    if (!smokeCheck) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}.smokeCheck`,
        message: "smokeCheck is required",
      });
    }

    if (!supportedCli.includes(command)) {
      pushDiagnostic(diagnostics, {
        file: manifestPath,
        field: `externalSurface.stableEntryPoints.${command}`,
        message: `stable entrypoint command '${command}' missing from supported_entrypoints.cli`,
      });
    }
  }

  for (const command of supportedCli) {
    if (stableCommands.includes(command)) {
      continue;
    }
    pushDiagnostic(diagnostics, {
      file: manifestPath,
      field: "supported_entrypoints.cli",
      message: `supported CLI entrypoint '${command}' missing from externalSurface.stableEntryPoints`,
    });
  }
}

export function validateRuntimeExternalEntrypointsContract({
  repoRoot = process.cwd(),
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedManifestPath = resolve(resolvedRepoRoot, manifestPath);
  const diagnostics = [];

  if (!existsSync(resolvedManifestPath)) {
    pushDiagnostic(diagnostics, {
      file: resolvedManifestPath,
      field: "manifest",
      message: "runtime release manifest not found",
    });
    return {
      ok: false,
      diagnostics,
      telemetry: `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnostics.length} packages=0 stable_entrypoints=0`,
    };
  }

  let manifest;
  try {
    manifest = readJson(resolvedManifestPath);
  } catch (error) {
    pushDiagnostic(diagnostics, {
      file: resolvedManifestPath,
      field: "manifest",
      message: `unable to parse manifest (${String(error?.message || error)})`,
    });
    return {
      ok: false,
      diagnostics,
      telemetry: `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnostics.length} packages=0 stable_entrypoints=0`,
    };
  }

  const packages = Array.isArray(manifest?.externalSurface?.packages)
    ? manifest.externalSurface.packages
    : null;

  if (!packages || packages.length === 0) {
    pushDiagnostic(diagnostics, {
      file: resolvedManifestPath,
      field: "externalSurface.packages",
      message: "externalSurface.packages must be a non-empty array",
    });
  }

  const packagesByName = new Map();
  if (packages) {
    for (let index = 0; index < packages.length; index += 1) {
      const validated = validatePackageEntry({
        entry: packages[index],
        index,
        manifest,
        manifestPath: resolvedManifestPath,
        repoRoot: resolvedRepoRoot,
        diagnostics,
      });

      if (!validated) {
        continue;
      }

      if (packagesByName.has(validated.name)) {
        pushDiagnostic(diagnostics, {
          file: resolvedManifestPath,
          field: "externalSurface.packages",
          message: `duplicate package entry '${validated.name}'`,
        });
        continue;
      }

      packagesByName.set(validated.name, validated);
    }
  }

  validateStableEntrypoints({
    manifest,
    manifestPath: resolvedManifestPath,
    packagesByName,
    diagnostics,
  });

  const stableEntrypointCount = isPlainObject(manifest?.externalSurface?.stableEntryPoints)
    ? Object.keys(manifest.externalSurface.stableEntryPoints).length
    : 0;

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    diagnostics: sortedDiagnostics,
    telemetry: ok
      ? `[${TELEMETRY_PREFIX}] result=ok packages=${packagesByName.size} stable_entrypoints=${stableEntrypointCount}`
      : `[${TELEMETRY_PREFIX}] result=fail diagnostics=${sortedDiagnostics.length} packages=${packagesByName.size} stable_entrypoints=${stableEntrypointCount}`,
  };
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    manifestPath: DEFAULT_MANIFEST_PATH,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--repo-root requires a path");
      }
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--manifest") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--manifest requires a path");
      }
      options.manifestPath = value;
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

function usage() {
  return [
    "Usage:",
    "  node scripts/check-runtime-external-entrypoints-contract.ts [--repo-root <path>] [--manifest <path>]",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateRuntimeExternalEntrypointsContract({
    repoRoot: options.repoRoot,
    manifestPath: options.manifestPath,
  });

  if (result.ok) {
    process.stdout.write(`${result.telemetry}\n`);
    return;
  }

  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`);
  }
  process.stderr.write(`${result.telemetry}\n`);
  process.exitCode = 1;
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.stderr.write(`[${TELEMETRY_PREFIX}] result=fail diagnostics=1 packages=0 stable_entrypoints=0\n`);
    process.exit(1);
  });
}
