import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDocsIndexGenerate } from "./docs-index-generate.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdownDoc(path, { status = "active", title = "Doc", body = "Body" } = {}) {
  const reviewPolicy = status === "historical" ? "historical" : "periodic-7";
  writeFileSync(path, `---\ndoc_type: \"architecture\"\nowner: \"docs-stewards\"\nreview_policy: \"${reviewPolicy}\"\nreviewed: \"2026-03-19\"\nstatus: \"${status}\"\ntags: [docs]\nwritten: \"2026-03-09\"\nsummary: \"${title} summary.\"\n---\n\n# ${title}\n\n${body}\n`, "utf8");
}

function writePolicyFiles(repoDir) {
  mkdirSync(join(repoDir, "docs"), { recursive: true });

  writeJson(join(repoDir, "docs", "docs-policy.schema.json"), {
    type: "object",
    properties: {
      "docs_policy/v1": {
        type: "object",
      },
    },
  });

  writeJson(join(repoDir, "docs", "docs-policy.json"), {
    "docs_policy/v1": {
      in_scope_paths: ["docs/**"],
      freshness: {
        default_review_policy: "periodic-7",
        review_policies: [
          { id: "codebound", mode: "codebound" },
          { id: "generated", mode: "generated" },
          { id: "historical", mode: "historical" },
          { id: "periodic-7", mode: "periodic", max_age_days: 7 },
        ],
        path_defaults: [
          { path: "docs/**", review_policy: "periodic-7" },
        ],
      },
      required_doc_types: [],
      ownership: {
        owners: [
          {
            id: "docs-stewards",
            display_name: "Docs Stewards",
          },
        ],
        canonical_roots: [
          {
            path: "docs/",
            owner_id: "docs-stewards",
          },
        ],
        root_doc_owner_id: "docs-stewards",
      },
      root_docs_allowlist: [],
      root_level_exceptions: [],
      migration_debt: {
        allow_missing_required_doc_types: true,
        allow_unowned_in_scope_paths: true,
        legacy_in_scope_allowlist: [],
        max_legacy_in_scope_allowlist_entries: 25,
      },
    },
  });
}

function createTempRepo() {
  const repoDir = mkdtempSync(join(tmpdir(), "docs-index-generate-"));
  writePolicyFiles(repoDir);
  return repoDir;
}

function writeHierarchy(repoDir, sections) {
  writeJson(join(repoDir, "docs", "docs-hierarchy.json"), {
    "docs_hierarchy/v1": {
      sections,
    },
  });
}

function defaultSections() {
  return [
    {
      id: "architecture",
      title: "Architecture",
      path: "docs/architecture/",
    },
    {
      id: "core",
      title: "Core",
      path: "docs/",
      direct_files_only: true,
    },
  ];
}

test("docs index generator produces deterministic INDEX.md for valid hierarchy placement", () => {
  const repoDir = createTempRepo();
  writeHierarchy(repoDir, defaultSections());

  mkdirSync(join(repoDir, "docs", "architecture"), { recursive: true });
  writeMarkdownDoc(join(repoDir, "docs", "architecture", "system.md"), {
    title: "System Architecture",
  });
  writeMarkdownDoc(join(repoDir, "docs", "overview.md"), {
    title: "Overview",
  });

  const report = runDocsIndexGenerate({
    cwd: repoDir,
    includeUntracked: true,
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.diagnostics, []);

  const indexPath = join(repoDir, "docs", "INDEX.md");
  const firstIndex = readFileSync(indexPath, "utf8");
  assert.match(firstIndex, /^# Documentation Index/m);
  assert.match(firstIndex, /^## Architecture/m);
  assert.match(firstIndex, /^## Core/m);
  assert.match(firstIndex, /\[System Architecture\]\(\.\/architecture\/system\.md\)/);
  assert.match(firstIndex, /\[Overview\]\(\.\/overview\.md\)/);

  const rerunReport = runDocsIndexGenerate({
    cwd: repoDir,
    includeUntracked: true,
  });
  assert.equal(rerunReport.ok, true);

  const secondIndex = readFileSync(indexPath, "utf8");
  assert.equal(secondIndex, firstIndex, "INDEX.md should be stable across repeated runs");
});

test("docs index generator fails when a policy-scoped doc is outside declared hierarchy", () => {
  const repoDir = createTempRepo();
  writeHierarchy(repoDir, defaultSections());

  mkdirSync(join(repoDir, "docs", "misc"), { recursive: true });
  writeMarkdownDoc(join(repoDir, "docs", "misc", "outside.md"), {
    title: "Outside",
  });

  const report = runDocsIndexGenerate({
    cwd: repoDir,
    includeUntracked: true,
  });

  assert.equal(report.ok, false);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === "hierarchy.unmapped_doc"), true);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.path === "docs/misc/outside.md"), true);
});

test("docs index generator excludes archived workspace docs from hierarchy enforcement", () => {
  const repoDir = createTempRepo();
  writeHierarchy(repoDir, defaultSections());

  mkdirSync(join(repoDir, "docs", "skills", "factory-design-workspace"), { recursive: true });
  writeMarkdownDoc(join(repoDir, "docs", "skills", "factory-design-workspace", "legacy.md"), {
    title: "Legacy Workspace Notes",
  });

  mkdirSync(join(repoDir, "docs", "archive"), { recursive: true });
  writeMarkdownDoc(join(repoDir, "docs", "archive", "archived.md"), {
    status: "historical",
    title: "Archived Notes",
  });

  const report = runDocsIndexGenerate({
    cwd: repoDir,
    includeUntracked: true,
  });

  assert.equal(report.ok, true);
  assert.equal(report.archived_docs.includes("docs/skills/factory-design-workspace/legacy.md"), true);
  assert.equal(report.archived_docs.includes("docs/archive/archived.md"), true);
  assert.equal(report.diagnostics.length, 0);
});
