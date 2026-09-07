import { existsSync, readFileSync } from "node:fs";

import { buildPhase1OwnershipAudit } from "./phase1-ownership-map.ts";

export const PHASE1_SCOPE_FINALIZATION_JSON_PATH = "docs/contracts/phase1-scope-finalization.json";
export const PHASE1_BURNDOWN_INVENTORY_JSON_PATH = "docs/contracts/phase1-burndown-inventory.json";
export const PHASE1_BURNDOWN_INVENTORY_MARKDOWN_PATH = "docs/contracts/phase1-burndown-inventory.md";

const DETERMINISM_CLASSIFICATIONS = new Set([
  "deterministic_internal_transport",
  "nondeterministic_judgment_path",
  "true_external_boundary",
]);

const GRAPH_ROLES = new Set([
  "real_owner",
  "wrapper_delegator",
]);

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/");
}

function targetKey(file = "", surface = "") {
  return `${normalizePath(file)}::${String(surface || "").trim()}`;
}

function summarizeByOwner(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.owner_id, (counts.get(entry.owner_id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([owner_id, count]) => ({ owner_id, count }));
}

function summarizeBySurface(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.surface, (counts.get(entry.surface) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([surface, count]) => ({ surface, count }));
}

function readJson(filePath, readFile = defaultReadFile) {
  return JSON.parse(readFile(filePath));
}

function validateSourceShape(source, diagnostics) {
  if (!source || typeof source !== "object") {
    diagnostics.push("phase1_scope_finalization must be a JSON object");
    return;
  }
  if (source.schema_version !== "phase1_scope_finalization/v1") {
    diagnostics.push('phase1_scope_finalization.schema_version must be "phase1_scope_finalization/v1"');
  }
  if (source.phase1_target_frozen !== true) {
    diagnostics.push("phase1_scope_finalization.phase1_target_frozen must be true");
  }
  if (typeof source.no_rescope_rule !== "string" || source.no_rescope_rule.trim().length === 0) {
    diagnostics.push("phase1_scope_finalization.no_rescope_rule must be a non-empty string");
  }
  if (!Array.isArray(source.remaining_active_classifications)) {
    diagnostics.push("phase1_scope_finalization.remaining_active_classifications must be an array");
  }
}

function validateClassificationEntries(entries = [], diagnostics) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      diagnostics.push("remaining_active_classifications entries must be objects");
      continue;
    }
    const file = normalizePath(entry.file);
    const surface = String(entry.surface || "").trim();
    const key = targetKey(file, surface);

    if (!file) diagnostics.push("remaining_active_classifications entry missing file");
    if (!surface) diagnostics.push(`remaining_active_classifications entry ${JSON.stringify(file || "<unknown>")} missing surface`);
    if (file && surface && seen.has(key)) diagnostics.push(`remaining_active_classifications target mapped more than once: ${JSON.stringify(key)}`);
    seen.add(key);

    const determinism = String(entry.determinism_classification || "").trim();
    if (!DETERMINISM_CLASSIFICATIONS.has(determinism)) {
      diagnostics.push(`remaining_active_classifications entry ${JSON.stringify(key)} has invalid determinism_classification ${JSON.stringify(determinism)}`);
    }

    const rationale = String(entry.rationale || "").trim();
    if (!rationale) diagnostics.push(`remaining_active_classifications entry ${JSON.stringify(key)} missing rationale`);

    if (surface === "graph_transport") {
      const graphRole = String(entry.graph_role || "").trim();
      if (!GRAPH_ROLES.has(graphRole)) {
        diagnostics.push(`remaining_active_classifications entry ${JSON.stringify(key)} has invalid graph_role ${JSON.stringify(graphRole)}`);
      }
    } else if (Object.hasOwn(entry, "graph_role")) {
      diagnostics.push(`remaining_active_classifications entry ${JSON.stringify(key)} declares graph_role outside graph_transport surface`);
    }
  }
}

export function buildPhase1BurndownAudit({
  files = [],
  readFile = defaultReadFile,
  ownershipAudit = null,
  scopeFinalization = readJson(PHASE1_SCOPE_FINALIZATION_JSON_PATH, readFile),
} = {}) {
  const diagnostics = [];
  validateSourceShape(scopeFinalization, diagnostics);
  validateClassificationEntries(scopeFinalization.remaining_active_classifications || [], diagnostics);

  const resolvedOwnershipAudit = ownershipAudit || buildPhase1OwnershipAudit({ files, readFile });
  if (!resolvedOwnershipAudit.ok) {
    for (const diagnostic of resolvedOwnershipAudit.diagnostics || []) {
      diagnostics.push(`phase1_ownership_prerequisite_failed:${diagnostic}`);
    }
  }

  const ownerLookup = new Map(
    (resolvedOwnershipAudit.active_violation_owners || []).map((entry) => [
      targetKey(entry.file, entry.surface),
      entry,
    ]),
  );
  const targetLookup = new Map(
    (resolvedOwnershipAudit.active_targets || []).map((entry) => [
      targetKey(entry.file, entry.surface),
      entry,
    ]),
  );
  const classificationLookup = new Map(
    (scopeFinalization.remaining_active_classifications || []).map((entry) => [
      targetKey(entry.file, entry.surface),
      entry,
    ]),
  );

  for (const target of resolvedOwnershipAudit.active_targets || []) {
    const key = targetKey(target.file, target.surface);
    if (!classificationLookup.has(key)) {
      diagnostics.push(`unclassified_phase1_active_violation target=${JSON.stringify(key)}`);
      continue;
    }
  }

  for (const entry of scopeFinalization.remaining_active_classifications || []) {
    const key = targetKey(entry.file, entry.surface);
    if (!targetLookup.has(key)) diagnostics.push(`stale_phase1_scope_finalization_entry target=${JSON.stringify(key)}`);
  }

  const phase1_targets = [];
  const out_of_scope_targets = [];

  for (const target of resolvedOwnershipAudit.active_targets || []) {
    const key = targetKey(target.file, target.surface);
    const classification = classificationLookup.get(key);
    if (!classification) continue;

    const owner = ownerLookup.get(key);
    if (!owner) {
      diagnostics.push(`phase1_target_missing_owner_mapping target=${JSON.stringify(key)}`);
      continue;
    }

    const finalized = {
      file: target.file,
      surface: target.surface,
      owner_id: owner.owner_id,
      owner_path: owner.owner_path,
      determinism_classification: classification.determinism_classification,
      rationale: classification.rationale,
    };

    if (target.surface === "graph_transport") {
      finalized.graph_role = classification.graph_role;
    }

    if (classification.determinism_classification === "deterministic_internal_transport") {
      phase1_targets.push(finalized);
    } else {
      out_of_scope_targets.push(finalized);
    }
  }

  return {
    schema_version: "phase1_burndown_audit/v1",
    ok: diagnostics.length === 0,
    no_rescope_rule: String(scopeFinalization.no_rescope_rule || ""),
    phase1_target_frozen: scopeFinalization.phase1_target_frozen === true,
    summary: {
      active_targets: (resolvedOwnershipAudit.active_targets || []).length,
      phase1_targets: phase1_targets.length,
      out_of_scope_targets: out_of_scope_targets.length,
      real_owner_graphs: phase1_targets.filter((entry) => entry.graph_role === "real_owner").length,
      wrapper_delegators: phase1_targets.filter((entry) => entry.graph_role === "wrapper_delegator").length,
      diagnostics: diagnostics.length,
    },
    phase1_targets: [...phase1_targets].sort((left, right) => left.file.localeCompare(right.file) || left.surface.localeCompare(right.surface)),
    out_of_scope_targets: [...out_of_scope_targets].sort((left, right) => left.file.localeCompare(right.file) || left.surface.localeCompare(right.surface)),
    owner_partitions: summarizeByOwner(phase1_targets),
    surface_partitions: summarizeBySurface(phase1_targets),
    diagnostics: sortStrings(diagnostics),
  };
}

export function renderPhase1BurndownMarkdown(audit) {
  const lines = [
    "---",
    'doc_type: "reference"',
    'owner: "docs-stewards"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Locked Phase 1 burn-down inventory derived from checked-in determinism and wrapper-role classifications."',
    'tags: [architecture, burndown, contracts, generated, phase1, scope]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Phase 1 Burn-Down Inventory",
    "",
    `Schema: \`${audit.schema_version}\``,
    `Active targets: ${audit.summary.active_targets}`,
    `Phase 1 targets: ${audit.summary.phase1_targets}`,
    `Out-of-scope targets: ${audit.summary.out_of_scope_targets}`,
    `Diagnostics: ${audit.summary.diagnostics}`,
    "",
    "## No-Rescope Rule",
    "",
    audit.no_rescope_rule,
    "",
    "## Phase 1 Targets",
    "",
    "| File | Surface | Owner | Determinism | Graph Role |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const entry of audit.phase1_targets) {
    lines.push(`| \`${entry.file}\` | \`${entry.surface}\` | \`${entry.owner_id}\` | \`${entry.determinism_classification}\` | \`${entry.graph_role || ""}\` |`);
  }

  lines.push("", "## Owner Partitions", "", "| Owner | Targets |", "| --- | --- |");
  for (const entry of audit.owner_partitions) {
    lines.push(`| \`${entry.owner_id}\` | ${entry.count} |`);
  }

  lines.push("", "## Surface Partitions", "", "| Surface | Targets |", "| --- | --- |");
  for (const entry of audit.surface_partitions) {
    lines.push(`| \`${entry.surface}\` | ${entry.count} |`);
  }

  lines.push("", "## Out-of-Scope Targets", "", "| File | Surface | Determinism |", "| --- | --- | --- |");
  if (audit.out_of_scope_targets.length === 0) {
    lines.push("| _none_ |  |  |");
  } else {
    for (const entry of audit.out_of_scope_targets) {
      lines.push(`| \`${entry.file}\` | \`${entry.surface}\` | \`${entry.determinism_classification}\` |`);
    }
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

export function analyzePhase1BurndownArtifacts({
  files = [],
  readFile = defaultReadFile,
  ownershipAudit = null,
  scopeFinalization = readJson(PHASE1_SCOPE_FINALIZATION_JSON_PATH, readFile),
  expectedJson = "",
  expectedMarkdown = "",
} = {}) {
  const audit = buildPhase1BurndownAudit({
    files,
    readFile,
    ownershipAudit,
    scopeFinalization,
  });
  const renderedJson = stableJson(audit);
  const renderedMarkdown = renderPhase1BurndownMarkdown(audit);
  const diagnostics = [...audit.diagnostics];
  if (expectedJson && expectedJson !== renderedJson) diagnostics.push("phase1_burndown_inventory_json_drift");
  if (expectedMarkdown && expectedMarkdown !== renderedMarkdown) diagnostics.push("phase1_burndown_inventory_markdown_drift");

  return {
    schema_version: "phase1_burndown_check/v1",
    ok: diagnostics.length === 0,
    audit,
    rendered_json: renderedJson,
    rendered_markdown: renderedMarkdown,
    diagnostics: sortStrings(diagnostics),
  };
}

export function loadCheckedInPhase1BurndownArtifacts({ readFile = defaultReadFile } = {}) {
  return {
    json: existsSync(PHASE1_BURNDOWN_INVENTORY_JSON_PATH) ? readFile(PHASE1_BURNDOWN_INVENTORY_JSON_PATH) : "",
    markdown: existsSync(PHASE1_BURNDOWN_INVENTORY_MARKDOWN_PATH) ? readFile(PHASE1_BURNDOWN_INVENTORY_MARKDOWN_PATH) : "",
  };
}
