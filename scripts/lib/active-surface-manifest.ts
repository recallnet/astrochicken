import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ACTIVE_SURFACE_MANIFEST_PATH = "docs/contracts/active-surface-manifest.json";
export const GRAPH_CLASSIFICATIONS = Object.freeze([
  "active_factory",
  "active_runtime",
  "migratable_template",
  "historical_or_test_only",
]);
export const RUNTIME_CLASSIFICATIONS = Object.freeze([
  "hot_path",
  "execution_path",
  "operator_only",
  "test_only",
]);
export const COMMAND_CLASSIFICATIONS = Object.freeze([
  "active_deterministic_owner",
  "external_operator_cli",
  "operator_support_surface",
  "legacy_or_deletion_candidate",
]);

const SOURCE_FILE_PATTERN = /\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const GRAPH_FILE_PATTERN = /\.dot$/;
const COMMAND_FILE_PATTERN = /^packages\/[^/]+\/src\/(?:commands|cli\/commands)\/.+\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;

const GRAPH_CANDIDATE_PREFIXES = Object.freeze([
  "factories/",
  "packages/",
  "docs/skills/factory-design/templates/",
  "scripts/test/fixtures/",
]);
const RUNTIME_CANDIDATE_PREFIXES = Object.freeze(["apps/", "packages/", "factories/"]);

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function escapeRegExp(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const nextNext = pattern[index + 2];
    if (char === "*" && next === "*" && nextNext === "/") {
      regex += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    regex += escapeRegExp(char);
  }
  regex += "$";
  return new RegExp(regex);
}

function matchesAnyPattern(path, patterns) {
  return normalizeArray(patterns).some((pattern) => globToRegExp(pattern).test(path));
}

function isGraphCandidate(path) {
  return GRAPH_FILE_PATTERN.test(path)
    && GRAPH_CANDIDATE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isCommandCandidate(path) {
  return COMMAND_FILE_PATTERN.test(path);
}

function isRuntimeCandidate(path) {
  return SOURCE_FILE_PATTERN.test(path)
    && RUNTIME_CANDIDATE_PREFIXES.some((prefix) => path.startsWith(prefix))
    && !path.includes("/graphs/")
    && !isCommandCandidate(path);
}

export function listActiveSurfaceCandidateFiles(files = []) {
  const graphs = [];
  const runtime = [];
  const commands = [];

  for (const file of files) {
    if (isGraphCandidate(file)) {
      graphs.push(file);
      continue;
    }
    if (isCommandCandidate(file)) {
      commands.push(file);
      continue;
    }
    if (isRuntimeCandidate(file)) {
      runtime.push(file);
    }
  }

  return {
    graphs: [...new Set(graphs)].sort(),
    runtime: [...new Set(runtime)].sort(),
    commands: [...new Set(commands)].sort(),
  };
}

export function classifyPathWithManifestEntries({ path, entries = [] }) {
  const matches = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const include = normalizeArray(entry.include);
    const exclude = normalizeArray(entry.exclude);
    if (include.length === 0) continue;
    if (!matchesAnyPattern(path, include)) continue;
    if (exclude.length > 0 && matchesAnyPattern(path, exclude)) continue;
    matches.push({
      id: String(entry.id || ""),
      classification: String(entry.classification || ""),
      include,
      exclude,
    });
  }

  return { path, matches };
}

export function allowedClassificationsForSurfaceType(surfaceType = "") {
  if (surfaceType === "graph") return GRAPH_CLASSIFICATIONS;
  if (surfaceType === "runtime") return RUNTIME_CLASSIFICATIONS;
  if (surfaceType === "command") return COMMAND_CLASSIFICATIONS;
  return [];
}

function validateManifestEntries({ manifest, field, label, surfaceType }) {
  const diagnostics = [];
  const allowedClassifications = new Set(allowedClassificationsForSurfaceType(surfaceType));
  if (!Array.isArray(manifest[field]) || manifest[field].length === 0) {
    diagnostics.push(`${field} must be a non-empty array of ${label}`);
    return diagnostics;
  }

  for (const entry of manifest[field]) {
    if (!entry || typeof entry !== "object") {
      diagnostics.push(`${field} entries must be objects`);
      continue;
    }
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      diagnostics.push(`${field} entry is missing a non-empty id`);
    }
    if (typeof entry.classification !== "string" || entry.classification.trim().length === 0) {
      diagnostics.push(`${field} entry ${JSON.stringify(entry.id || "<unknown>")} is missing classification`);
    } else if (!allowedClassifications.has(entry.classification.trim())) {
      diagnostics.push(
        `${field} entry ${JSON.stringify(entry.id || "<unknown>")} uses unknown classification ${JSON.stringify(entry.classification)}; allowed=${[...allowedClassifications].join(",")}`,
      );
    }
    if (!Array.isArray(entry.include) || entry.include.length === 0) {
      diagnostics.push(`${field} entry ${JSON.stringify(entry.id || "<unknown>")} must declare include patterns`);
    }
  }

  return diagnostics;
}

function validateCommandSurfaceRefinement(manifest) {
  const diagnostics = [];
  const commandSurfaces = Array.isArray(manifest?.command_surfaces) ? manifest.command_surfaces : [];
  const coarseOwnerPatterns = new Set([
    "packages/factory-ops/src/commands/**/*.mjs",
  ]);

  for (const entry of commandSurfaces) {
    if (!entry || typeof entry !== "object") continue;
    if (String(entry.classification || "").trim() !== "active_deterministic_owner") continue;
    const include = normalizeArray(entry.include);
    for (const pattern of include) {
      if (coarseOwnerPatterns.has(pattern)) {
        diagnostics.push(
          `command_surfaces entry ${JSON.stringify(entry.id || "<unknown>")} uses coarse active_deterministic_owner pattern ${JSON.stringify(pattern)}; split active owners from operator/support and legacy surfaces explicitly`,
        );
      }
    }
  }

  return diagnostics;
}

export function validateActiveSurfaceManifest(manifest) {
  const diagnostics = [];
  if (!manifest || typeof manifest !== "object") {
    diagnostics.push("manifest must be a JSON object");
    return diagnostics;
  }
  if (manifest.schema_version !== "active_surface_manifest/v1") {
    diagnostics.push('schema_version must be "active_surface_manifest/v1"');
  }
  diagnostics.push(...validateManifestEntries({
    manifest,
    field: "graph_families",
    label: "graph families",
    surfaceType: "graph",
  }));
  diagnostics.push(...validateManifestEntries({
    manifest,
    field: "runtime_surfaces",
    label: "runtime surfaces",
    surfaceType: "runtime",
  }));
  diagnostics.push(...validateManifestEntries({
    manifest,
    field: "command_surfaces",
    label: "command surfaces",
    surfaceType: "command",
  }));
  diagnostics.push(...validateCommandSurfaceRefinement(manifest));
  return diagnostics;
}

function assertValidActiveSurfaceManifest(manifest) {
  const diagnostics = validateActiveSurfaceManifest(manifest);
  if (diagnostics.length > 0) {
    throw new Error(`Invalid active-surface manifest: ${diagnostics.join("; ")}`);
  }
}

export function classifyActiveSurfaceFiles({ manifest, files = [] }) {
  assertValidActiveSurfaceManifest(manifest);
  const candidateFiles = listActiveSurfaceCandidateFiles(files);
  const diagnostics = [];
  const classificationByFile = new Map();
  const definitions = [
    { kind: "graph", files: candidateFiles.graphs, entries: manifest?.graph_families },
    { kind: "runtime", files: candidateFiles.runtime, entries: manifest?.runtime_surfaces },
    { kind: "command", files: candidateFiles.commands, entries: manifest?.command_surfaces },
  ];

  for (const definition of definitions) {
    const entries = Array.isArray(definition.entries) ? definition.entries : [];
    for (const file of definition.files) {
      const result = classifyPathWithManifestEntries({ path: file, entries });
      if (result.matches.length === 0) {
        diagnostics.push(`unclassified_surface kind=${definition.kind} file=${JSON.stringify(file)}`);
        continue;
      }
      if (result.matches.length > 1) {
        diagnostics.push(
          `ambiguous_surface kind=${definition.kind} file=${JSON.stringify(file)} entries=${result.matches.map((entry) => entry.id).join(",")}`,
        );
        continue;
      }
      const match = result.matches[0];
      classificationByFile.set(file, {
        surfaceType: definition.kind,
        entryId: match.id,
        classification: match.classification,
      });
    }
  }

  return {
    candidateFiles,
    diagnostics,
    classificationByFile,
  };
}

export function selectManifestScopedFiles({
  manifest,
  files = [],
  surfaceType,
  classifications = [],
}) {
  const classificationSet = new Set(classifications.map((entry) => String(entry)));
  const { classificationByFile } = classifyActiveSurfaceFiles({ manifest, files });

  return files.filter((file) => {
    const match = classificationByFile.get(file);
    return match?.surfaceType === surfaceType && classificationSet.has(match.classification);
  });
}

export function loadActiveSurfaceManifest({
  repoRoot = process.cwd(),
  manifestPath = ACTIVE_SURFACE_MANIFEST_PATH,
} = {}) {
  const resolvedPath = resolve(repoRoot, manifestPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Missing active-surface manifest at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(resolvedPath, "utf8"));
  assertValidActiveSurfaceManifest(manifest);
  return manifest;
}
