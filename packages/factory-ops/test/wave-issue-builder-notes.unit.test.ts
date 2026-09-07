import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractBuilderNotes, resolveBuilderNotes } from "../src/commands/wave-issue-builder-notes.ts";
import { writeReviewEvidence } from "../src/commands/wave-issue-state.ts";

test("resolveBuilderNotes extracts optional handoff text from builder output", () => {
  const notes = resolveBuilderNotes({
    builderOutput: [
      "Implemented the scoped fix and verified existing behavior.",
      "",
      "BUILDER_NOTES: Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.",
    ].join("\n"),
  });
  assert.equal(notes, "Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.");
});

test("extractBuilderNotes returns empty string when no marker is present", () => {
  assert.equal(extractBuilderNotes("Implemented scoped fix with no extra note."), "");
});

test("resolveBuilderNotes extracts note text from base64-encoded builder output", () => {
  const encoded = Buffer.from([
    "Implemented the scoped fix and verified existing behavior.",
    "",
    "BUILDER_NOTES: Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.",
  ].join("\n"), "utf8").toString("base64");
  const notes = resolveBuilderNotes({ builderNotesB64: encoded });
  assert.equal(notes, "Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.");
});

test("writeReviewEvidence persists optional builder notes extracted from builder output", () => {
  const wd = join(tmpdir(), `wave-issue-builder-notes-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, "README.md"), "x\n");
  const out = writeReviewEvidence({
    worktreeDir: wd,
    repo: wd,
    issueNumber: "43",
    branch: "wave/43",
    issueTitle: "X",
    issueBody: "Y",
    reviewQaCommand: "true",
    integrationCommand: "true",
    builderOutput: [
      "Implemented the scoped fix and verified existing behavior.",
      "",
      "BUILDER_NOTES: Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.",
    ].join("\n"),
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.builder_notes, "Most of this issue was already satisfied on the shared branch; this pass only aligned the final guard and test.");
});
