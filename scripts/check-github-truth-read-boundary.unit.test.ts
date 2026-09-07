import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  analyzeGitHubTruthReadBoundary,
  loadGitHubTruthReadAllowlist,
} from "./check-github-truth-read-boundary.ts";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixturesRoot = path.join(repoRoot, "scripts", "test", "fixtures", "github-truth-read-boundary");

function fixturePath(name, ...segments) {
  return path.join(fixturesRoot, name, ...segments);
}

test("github truth-read boundary rejects a new execution-critical violation outside the allowlist", () => {
  const fixtureRoot = fixturePath("invalid-new-violation");
  const allowlist = loadGitHubTruthReadAllowlist();
  const result = analyzeGitHubTruthReadBoundary({
    repoRoot: fixtureRoot,
    files: [
      "packages/factory-ops/src/commands/factory-status.ts",
    ],
    allowlist,
    readFile: (targetPath) => readFileSync(path.resolve(fixtureRoot, targetPath), "utf8"),
  });

  assert.equal(result.ok, false);
  assert.match(
    result.diagnostics.join("\n"),
    /unallowlisted_execution_critical_github_truth_read file="packages\/factory-ops\/src\/commands\/factory-status\.mjs"/,
  );
});

test("github truth-read boundary scans execution-critical lib files", () => {
  const fixtureRoot = fixturePath("invalid-new-violation");
  const allowlist = loadGitHubTruthReadAllowlist();
  const result = analyzeGitHubTruthReadBoundary({
    repoRoot: fixtureRoot,
    files: [
      "packages/factory-ops/src/lib/run-inspection.ts",
    ],
    allowlist,
    readFile: (targetPath) => readFileSync(path.resolve(fixtureRoot, targetPath), "utf8"),
  });

  assert.equal(result.ok, false);
  assert.match(
    result.diagnostics.join("\n"),
    /unallowlisted_execution_critical_github_truth_read file="packages\/factory-ops\/src\/lib\/run-inspection\.mjs"/,
  );
});

test("github truth-read boundary accepts an empty permanent inventory", () => {
  const fixtureRoot = fixturePath("valid");
  const allowlist = loadGitHubTruthReadAllowlist();
  const result = analyzeGitHubTruthReadBoundary({
    repoRoot: fixtureRoot,
    files: [
      "packages/factory-ops/src/commands/non-critical-gh-read.mjs",
      "packages/github-adapter/src/github-adapter.mjs",
    ],
    allowlist,
    readFile: (targetPath) => readFileSync(path.resolve(fixtureRoot, targetPath), "utf8"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.report.summary,
    {
      files_scanned: 1,
      allowlisted_findings: 0,
      unallowlisted_findings: 0,
      stale_allowlist_entries: 0,
    },
  );
  assert.deepEqual(result.report.inventory, []);
});

test("github truth-read boundary treats missing allowlist as the permanent empty state", () => {
  const fixtureRoot = fixturePath("stale-allowlist");
  const allowlist = loadGitHubTruthReadAllowlist();
  const result = analyzeGitHubTruthReadBoundary({
    repoRoot: fixtureRoot,
    files: [
      "packages/factory-ops/src/commands/clean.mjs",
    ],
    allowlist,
    readFile: (targetPath) => readFileSync(path.resolve(fixtureRoot, targetPath), "utf8"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});
