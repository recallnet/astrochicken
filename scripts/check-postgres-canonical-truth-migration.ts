#!/usr/bin/env node

import { readFileSync } from "node:fs";

export const MIGRATION_DOC_PATH = "docs/architecture/postgres-canonical-truth-migration.md";

const ALLOWED_TYPES = new Set(["proof", "cutover"]);
const REQUIRED_FIELDS = [
  "Type",
  "Title",
  "New Owner",
  "Owner Packages",
  "Deleted Owner",
  "Delete Surfaces",
  "Fallbacks Removed",
  "Invariant Added",
  "Proof Run",
];

const BANNED_WORDS = [
  "temporary",
  "for compatibility",
  "legacy fallback",
  "shadow",
  "dual-read",
  "feature flag",
  "grace-delete",
  "unreachable_one_commit_grace",
];

function parseCommitSections(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^### Commit\s+(\d+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = {
        number: Number.parseInt(heading[1], 10),
        fields: new Map(),
        rawLines: [],
      };
      continue;
    }

    if (!current) continue;
    current.rawLines.push(line);
    const field = line.match(/^([A-Za-z][A-Za-z ]+):\s+`?([^`]+?)`?$/);
    if (field) {
      current.fields.set(field[1], field[2]);
    }
  }

  if (current) sections.push(current);
  return sections;
}

export function validatePostgresCanonicalTruthMigration(markdown = "") {
  const diagnostics = [];
  const sections = parseCommitSections(markdown);

  if (sections.length === 0) {
    diagnostics.push("missing commit sections");
    return { ok: false, diagnostics, sections };
  }

  let previousNumber = 0;

  for (const section of sections) {
    const label = `Commit ${String(section.number).padStart(2, "0")}`;

    if (section.number !== previousNumber + 1) {
      diagnostics.push(`commit numbering must be consecutive at ${label}`);
    }
    previousNumber = section.number;

    for (const field of REQUIRED_FIELDS) {
      if (!section.fields.has(field)) {
        diagnostics.push(`${label} missing field ${field}`);
      }
    }

    const type = String(section.fields.get("Type") || "").trim();
    if (type && !ALLOWED_TYPES.has(type)) {
      diagnostics.push(`${label} has unsupported Type ${JSON.stringify(type)}`);
    }

    // proof commits must not claim to delete anything
    const deletedOwner = String(section.fields.get("Deleted Owner") || "").trim();
    const ownerPackages = String(section.fields.get("Owner Packages") || "").trim();
    const deleteSurfaces = String(section.fields.get("Delete Surfaces") || "").trim();
    if (type === "proof" && deletedOwner && deletedOwner !== "none") {
      diagnostics.push(`${label} is proof but claims Deleted Owner ${JSON.stringify(deletedOwner)}`);
    }
    if (!ownerPackages || ownerPackages === "none") {
      diagnostics.push(`${label} must name Owner Packages`);
    }
    if (!ownerPackages.includes("packages/") && !ownerPackages.includes("apps/") && !ownerPackages.includes("docs/")) {
      diagnostics.push(`${label} Owner Packages must name concrete package/app/doc paths`);
    }
    if (type === "proof" && deleteSurfaces && deleteSurfaces !== "none") {
      diagnostics.push(`${label} is proof but claims Delete Surfaces ${JSON.stringify(deleteSurfaces)}`);
    }

    // cutover commits must delete something
    if (type === "cutover" && (!deletedOwner || deletedOwner === "none")) {
      diagnostics.push(`${label} is cutover but has no Deleted Owner`);
    }
    if (type === "cutover" && (!deleteSurfaces || deleteSurfaces === "none")) {
      diagnostics.push(`${label} is cutover but has no Delete Surfaces`);
    }

    // cutover commits must have a non-none Fallbacks Removed
    const fallbacksRemoved = String(section.fields.get("Fallbacks Removed") || "").trim();
    if (type === "cutover" && (!fallbacksRemoved || fallbacksRemoved === "none")) {
      diagnostics.push(`${label} is cutover but has no Fallbacks Removed`);
    }

    const lowerSectionText = section.rawLines.join("\n").toLowerCase();
    for (const banned of BANNED_WORDS) {
      if (lowerSectionText.includes(banned)) {
        diagnostics.push(`${label} contains banned word ${JSON.stringify(banned)} in its ledger entry`);
      }
    }

    const proofRun = String(section.fields.get("Proof Run") || "").trim();
    if (type === "cutover" && !/live smoke/i.test(proofRun)) {
      diagnostics.push(`${label} is cutover but Proof Run does not include live smoke`);
    }

    const invariantAdded = String(section.fields.get("Invariant Added") || "").trim();
    if (type === "cutover" && (!invariantAdded || invariantAdded === "none")) {
      diagnostics.push(`${label} is cutover but has no Invariant Added`);
    }

    if (section.number === 2) {
      const raw = lowerSectionText;
      if (!raw.includes("provenance")) {
        diagnostics.push(`${label} must explicitly preserve backfill provenance`);
      }
    }

    if (section.number === 11) {
      const raw = lowerSectionText;
      if (!raw.includes("allowlist")) {
        diagnostics.push(`${label} must define the checked-in GitHub-read allowlist contract`);
      }
    }

    if (section.number === 17) {
      const raw = lowerSectionText;
      if (!raw.includes("backfill command") || (!raw.includes("delete") && !raw.includes("deleted"))) {
        diagnostics.push(`${label} must explicitly delete the one-time backfill command`);
      }
    }

    if (section.number >= 2 && section.number <= 17) {
      const raw = lowerSectionText;
      if (!raw.includes("tdd") && !raw.includes("failing test first") && !raw.includes("failing fixture first") && !raw.includes("failing gate first")) {
        diagnostics.push(`${label} must explicitly mention TDD or failing-test-first discipline where behavior changes`);
      }
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    sections,
  };
}

function main() {
  const markdown = readFileSync(MIGRATION_DOC_PATH, "utf8");
  const result = validatePostgresCanonicalTruthMigration(markdown);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      console.error(`[postgres_canonical_truth_migration] violation ${JSON.stringify(diagnostic)}`);
    }
    console.error(`[postgres_canonical_truth_migration] result=fail commits=${result.sections.length} violations=${result.diagnostics.length}`);
    process.exit(1);
    return;
  }
  console.log(`[postgres_canonical_truth_migration] result=ok commits=${result.sections.length} violations=0`);
}

const isDirectRun = process.argv[1]?.endsWith("check-postgres-canonical-truth-migration.ts") || process.argv[1]?.endsWith("check-postgres-canonical-truth-migration.mjs") === true;
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
