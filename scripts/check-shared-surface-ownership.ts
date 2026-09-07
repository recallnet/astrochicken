#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "config/testing/shared-surface-ownership.json";
const TELEMETRY_PREFIX = "shared_surface_ownership";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  return {
    repoRoot: resolve(argValue(argv, "--repo-root") || process.cwd()),
    configPath: argValue(argv, "--config") || DEFAULT_CONFIG_PATH,
    stagedFileList: argValue(argv, "--staged-file-list") || "",
    allTracked: argv.includes("--all-tracked"),
    json: argv.includes("--json"),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(rootPath) {
  const output = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) {
        output.push(absolute);
      }
    }
  }
  return output;
}

function validateConfig(config) {
  const diagnostics = [];
  if (!isRecord(config)) {
    return { diagnostics: ["shared-surface-ownership config must be a JSON object"] };
  }
  if (config.schema !== "hatch.shared-surface-ownership.v1") {
    diagnostics.push('schema must be "hatch.shared-surface-ownership.v1"');
  }
  if (!Array.isArray(config.scan_roots) || config.scan_roots.length === 0) {
    diagnostics.push("scan_roots must be a non-empty array");
  }
  if (!Array.isArray(config.surfaces) || config.surfaces.length === 0) {
    diagnostics.push("surfaces must be a non-empty array");
  }

  const ids = new Set();
  for (const [index, surface] of (config.surfaces || []).entries()) {
    if (!isRecord(surface)) {
      diagnostics.push(`surfaces[${index}] must be an object`);
      continue;
    }
    if (typeof surface.id !== "string" || surface.id.trim() === "") {
      diagnostics.push(`surfaces[${index}].id must be a non-empty string`);
    } else if (ids.has(surface.id)) {
      diagnostics.push(`duplicate surface id: ${surface.id}`);
    } else {
      ids.add(surface.id);
    }
    if (!Array.isArray(surface.owner_prefixes) || surface.owner_prefixes.length === 0) {
      diagnostics.push(`surfaces[${index}].owner_prefixes must be a non-empty array`);
    }
    if (!Array.isArray(surface.detectors) || surface.detectors.length === 0) {
      diagnostics.push(`surfaces[${index}].detectors must be a non-empty array`);
      continue;
    }
    for (const [detectorIndex, detector] of surface.detectors.entries()) {
      if (!isRecord(detector)) {
        diagnostics.push(`surfaces[${index}].detectors[${detectorIndex}] must be an object`);
        continue;
      }
      for (const field of ["id", "message", "regex"]) {
        if (typeof detector[field] !== "string" || detector[field].trim() === "") {
          diagnostics.push(`surfaces[${index}].detectors[${detectorIndex}].${field} must be a non-empty string`);
        }
      }
      try {
        new RegExp(detector.regex, "m");
      } catch {
        diagnostics.push(`surfaces[${index}].detectors[${detectorIndex}].regex must be a valid RegExp`);
      }
    }
  }

  return { diagnostics };
}

function parseNulDelimitedPathList(raw = Buffer.alloc(0)) {
  return String(raw)
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function collectCandidateFiles(repoRoot, config, scopedPaths = null) {
  const files = [];
  const scopeSet = Array.isArray(scopedPaths) && scopedPaths.length > 0
    ? new Set(scopedPaths.map((entry) => entry.replaceAll("\\", "/")))
    : null;
  for (const root of config.scan_roots || []) {
    if (!isRecord(root) || typeof root.path !== "string" || !Array.isArray(root.extensions)) continue;
    const absoluteRoot = resolve(repoRoot, root.path);
    if (!existsSync(absoluteRoot)) continue;
    for (const absoluteFile of listFiles(absoluteRoot)) {
      const relativePath = absoluteFile.slice(repoRoot.length + 1).replaceAll("\\", "/");
      const extension = relativePath.slice(relativePath.lastIndexOf("."));
      if (!(root.extensions || []).includes(extension)) continue;
      if (/\.(?:test|unit|integration|contract)\./.test(relativePath)) continue;
      const ignored = Array.isArray(root.ignore_prefixes)
        ? root.ignore_prefixes.some((prefix) => relativePath.startsWith(prefix))
        : false;
      if (ignored) continue;
      if (scopeSet && !scopeSet.has(relativePath)) continue;
      files.push(relativePath);
    }
  }
  files.sort();
  return files;
}

function compileDetectors(surface) {
  return (surface.detectors || []).map((detector) => ({
    ...detector,
    pattern: new RegExp(detector.regex, "m"),
  }));
}

function resolveScopedPaths({ repoRoot, stagedFileList = "", allTracked = false } = {}) {
  if (allTracked || !stagedFileList) return null;
  const absoluteListPath = resolve(repoRoot, stagedFileList);
  if (!existsSync(absoluteListPath)) return [];
  return parseNulDelimitedPathList(readFileSync(absoluteListPath));
}

export function analyzeSharedSurfaceOwnership({
  repoRoot,
  configPath = DEFAULT_CONFIG_PATH,
  stagedFileList = "",
  allTracked = false,
}) {
  const absoluteRepoRoot = resolve(repoRoot);
  const absoluteConfigPath = resolve(absoluteRepoRoot, configPath);
  if (!existsSync(absoluteConfigPath)) {
    return {
      ok: false,
      diagnostics: [`missing shared surface ownership config: ${configPath}`],
      surface_count: 0,
      file_count: 0,
      violation_count: 0,
    };
  }

  const config = readJson(absoluteConfigPath);
  const shape = validateConfig(config);
  if (shape.diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: shape.diagnostics,
      surface_count: Array.isArray(config.surfaces) ? config.surfaces.length : 0,
      file_count: 0,
      violation_count: 0,
    };
  }

  const scopedPaths = resolveScopedPaths({ repoRoot: absoluteRepoRoot, stagedFileList, allTracked });
  const files = collectCandidateFiles(absoluteRepoRoot, config, scopedPaths);
  const diagnostics = [];

  for (const surface of config.surfaces) {
    const detectors = compileDetectors(surface);
    for (const relativePath of files) {
      if (surface.owner_prefixes.some((prefix) => relativePath.startsWith(prefix))) {
        continue;
      }
      const absolutePath = resolve(absoluteRepoRoot, relativePath);
      const content = readFileSync(absolutePath, "utf8");
      for (const detector of detectors) {
        if (!detector.pattern.test(content)) continue;
        diagnostics.push(
          `shared surface '${surface.id}' violation in ${relativePath}: ${detector.id} (${detector.message})`,
        );
      }
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    surface_count: config.surfaces.length,
    file_count: files.length,
    violation_count: diagnostics.length,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[${TELEMETRY_PREFIX}] result=${result.ok ? "ok" : "fail"} surfaces=${result.surface_count} files=${result.file_count} violations=${result.violation_count}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = analyzeSharedSurfaceOwnership(options);
  emitTelemetry(result);
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
