import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkGitHubAdapterBoundary } from "./check-github-adapter-boundary.ts";

test("github adapter boundary gate rejects direct gh transport outside the adapter", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "github-adapter-boundary-"));
  const violatingFile = path.join(repoRoot, "packages", "factory-ops", "src", "commands", "violating.mjs");
  mkdirSync(path.dirname(violatingFile), { recursive: true });
  writeFileSync(
    violatingFile,
    "import { gh } from '../lib/cli-helpers.ts';\nexport function nope() { return gh(['issue','view','1']); }\n",
    "utf8",
  );

  try {
    const result = checkGitHubAdapterBoundary({
      repoRoot,
      files: [violatingFile],
    });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0], /github_transport_forbidden_outside_adapter/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("github adapter boundary gate allows package-owned github-adapter imports", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "github-adapter-boundary-"));
  const allowedFile = path.join(repoRoot, "packages", "factory-ops", "src", "commands", "allowed.mjs");
  mkdirSync(path.dirname(allowedFile), { recursive: true });
  writeFileSync(
    allowedFile,
    "import { createGitHubProjectionTarget } from '@hatch/github-adapter';\nexport function okay() { return createGitHubProjectionTarget; }\n",
    "utf8",
  );

  try {
    const result = checkGitHubAdapterBoundary({
      repoRoot,
      files: [allowedFile],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("github adapter boundary gate rejects files that mix adapter imports with direct gh transport", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "github-adapter-boundary-"));
  const violatingFile = path.join(repoRoot, "packages", "factory-ops", "src", "commands", "mixed.mjs");
  mkdirSync(path.dirname(violatingFile), { recursive: true });
  writeFileSync(
    violatingFile,
    [
      "import { createGitHubProjectionTarget } from '@hatch/github-adapter';",
      "import { gh } from '../lib/cli-helpers.ts';",
      "export function nope() { return [createGitHubProjectionTarget, gh(['issue','view','1'])]; }",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = checkGitHubAdapterBoundary({
      repoRoot,
      files: [violatingFile],
    });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0], /github_transport_forbidden_outside_adapter/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("github adapter boundary gate checks factory-domain packages outside factory-ops", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "github-adapter-boundary-"));
  const violatingFile = path.join(
    repoRoot,
    "packages",
    "capability-release-reporting",
    "src",
    "violating.mjs",
  );
  mkdirSync(path.dirname(violatingFile), { recursive: true });
  writeFileSync(
    violatingFile,
    "import { gh } from '../../../factory-ops/src/lib/cli-helpers.ts';\nexport function nope() { return gh(['issue','view','1']); }\n",
    "utf8",
  );

  try {
    const result = checkGitHubAdapterBoundary({
      repoRoot,
      files: [violatingFile],
    });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0], /github_transport_forbidden_outside_adapter/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
