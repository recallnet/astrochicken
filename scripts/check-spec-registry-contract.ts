#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY_PATH = "config/testing/spec-registry.json";
const DEFAULT_OWNERSHIP_PATH = "config/testing/subsystem-ownership.json";
const SPEC_REGISTRY_SCHEMA = "hatch.spec-registry.v1";
const REQUIRED_SPEC_HEADINGS = Object.freeze([
  "## Scope",
  "## Inputs",
  "## Outputs",
  "## Required Invariants",
  "## Failure Modes",
  "## Authoritative Configs",
  "## Test Surfaces",
  "## Merge Blockers",
]);

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return { ok: false, values: {} };
  }

  const values = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    values[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }

  return { ok: true, values };
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    registryPath: argValue(argv, "--registry") || DEFAULT_REGISTRY_PATH,
    ownershipPath: argValue(argv, "--ownership") || DEFAULT_OWNERSHIP_PATH,
    json: argv.includes("--json"),
  };
}

export function validateSpecRegistry({ repoRoot, registryPath = DEFAULT_REGISTRY_PATH, ownershipPath = DEFAULT_OWNERSHIP_PATH }) {
  const diagnostics = [];
  const absoluteRegistryPath = resolve(repoRoot, registryPath);
  const absoluteOwnershipPath = resolve(repoRoot, ownershipPath);

  if (!existsSync(absoluteRegistryPath)) {
    return {
      ok: false,
      diagnostics: [`missing spec registry: ${registryPath}`],
      spec_count: 0,
      proof_surface_count: 0,
      owner_count: 0,
    };
  }

  if (!existsSync(absoluteOwnershipPath)) {
    return {
      ok: false,
      diagnostics: [`missing subsystem ownership config: ${ownershipPath}`],
      spec_count: 0,
      proof_surface_count: 0,
      owner_count: 0,
    };
  }

  const registry = readJson(absoluteRegistryPath);
  const ownership = readJson(absoluteOwnershipPath);

  if (!isRecord(registry)) {
    diagnostics.push("spec registry must be a JSON object");
  }
  if (!isRecord(ownership)) {
    diagnostics.push("subsystem ownership config must be a JSON object");
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics,
      spec_count: 0,
      proof_surface_count: 0,
      owner_count: 0,
    };
  }

  if (registry.schema !== SPEC_REGISTRY_SCHEMA) {
    diagnostics.push(`spec-registry schema must be "${SPEC_REGISTRY_SCHEMA}"`);
  }
  if (!Array.isArray(registry.required_owner_ids) || registry.required_owner_ids.length === 0) {
    diagnostics.push("spec-registry required_owner_ids must be a non-empty array");
  }
  if (!Array.isArray(registry.specs) || registry.specs.length === 0) {
    diagnostics.push("spec-registry specs must be a non-empty array");
  }

  const owners = new Map(
    Array.isArray(ownership.owners)
      ? ownership.owners
        .filter((entry) => isRecord(entry) && typeof entry.id === "string")
        .map((entry) => [entry.id, entry])
      : [],
  );

  const seenIds = new Set();
  const coveredOwners = new Set();
  let proofSurfaceCount = 0;

  for (const [index, spec] of (registry.specs || []).entries()) {
    const prefix = `specs[${index}]`;
    if (!isRecord(spec)) {
      diagnostics.push(`${prefix} must be an object`);
      continue;
    }

    for (const field of ["id", "title", "owner_id", "owner_package", "subsystem", "status", "path"]) {
      if (typeof spec[field] !== "string" || spec[field].trim() === "") {
        diagnostics.push(`${prefix}.${field} must be a non-empty string`);
      }
    }

    if (typeof spec.id === "string" && seenIds.has(spec.id)) {
      diagnostics.push(`duplicate spec id: ${spec.id}`);
    }
    if (typeof spec.id === "string") {
      seenIds.add(spec.id);
    }
    if (typeof spec.owner_id === "string" && typeof spec.status === "string" && spec.status === "active") {
      coveredOwners.add(spec.owner_id);
    }

    const owner = owners.get(spec.owner_id);
    if (!owner) {
      diagnostics.push(`${prefix}.owner_id references unknown owner: ${spec.owner_id}`);
    } else {
      if (spec.owner_package !== owner.package) {
        diagnostics.push(`${prefix}.owner_package must match owner package "${owner.package}"`);
      }
      if (spec.subsystem !== owner.subsystem) {
        diagnostics.push(`${prefix}.subsystem must match owner subsystem "${owner.subsystem}"`);
      }
    }

    if (!Array.isArray(spec.authoritative_configs) || spec.authoritative_configs.length === 0) {
      diagnostics.push(`${prefix}.authoritative_configs must be a non-empty array`);
    } else {
      for (const [configIndex, configPath] of spec.authoritative_configs.entries()) {
        if (typeof configPath !== "string" || configPath.trim() === "") {
          diagnostics.push(`${prefix}.authoritative_configs[${configIndex}] must be a non-empty string`);
          continue;
        }
        if (!existsSync(resolve(repoRoot, configPath))) {
          diagnostics.push(`${prefix}.authoritative_configs[${configIndex}] missing path: ${configPath}`);
        }
      }
    }

    if (!Array.isArray(spec.merge_blockers) || spec.merge_blockers.length === 0) {
      diagnostics.push(`${prefix}.merge_blockers must be a non-empty array`);
    } else if (spec.merge_blockers.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      diagnostics.push(`${prefix}.merge_blockers entries must be non-empty strings`);
    }

    if (!Array.isArray(spec.test_surfaces) || spec.test_surfaces.length === 0) {
      diagnostics.push(`${prefix}.test_surfaces must be a non-empty array`);
    } else {
      proofSurfaceCount += spec.test_surfaces.length;
      for (const [surfaceIndex, surface] of spec.test_surfaces.entries()) {
        const surfacePath = `${prefix}.test_surfaces[${surfaceIndex}]`;
        if (!isRecord(surface)) {
          diagnostics.push(`${surfacePath} must be an object`);
          continue;
        }
        if (typeof surface.kind !== "string" || surface.kind.trim() === "") {
          diagnostics.push(`${surfacePath}.kind must be a non-empty string`);
        }
        if (typeof surface.path !== "string" || surface.path.trim() === "") {
          diagnostics.push(`${surfacePath}.path must be a non-empty string`);
          continue;
        }
        if (!existsSync(resolve(repoRoot, surface.path))) {
          diagnostics.push(`${surfacePath}.path missing file: ${surface.path}`);
        }
      }
    }

    if (typeof spec.path === "string" && spec.path.trim() !== "") {
      const absoluteSpecPath = resolve(repoRoot, spec.path);
      if (!existsSync(absoluteSpecPath)) {
        diagnostics.push(`${prefix}.path missing spec file: ${spec.path}`);
        continue;
      }
      const content = readFileSync(absoluteSpecPath, "utf8");
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter.ok) {
        diagnostics.push(`${prefix}.path must start with YAML-style frontmatter`);
      } else {
        for (const [field, expected] of Object.entries({
          id: spec.id,
          title: spec.title,
          owner_package: spec.owner_package,
          subsystem: spec.subsystem,
          status: spec.status,
        })) {
          if (frontmatter.values[field] !== expected) {
            diagnostics.push(`${prefix}.path frontmatter ${field} must equal "${expected}"`);
          }
        }
      }
      for (const heading of REQUIRED_SPEC_HEADINGS) {
        if (!content.includes(heading)) {
          diagnostics.push(`${prefix}.path missing required heading: ${heading}`);
        }
      }
      for (const surface of Array.isArray(spec.test_surfaces) ? spec.test_surfaces : []) {
        if (isRecord(surface) && typeof surface.path === "string" && !content.includes(`- \`${surface.path}\``)) {
          diagnostics.push(`${prefix}.path must list test surface ${surface.path}`);
        }
      }
    }
  }

  for (const [index, ownerId] of (registry.required_owner_ids || []).entries()) {
    if (typeof ownerId !== "string" || ownerId.trim() === "") {
      diagnostics.push(`required_owner_ids[${index}] must be a non-empty string`);
      continue;
    }
    if (!owners.has(ownerId)) {
      diagnostics.push(`required_owner_ids[${index}] references unknown owner: ${ownerId}`);
      continue;
    }
    if (!coveredOwners.has(ownerId)) {
      diagnostics.push(`missing spec coverage for required owner: ${ownerId}`);
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    spec_count: Array.isArray(registry.specs) ? registry.specs.length : 0,
    proof_surface_count: proofSurfaceCount,
    owner_count: owners.size,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[spec_registry_contract] result=${result.ok ? "ok" : "fail"} specs=${result.spec_count} proofs=${result.proof_surface_count} owners=${result.owner_count} errors=${result.diagnostics.length}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateSpecRegistry(options);
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
      spec_count: 0,
      proof_surface_count: 0,
      owner_count: 0,
    });
    process.exit(1);
  }
}
