import assert from "node:assert/strict";
import test from "node:test";

import path from "node:path";

import { ensureNodeOptionsHasHeapHeadroom, filterExistingLintablePaths, resolveRepoOwnedEslintEntrypoint } from "./eslint-gate.mjs";

test("filterExistingLintablePaths ignores deleted staged files before invoking eslint", () => {
  const files = filterExistingLintablePaths([
    "scripts/eslint-gate.mjs",
    "packages/factory-ops/src/commands/goal-build-closure-comment.mjs",
    "README.md",
  ]);

  assert.deepEqual(files, ["scripts/eslint-gate.mjs"]);
});

test("ensureNodeOptionsHasHeapHeadroom adds heap flag when missing", () => {
  assert.equal(ensureNodeOptionsHasHeapHeadroom(""), "--max-old-space-size=4096");
  assert.equal(
    ensureNodeOptionsHasHeapHeadroom("--trace-warnings"),
    "--trace-warnings --max-old-space-size=4096",
  );
});

test("ensureNodeOptionsHasHeapHeadroom preserves explicit heap flag", () => {
  assert.equal(
    ensureNodeOptionsHasHeapHeadroom("--max-old-space-size=3072 --trace-warnings"),
    "--max-old-space-size=3072 --trace-warnings",
  );
  assert.equal(
    ensureNodeOptionsHasHeapHeadroom("--max-old-space-size 3072 --trace-warnings"),
    "--max-old-space-size 3072 --trace-warnings",
  );
});

test("resolveRepoOwnedEslintEntrypoint anchors eslint to repo-owned node_modules", () => {
  assert.equal(
    resolveRepoOwnedEslintEntrypoint("/tmp/repo"),
    path.resolve("/tmp/repo", "node_modules", "eslint", "bin", "eslint.js"),
  );
});
