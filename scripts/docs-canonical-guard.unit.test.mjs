import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FORBIDDEN_DOC_FILENAME_CODE,
  FORBIDDEN_DOC_PATH_CODE,
  FORBIDDEN_DOC_STATUS_CODE,
  runCanonicalDocsGuard,
} from "./lib/canonical-docs-guard.ts";

function writeMarkdown(path, { status = "active", title = "Doc" } = {}) {
  writeFileSync(
    path,
    `---\ndoc_type: "reference"\nowner: "docs-stewards"\nstatus: "${status}"\nlast_updated: "2026-03-13"\ntags: [docs]\nsummary: "${title} summary."\n---\n\n# ${title}\n\nBody.\n`,
    "utf8",
  );
}

function createRepoFixture() {
  const repoDir = mkdtempSync(join(tmpdir(), "docs-canonical-guard-"));
  mkdirSync(join(repoDir, "docs"), { recursive: true });
  writeMarkdown(join(repoDir, "docs", "vision.md"), { title: "Vision" });
  return repoDir;
}

test("canonical docs guard rejects forbidden path buckets", () => {
  const repoDir = createRepoFixture();
  mkdirSync(join(repoDir, "docs", "issues"), { recursive: true });
  writeMarkdown(join(repoDir, "docs", "issues", "1234-example.md"), { title: "Issue Mirror" });

  const report = runCanonicalDocsGuard({
    cwd: repoDir,
    docsToCheck: ["docs/vision.md"],
  });

  assert.equal(report.ok, false);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === FORBIDDEN_DOC_PATH_CODE), true);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.path === "docs/issues/1234-example.md"), true);
});

test("canonical docs guard rejects plan/needs/proposal filenames", () => {
  const repoDir = createRepoFixture();
  writeMarkdown(join(repoDir, "docs", "runtime-needs.md"), { title: "Runtime Needs" });

  const report = runCanonicalDocsGuard({
    cwd: repoDir,
    docsToCheck: ["docs/vision.md"],
  });

  assert.equal(report.ok, false);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === FORBIDDEN_DOC_FILENAME_CODE), true);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.path === "docs/runtime-needs.md"), true);
});

test("canonical docs guard rejects draft and archived statuses", () => {
  const repoDir = createRepoFixture();
  writeMarkdown(join(repoDir, "docs", "draft-doc.md"), { status: "draft", title: "Draft Doc" });
  writeMarkdown(join(repoDir, "docs", "archived-doc.md"), { status: "archived", title: "Archived Doc" });

  const report = runCanonicalDocsGuard({
    cwd: repoDir,
    docsToCheck: ["docs/vision.md"],
  });

  assert.equal(report.ok, false);
  assert.equal(report.diagnostics.filter((diagnostic) => diagnostic.code === FORBIDDEN_DOC_STATUS_CODE).length, 2);
});
