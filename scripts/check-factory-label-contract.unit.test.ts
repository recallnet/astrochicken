import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRawLabelUsages,
  validateFactoryLabelReaderWriterPaths,
  validateRawLabelBoundaries,
} from "./check-factory-label-contract.ts";

test("collectRawLabelUsages extracts js and dot label operations", () => {
  const source = [
    'gh(["issue", "edit", "1", "--repo", "r", "--add-label", "ready"]);',
    'prompt="# hatch:no-inline-script-ok\\ngh label create triaged --repo ${gh_repo}"',
  ].join("\n");

  assert.deepEqual(collectRawLabelUsages(source), ["ready", "triaged"]);
});

test("validateRawLabelBoundaries rejects raw label usage outside approved boundary files", () => {
  const result = validateRawLabelBoundaries({
    paths: ["packages/factory-ops/src/commands/not-allowlisted.mjs"],
    readFile: () => 'gh(["issue", "edit", "1", "--repo", "r", "--add-label", "ready"]);',
  });

  assert.equal(result.ok, false);
  assert.match(result.violations[0], /raw_label_boundary_violation/);
});

test("validateRawLabelBoundaries rejects undeclared labels even inside an approved boundary file", () => {
  const result = validateRawLabelBoundaries({
    paths: ["packages/factory-ops/src/commands/goal-queue-ops.ts"],
    readFile: () => 'gh(["issue", "edit", "1", "--repo", "r", "--add-label", "nonexistent-label"]);',
  });

  assert.equal(result.ok, false);
  assert.match(result.violations[0], /undeclared_label_usage/);
});

test("validateFactoryLabelReaderWriterPaths checks declared reader/writer paths", () => {
  const result = validateFactoryLabelReaderWriterPaths({ fileExists: () => false });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /missing_reader_writer_path/);
});
