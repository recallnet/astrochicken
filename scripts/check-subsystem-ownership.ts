#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "config/testing/subsystem-ownership.json";
const TELEMETRY_PREFIX = "subsystem_ownership";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    configPath: argValue(argv, "--config") || DEFAULT_CONFIG_PATH,
    json: argv.includes("--json"),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateOwnershipConfig(config) {
  const diagnostics = [];
  if (!isRecord(config)) {
    return { diagnostics: ["subsystem-ownership config must be a JSON object"] };
  }
  if (config.schema !== "hatch.subsystem-ownership.v1") {
    diagnostics.push('schema must be "hatch.subsystem-ownership.v1"');
  }
  if (!Array.isArray(config.scan_roots) || config.scan_roots.length === 0) {
    diagnostics.push("scan_roots must be a non-empty array");
  }
  if (!Array.isArray(config.owners) || config.owners.length === 0) {
    diagnostics.push("owners must be a non-empty array");
  }
  if (!Array.isArray(config.path_rules) || config.path_rules.length === 0) {
    diagnostics.push("path_rules must be a non-empty array");
  }

  const ownerIds = new Set();
  for (const [index, owner] of (config.owners || []).entries()) {
    if (!isRecord(owner)) {
      diagnostics.push(`owners[${index}] must be an object`);
      continue;
    }
    for (const field of ["id", "package", "subsystem", "description"]) {
      if (typeof owner[field] !== "string" || owner[field].trim() === "") {
        diagnostics.push(`owners[${index}].${field} must be a non-empty string`);
      }
    }
    if (typeof owner.id === "string") {
      if (ownerIds.has(owner.id)) {
        diagnostics.push(`duplicate owner id: ${owner.id}`);
      }
      ownerIds.add(owner.id);
    }
  }

  for (const [index, root] of (config.scan_roots || []).entries()) {
    if (!isRecord(root)) {
      diagnostics.push(`scan_roots[${index}] must be an object`);
      continue;
    }
    if (typeof root.path !== "string" || root.path.trim() === "") {
      diagnostics.push(`scan_roots[${index}].path must be a non-empty string`);
    }
    if (!Array.isArray(root.extensions) || root.extensions.length === 0) {
      diagnostics.push(`scan_roots[${index}].extensions must be a non-empty array`);
    }
  }

  const pathPrefixes = new Set();
  for (const [index, rule] of (config.path_rules || []).entries()) {
    if (!isRecord(rule)) {
      diagnostics.push(`path_rules[${index}] must be an object`);
      continue;
    }
    if (typeof rule.path_prefix !== "string" || rule.path_prefix.trim() === "") {
      diagnostics.push(`path_rules[${index}].path_prefix must be a non-empty string`);
    } else if (pathPrefixes.has(rule.path_prefix)) {
      diagnostics.push(`duplicate path_prefix: ${rule.path_prefix}`);
    } else {
      pathPrefixes.add(rule.path_prefix);
    }
    if (typeof rule.owner_id !== "string" || rule.owner_id.trim() === "") {
      diagnostics.push(`path_rules[${index}].owner_id must be a non-empty string`);
    } else if (!ownerIds.has(rule.owner_id)) {
      diagnostics.push(`path_rules[${index}].owner_id references unknown owner: ${rule.owner_id}`);
    }
  }

  return { diagnostics };
}

function collectCandidateFiles(repoRoot, config) {
  const files = [];
  for (const root of config.scan_roots || []) {
    const absoluteRoot = resolve(repoRoot, root.path);
    if (!existsSync(absoluteRoot)) {
      continue;
    }
    for (const absoluteFile of listFiles(absoluteRoot)) {
      const relativePath = absoluteFile.slice(repoRoot.length + 1).replaceAll("\\", "/");
      const extensionMatch = (root.extensions || []).includes(relativePath.slice(relativePath.lastIndexOf(".")));
      if (!extensionMatch) {
        continue;
      }
      const ignored = Array.isArray(root.ignore_prefixes)
        ? root.ignore_prefixes.some((prefix) => relativePath.startsWith(prefix))
        : false;
      if (ignored) {
        continue;
      }
      files.push(relativePath);
    }
  }
  files.sort();
  return files;
}

export function resolveOwnerId(relativePath, pathRules) {
  const matches = pathRules.filter((rule) => relativePath.startsWith(rule.path_prefix));
  if (matches.length === 0) {
    return { status: "unmapped" };
  }
  const maxLength = Math.max(...matches.map((rule) => rule.path_prefix.length));
  const mostSpecific = matches.filter((rule) => rule.path_prefix.length === maxLength);
  if (mostSpecific.length !== 1) {
    return {
      status: "ambiguous",
      matches: mostSpecific.map((rule) => rule.path_prefix).sort(),
    };
  }
  return {
    status: "ok",
    ownerId: mostSpecific[0].owner_id,
    pathPrefix: mostSpecific[0].path_prefix,
  };
}

export function analyzeSubsystemOwnership({ repoRoot, configPath = DEFAULT_CONFIG_PATH }) {
  const absoluteConfigPath = resolve(repoRoot, configPath);
  if (!existsSync(absoluteConfigPath)) {
    return {
      ok: false,
      diagnostics: [`missing subsystem ownership config: ${configPath}`],
      owner_count: 0,
      rule_count: 0,
      file_count: 0,
      mapped_count: 0,
    };
  }

  const config = readJson(absoluteConfigPath);
  const shape = validateOwnershipConfig(config);
  if (shape.diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: shape.diagnostics,
      owner_count: Array.isArray(config.owners) ? config.owners.length : 0,
      rule_count: Array.isArray(config.path_rules) ? config.path_rules.length : 0,
      file_count: 0,
      mapped_count: 0,
    };
  }

  const files = collectCandidateFiles(repoRoot, config);
  const diagnostics = [];
  let mappedCount = 0;

  for (const relativePath of files) {
    const resolution = resolveOwnerId(relativePath, config.path_rules);
    if (resolution.status === "ok") {
      mappedCount += 1;
      continue;
    }
    if (resolution.status === "ambiguous") {
      diagnostics.push(
        `ambiguous ownership for ${relativePath}: ${resolution.matches.join(", ")}`,
      );
      continue;
    }
    diagnostics.push(`unmapped active code/test path: ${relativePath}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    owner_count: config.owners.length,
    rule_count: config.path_rules.length,
    file_count: files.length,
    mapped_count: mappedCount,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[${TELEMETRY_PREFIX}] result=${result.ok ? "ok" : "fail"} owners=${result.owner_count} rules=${result.rule_count} files=${result.file_count} mapped=${result.mapped_count} errors=${result.diagnostics.length}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = analyzeSubsystemOwnership(options);
  emitTelemetry(result);
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    process.exit(1);
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
    emitTelemetry({
      ok: false,
      diagnostics: [String(error)],
      owner_count: 0,
      rule_count: 0,
      file_count: 0,
      mapped_count: 0,
    });
    process.exit(1);
  }
}
