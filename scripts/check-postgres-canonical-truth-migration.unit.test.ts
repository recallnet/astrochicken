import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MIGRATION_DOC_PATH,
  validatePostgresCanonicalTruthMigration,
} from "./check-postgres-canonical-truth-migration.ts";

const repoRoot = process.cwd();

function buildCommit(number, {
  type = "proof",
  title = `commit ${number}`,
  newOwner = "owner",
  ownerPackages = "packages/factory-ops",
  deletedOwner = "none",
  deleteSurfaces = "none",
  fallbacksRemoved = "none",
  invariantAdded = "invariant",
  proofRun = "fixture proof",
  extraLines = [],
} = {}) {
  return [
    `### Commit ${String(number).padStart(2, "0")}`,
    "",
    `Type: \`${type}\``,
    `Title: \`${title}\``,
    `New Owner: \`${newOwner}\``,
    `Owner Packages: \`${ownerPackages}\``,
    `Deleted Owner: \`${deletedOwner}\``,
    `Delete Surfaces: \`${deleteSurfaces}\``,
    `Fallbacks Removed: \`${fallbacksRemoved}\``,
    `Invariant Added: \`${invariantAdded}\``,
    `Proof Run: \`${proofRun}\``,
    ...extraLines,
  ].join("\n");
}

test("postgres canonical truth migration doc passes validation", () => {
  const markdown = readFileSync(join(repoRoot, MIGRATION_DOC_PATH), "utf8");
  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ok, true);
  assert.equal(result.sections.length, 17);
});

test("validator rejects proof commit that claims a deleted owner", () => {
  const markdown = buildCommit(1, {
    title: "x",
    newOwner: "a",
    deletedOwner: "legacy thing",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /proof but claims Deleted Owner/);
});

test("validator rejects cutover commit with no deleted owner", () => {
  const markdown = buildCommit(1, {
    type: "cutover",
    title: "x",
    newOwner: "a",
    fallbacksRemoved: "all legacy stuff",
    deleteSurfaces: "packages/factory-ops/src/legacy-reader.mjs",
    proofRun: "fixtures + live smoke",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /cutover but has no Deleted Owner/);
});

test("validator rejects cutover commit with no fallbacks removed", () => {
  const markdown = buildCommit(1, {
    type: "cutover",
    title: "x",
    newOwner: "a",
    deletedOwner: "legacy thing",
    deleteSurfaces: "packages/factory-ops/src/legacy-reader.mjs",
    proofRun: "fixtures + live smoke",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /cutover but has no Fallbacks Removed/);
});

test("validator rejects banned words in field values", () => {
  const markdown = buildCommit(1, {
    title: "add temporary compatibility shim",
    newOwner: "a",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /banned word.*"temporary"/);
});

test("validator rejects banned words in acceptance bullets, not just fields", () => {
  const markdown = buildCommit(1, {
    title: "x",
    newOwner: "a",
    extraLines: ["", "Acceptance:", "", "- use a temporary shim here"],
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /contains banned word.*"temporary"/);
});

test("validator rejects legacy commit types from old plan", () => {
  const markdown = buildCommit(1, {
    type: "cutover+grace-delete",
    title: "x",
    newOwner: "a",
    deletedOwner: "b",
    deleteSurfaces: "packages/factory-ops/src/old.mjs",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unsupported Type/);
});

test("validator rejects non-consecutive commit numbers", () => {
  const markdown = [
    buildCommit(1, { title: "x", newOwner: "a" }),
    "",
    buildCommit(3, { title: "y", newOwner: "b" }),
  ].join("\n");

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /consecutive/);
});

test("validator requires live smoke for cutover commits", () => {
  const markdown = buildCommit(1, {
    type: "cutover",
    title: "x",
    newOwner: "a",
    deletedOwner: "legacy thing",
    deleteSurfaces: "packages/factory-ops/src/legacy-reader.mjs",
    fallbacksRemoved: "legacy reader",
    invariantAdded: "gate",
    proofRun: "fixtures only",
  });

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /Proof Run does not include live smoke/);
});

test("validator requires backfill provenance contract in commit 02", () => {
  const markdown = [
    buildCommit(1, {
      title: "foundation",
      newOwner: "a",
    }),
    "",
    buildCommit(2, {
      title: "backfill",
      newOwner: "b",
      proofRun: "failing fixture first + replay proof",
      extraLines: ["", "Acceptance:", "", "- import current state"],
    }),
  ].join("\n");

  const result = validatePostgresCanonicalTruthMigration(markdown);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /must explicitly preserve backfill provenance/);
});

test("validator requires checked-in allowlist contract in commit 11", () => {
  const sections = [];
  for (let index = 1; index <= 11; index += 1) {
    sections.push(buildCommit(index, {
      title: `commit ${index}`,
      newOwner: "a",
      proofRun: index >= 2 ? "failing fixture first + proof" : "proof",
    }));
    if (index === 2) {
      sections.push("");
      sections.push("Acceptance:");
      sections.push("");
      sections.push("- preserve provenance on imported rows");
    }
    if (index === 11) {
      sections.push("");
      sections.push("Acceptance:");
      sections.push("");
      sections.push("- gate is active");
    }
    sections.push("");
  }

  const result = validatePostgresCanonicalTruthMigration(sections.join("\n"));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /must define the checked-in GitHub-read allowlist contract/);
});

test("validator requires explicit delete language in commit 17", () => {
  const sections = [];
  for (let index = 1; index <= 17; index += 1) {
    sections.push(buildCommit(index, {
      type: index >= 6 ? "cutover" : "proof",
      title: `commit ${index}`,
      newOwner: "owner",
      deletedOwner: index >= 6 ? "legacy owner" : "none",
      deleteSurfaces: index >= 6 ? "packages/factory-ops/src/legacy.mjs" : "none",
      fallbacksRemoved: index >= 6 ? "legacy truth path" : "none",
      proofRun: index >= 6 ? "failing fixture first + live smoke" : (index >= 2 ? "failing fixture first + proof" : "proof"),
      extraLines: index === 2
        ? ["", "Acceptance:", "", "- preserve provenance on imported rows", "- TDD: failing fixture first"]
        : index === 11
          ? ["", "Acceptance:", "", "- checked-in allowlist is active", "- TDD: failing violation fixture first"]
          : index === 17
            ? ["", "Acceptance:", "", "- replay suite is active", "- TDD: failing replay fixture first"]
            : index >= 2
              ? ["", "Acceptance:", "", "- TDD: failing fixture first"]
              : [],
    }));
    sections.push("");
  }

  const result = validatePostgresCanonicalTruthMigration(sections.join("\n"));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /Commit 17 must explicitly delete the one-time backfill command/);
});

test("validator accepts a realistic mixed proof and cutover sequence", () => {
  const sections = [];
  for (let index = 1; index <= 17; index += 1) {
    const cutover = [6, 8, 10, 12, 13, 14, 15, 16, 17].includes(index);
    sections.push(buildCommit(index, {
      type: cutover ? "cutover" : "proof",
      title: `commit ${index}`,
      newOwner: `owner ${index}`,
      ownerPackages: cutover ? "packages/factory-ops, packages/github-adapter" : "packages/factory-ops",
      deletedOwner: cutover ? `legacy owner ${index}` : "none",
      deleteSurfaces: cutover ? `packages/factory-ops/src/legacy-${index}.mjs` : "none",
      fallbacksRemoved: cutover ? `legacy truth path ${index}` : "none",
      invariantAdded: `invariant ${index}`,
      proofRun: cutover ? "failing fixture first + parity + live smoke" : (index >= 2 ? "failing fixture first + proof" : "bootstrap proof"),
      extraLines: [
        "",
        "Acceptance:",
        "",
        index === 2 ? "- preserve provenance on imported rows" : "- keep scope package-owned",
        index === 11 ? "- checked-in allowlist is active" : "- package boundaries are explicit",
        index === 17 ? "- deleted one-time backfill command" : "- TDD: failing fixture first",
      ],
    }));
    sections.push("");
  }

  const result = validatePostgresCanonicalTruthMigration(sections.join("\n"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});
