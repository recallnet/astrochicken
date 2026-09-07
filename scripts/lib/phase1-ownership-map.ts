import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildActiveSurfaceInventory } from "./active-surface-inventory.ts";
import { loadActiveSurfaceManifest } from "./active-surface-manifest.ts";
import { buildPhase1GateReadinessReport } from "./phase1-gate-readiness.ts";

export const PHASE1_OWNERSHIP_MAP_JSON_PATH = "docs/contracts/phase1-ownership-map.json";
export const PHASE1_OWNERSHIP_MAP_MARKDOWN_PATH = "docs/contracts/phase1-ownership-map.md";

const COMMAND_ROOT = "packages/factory-ops/src/commands";

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/");
}

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function defaultPathExists(filePath) {
  return existsSync(filePath);
}

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function readJson(filePath, readFile = defaultReadFile) {
  return JSON.parse(readFile(filePath));
}

function validateMapShape(map, diagnostics) {
  if (!map || typeof map !== "object") {
    diagnostics.push("phase1_ownership_map must be a JSON object");
    return;
  }
  if (map.schema_version !== "phase1_ownership_map/v1") {
    diagnostics.push('phase1_ownership_map.schema_version must be "phase1_ownership_map/v1"');
  }
  if (!Array.isArray(map.active_violation_owners)) {
    diagnostics.push("phase1_ownership_map.active_violation_owners must be an array");
  }
  if (!Array.isArray(map.legacy_deletion_owners)) {
    diagnostics.push("phase1_ownership_map.legacy_deletion_owners must be an array");
  }
}

function validateAssignmentEntries(entries, diagnostics, label, pathExists = defaultPathExists) {
  const files = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      diagnostics.push(`${label} entries must be objects`);
      continue;
    }
    const file = normalizePath(entry.file);
    const ownerId = String(entry.owner_id || "").trim();
    const ownerPath = normalizePath(entry.owner_path);
    if (!file) diagnostics.push(`${label} entry missing file`);
    if (!ownerId) diagnostics.push(`${label} entry ${JSON.stringify(file || "<unknown>")} missing owner_id`);
    if (!ownerPath) {
      diagnostics.push(`${label} entry ${JSON.stringify(file || "<unknown>")} missing owner_path`);
    } else if (!pathExists(ownerPath)) {
      diagnostics.push(`${label} entry ${JSON.stringify(file || "<unknown>")} references missing owner_path ${JSON.stringify(ownerPath)}`);
    }
    if (file) {
      if (files.has(file)) diagnostics.push(`${label} file mapped more than once: ${JSON.stringify(file)}`);
      files.add(file);
    }
  }
}

function buildCommandImportGraph({ files = [], readFile = defaultReadFile } = {}) {
  const graph = new Map();
  for (const file of files.filter((entry) => entry.startsWith(`${COMMAND_ROOT}/`) && (entry.endsWith(".mjs") || entry.endsWith(".ts")))) {
    const content = readFile(file);
    for (const match of content.matchAll(/(?:import|from)\s+["'](\.[^"']+)["']/g)) {
      let importedPath = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
      if (!importedPath.endsWith(".mjs") && !importedPath.endsWith(".ts")) importedPath += ".ts";
      if (!importedPath.startsWith(`${COMMAND_ROOT}/`)) continue;
      if (!graph.has(file)) graph.set(file, new Set());
      graph.get(file).add(importedPath);
    }
  }
  return graph;
}

function buildLegacyBlastRadius({ manifest, activeInventory, readinessReport, files = [], readFile = defaultReadFile } = {}) {
  const activeOwnerFiles = new Set((manifest.command_surfaces.find((entry) => entry.classification === "active_deterministic_owner")?.include) || []);
  const legacyFiles = new Set((manifest.command_surfaces.find((entry) => entry.classification === "legacy_or_deletion_candidate")?.include) || []);
  const seedFiles = sortStrings([
    ...readinessReport.phase1_violation_inventory.command_thinness.violations.map((entry) => entry.file),
    ...activeInventory.active_command_reachable_files.map((entry) => entry.path),
  ].filter((file) => activeOwnerFiles.has(file)));
  const importGraph = buildCommandImportGraph({ files, readFile });
  const queue = [...seedFiles];
  const seen = new Set(queue);
  const reachedBy = new Map();

  while (queue.length > 0) {
    const commandFile = queue.pop();
    for (const imported of importGraph.get(commandFile) || []) {
      if (!seen.has(imported)) {
        seen.add(imported);
        queue.push(imported);
      }
      if (!legacyFiles.has(imported)) continue;
      if (!reachedBy.has(imported)) reachedBy.set(imported, new Set());
      reachedBy.get(imported).add(commandFile);
    }
  }

  return [...reachedBy.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([file, reached]) => ({
    file,
    reached_from: [...reached].sort(),
  }));
}

function currentActiveTargets(readinessReport) {
  return [
    ...readinessReport.phase1_violation_inventory.graph_transport.violations.map((entry) => ({ file: entry.file, surface: "graph_transport" })),
    ...readinessReport.phase1_violation_inventory.runtime_internal_cli.violations.map((entry) => ({ file: entry.file, surface: "runtime_internal_cli" })),
    ...readinessReport.phase1_violation_inventory.command_thinness.violations.map((entry) => ({ file: entry.file, surface: "command_thinness" })),
  ].sort((left, right) => left.file.localeCompare(right.file) || left.surface.localeCompare(right.surface));
}

function summarizeByOwner(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.owner_id, (counts.get(entry.owner_id) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([owner_id, count]) => ({ owner_id, count }));
}

export function buildPhase1OwnershipAudit({
  files = [],
  manifest = loadActiveSurfaceManifest(),
  readFile = defaultReadFile,
  pathExists = defaultPathExists,
  ownershipMap = readJson(PHASE1_OWNERSHIP_MAP_JSON_PATH, readFile),
  readinessReport = null,
  activeInventory = null,
} = {}) {
  const diagnostics = [];
  validateMapShape(ownershipMap, diagnostics);
  validateAssignmentEntries(ownershipMap.active_violation_owners || [], diagnostics, "active_violation_owners", pathExists);
  validateAssignmentEntries(ownershipMap.legacy_deletion_owners || [], diagnostics, "legacy_deletion_owners", pathExists);

  const resolvedReadinessReport = readinessReport || buildPhase1GateReadinessReport({ files, manifest, readFile });
  const resolvedActiveInventory = activeInventory || buildActiveSurfaceInventory({ files, manifest, readFile });
  const activeTargets = currentActiveTargets(resolvedReadinessReport);
  const legacyTargets = buildLegacyBlastRadius({
    manifest,
    activeInventory: resolvedActiveInventory,
    readinessReport: resolvedReadinessReport,
    files,
    readFile,
  });

  const activeMap = new Map((ownershipMap.active_violation_owners || []).map((entry) => [normalizePath(entry.file), entry]));
  for (const target of activeTargets) {
    const entry = activeMap.get(target.file);
    if (!entry) {
      diagnostics.push(`unowned_active_surface_violation file=${JSON.stringify(target.file)} surface=${target.surface}`);
      continue;
    }
    if (entry.surface !== target.surface) {
      diagnostics.push(`active_surface_owner_surface_mismatch file=${JSON.stringify(target.file)} expected=${target.surface} actual=${JSON.stringify(entry.surface)}`);
    }
  }
  for (const entry of ownershipMap.active_violation_owners || []) {
    if (!activeTargets.find((target) => target.file === normalizePath(entry.file))) {
      diagnostics.push(`stale_active_surface_owner_entry file=${JSON.stringify(normalizePath(entry.file))}`);
    }
  }

  const legacyMap = new Map((ownershipMap.legacy_deletion_owners || []).map((entry) => [normalizePath(entry.file), entry]));
  for (const target of legacyTargets) {
    if (!legacyMap.has(target.file)) diagnostics.push(`unowned_legacy_phase1_blast_radius file=${JSON.stringify(target.file)}`);
  }
  for (const entry of ownershipMap.legacy_deletion_owners || []) {
    if (!legacyTargets.find((target) => target.file === normalizePath(entry.file))) {
      diagnostics.push(`stale_legacy_deletion_owner_entry file=${JSON.stringify(normalizePath(entry.file))}`);
    }
  }

  return {
    schema_version: "phase1_ownership_audit/v1",
    ok: diagnostics.length === 0,
    summary: {
      active_targets: activeTargets.length,
      legacy_targets: legacyTargets.length,
      active_owner_partitions: summarizeByOwner(ownershipMap.active_violation_owners || []).length,
      legacy_owner_partitions: summarizeByOwner(ownershipMap.legacy_deletion_owners || []).length,
      diagnostics: diagnostics.length,
    },
    active_targets: activeTargets,
    legacy_targets: legacyTargets,
    active_violation_owners: ownershipMap.active_violation_owners || [],
    legacy_deletion_owners: ownershipMap.legacy_deletion_owners || [],
    diagnostics: sortStrings(diagnostics),
  };
}

export function renderPhase1OwnershipMarkdown(audit) {
  const lines = [
    "---",
    'doc_type: "reference"',
    'owner: "docs-stewards"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Checked-in ownership map and audit for the remaining Phase 1 active-surface backlog."',
    'tags: [architecture, contracts, generated, ownership, phase1, readiness]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Phase 1 Ownership Map",
    "",
    `Schema: \`${audit.schema_version}\``,
    `Active targets: ${audit.summary.active_targets}`,
    `Legacy targets: ${audit.summary.legacy_targets}`,
    `Diagnostics: ${audit.summary.diagnostics}`,
    "",
    "## Active Violation Owners",
    "",
    "| File | Surface | Owner | Owner Path |",
    "| --- | --- | --- | --- |",
  ];

  for (const entry of audit.active_violation_owners) {
    lines.push(`| \`${entry.file}\` | \`${entry.surface}\` | \`${entry.owner_id}\` | \`${entry.owner_path}\` |`);
  }

  lines.push("", "## Legacy Deletion Owners", "", "| File | Owner | Owner Path |", "| --- | --- | --- |");
  for (const entry of audit.legacy_deletion_owners) {
    lines.push(`| \`${entry.file}\` | \`${entry.owner_id}\` | \`${entry.owner_path}\` |`);
  }

  lines.push("", "## Legacy Blast Radius", "", "| Legacy File | Reached From |", "| --- | --- |");
  for (const entry of audit.legacy_targets) {
    lines.push(`| \`${entry.file}\` | \`${entry.reached_from.join(", ")}\` |`);
  }

  lines.push("", "## Diagnostics", "");
  if (audit.diagnostics.length === 0) {
    lines.push("- none");
  } else {
    for (const diagnostic of audit.diagnostics) lines.push(`- ${diagnostic}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function analyzePhase1OwnershipArtifacts({
  files = [],
  manifest = loadActiveSurfaceManifest(),
  readFile = defaultReadFile,
  pathExists = defaultPathExists,
  ownershipMap = readJson(PHASE1_OWNERSHIP_MAP_JSON_PATH, readFile),
  expectedMarkdown = "",
  readinessReport = null,
  activeInventory = null,
} = {}) {
  const audit = buildPhase1OwnershipAudit({
    files,
    manifest,
    readFile,
    pathExists,
    ownershipMap,
    readinessReport,
    activeInventory,
  });
  const rendered_markdown = renderPhase1OwnershipMarkdown(audit);
  const diagnostics = [...audit.diagnostics];
  if (expectedMarkdown && expectedMarkdown !== rendered_markdown) diagnostics.push("phase1_ownership_markdown_drift");
  return {
    schema_version: "phase1_ownership_check/v1",
    ok: diagnostics.length === 0,
    audit,
    rendered_markdown,
    diagnostics: sortStrings(diagnostics),
  };
}

export function loadCheckedInPhase1OwnershipArtifacts({ readFile = defaultReadFile } = {}) {
  return {
    markdown: existsSync(PHASE1_OWNERSHIP_MAP_MARKDOWN_PATH) ? readFile(PHASE1_OWNERSHIP_MAP_MARKDOWN_PATH) : "",
  };
}
