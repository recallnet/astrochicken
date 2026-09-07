import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_DOCS_GUARD_CODE,
  FORBIDDEN_DOC_FILENAME_CODE,
  FORBIDDEN_DOC_PATH_CODE,
  FORBIDDEN_DOC_STATUS_CODE,
  runCanonicalDocsGuard,
} from "./lib/canonical-docs-guard.ts";
import {
  formatDocsPolicySummary,
  loadAndValidateDocsPolicy,
} from "./lib/docs-policy-validator.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const fixtureRoot = join(repoRoot, "scripts", "test", "fixtures", "docs-policy");
const cliPath = join(repoRoot, "scripts", "docs-policy-check.mjs");
const canonicalDocsFixturePath = join(fixtureRoot, "canonical-docs", "canonical-docs.json");
const cases = JSON.parse(readFileSync(join(fixtureRoot, "cases.json"), "utf8"));

function runCliForCase(fixtureCase, extraArgs = []) {
  return spawnSync(
    "node",
    [
      cliPath,
      "--schema",
      fixtureCase.schemaPath,
      "--policy",
      fixtureCase.policyPath,
      "--skip-required-doc-path-check",
      ...extraArgs,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

function parseDiagnosticLines(stderr) {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("[docs-policy] diagnostic="))
    .map((line) => JSON.parse(line.slice("[docs-policy] diagnostic=".length)));
}

test("docs policy fixture matrix validates deterministic diagnostics and summary output", () => {
  for (const fixtureCase of cases) {
    const validation = loadAndValidateDocsPolicy({
      cwd: repoRoot,
      schemaPath: fixtureCase.schemaPath,
      policyPath: fixtureCase.policyPath,
      skipRequiredDocPathCheck: true,
    });

    assert.equal(
      validation.ok,
      fixtureCase.expectedOk,
      `unexpected validation status for fixture ${fixtureCase.name}`,
    );
    assert.deepEqual(
      validation.diagnostics,
      fixtureCase.expectedDiagnostics,
      `unexpected diagnostics for fixture ${fixtureCase.name}`,
    );

    const summary = formatDocsPolicySummary(validation);
    assert.match(
      summary,
      fixtureCase.expectedOk
        ? /^\[docs-policy\] result=ok errors=0 version_key="docs_policy\/v1"$/
        : new RegExp(`^\\[docs-policy\\] result=fail errors=${fixtureCase.expectedDiagnostics.length} version_key=\"docs_policy\/v1\"$`),
      `unexpected summary contract for fixture ${fixtureCase.name}`,
    );

    const secondValidation = loadAndValidateDocsPolicy({
      cwd: repoRoot,
      schemaPath: fixtureCase.schemaPath,
      policyPath: fixtureCase.policyPath,
      skipRequiredDocPathCheck: true,
    });
    assert.deepEqual(
      secondValidation.diagnostics,
      validation.diagnostics,
      `diagnostics order drifted between runs for fixture ${fixtureCase.name}`,
    );

    const run = runCliForCase(fixtureCase);
    assert.equal(
      run.status,
      fixtureCase.expectedOk ? 0 : 1,
      `unexpected CLI exit code for fixture ${fixtureCase.name}: ${run.stderr}`,
    );

    const cliDiagnostics = parseDiagnosticLines(run.stderr);
    assert.deepEqual(
      cliDiagnostics,
      fixtureCase.expectedDiagnostics,
      `unexpected CLI diagnostics for fixture ${fixtureCase.name}`,
    );

    const summaryLine = run.stderr
      .split("\n")
      .find((line) => line.startsWith("[docs-policy] result="));

    assert.equal(
      summaryLine,
      summary,
      `CLI summary mismatch for fixture ${fixtureCase.name}`,
    );
  }
});

test("canonical docs guard reports deterministic legacy-reference diagnostics for override docs", () => {
  const fixtureConfig = JSON.parse(readFileSync(canonicalDocsFixturePath, "utf8"));
  const guardReport = runCanonicalDocsGuard({
    cwd: repoRoot,
    docsToCheck: fixtureConfig.docsToCheck,
  });

  assert.equal(guardReport.ok, false);
  assert.deepEqual(guardReport.docsToCheck, fixtureConfig.docsToCheck);
  assert.deepEqual(guardReport.diagnostics, [
    {
      code: CANONICAL_DOCS_GUARD_CODE,
      path: "scripts/test/fixtures/docs-policy/canonical-docs/legacy-commands.md",
      message: "Canonical doc contains legacy reference 'taxi new'. Move legacy command/path references to historical docs and keep canonical docs Hatch/Mothership-first.",
    },
    {
      code: CANONICAL_DOCS_GUARD_CODE,
      path: "scripts/test/fixtures/docs-policy/canonical-docs/legacy-commands.md",
      message: "Canonical doc contains legacy reference 'taxi serve'. Move legacy command/path references to historical docs and keep canonical docs Hatch/Mothership-first.",
    },
    {
      code: CANONICAL_DOCS_GUARD_CODE,
      path: "scripts/test/fixtures/docs-policy/canonical-docs/legacy-paths.md",
      message: "Canonical doc contains legacy reference '.taxi/runs'. Move legacy command/path references to historical docs and keep canonical docs Hatch/Mothership-first.",
    },
    {
      code: CANONICAL_DOCS_GUARD_CODE,
      path: "scripts/test/fixtures/docs-policy/canonical-docs/legacy-paths.md",
      message: "Canonical doc contains legacy reference 'apps/taxi/src'. Move legacy command/path references to historical docs and keep canonical docs Hatch/Mothership-first.",
    },
  ]);

  const run = spawnSync(
    "node",
    [
      cliPath,
      "--skip-required-doc-path-check",
      "--canonical-docs",
      "scripts/test/fixtures/docs-policy/canonical-docs/canonical-docs.json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 1, `expected CLI failure when legacy references are present: ${run.stderr}`);

  const cliDiagnostics = parseDiagnosticLines(run.stderr);
  assert.deepEqual(cliDiagnostics, guardReport.diagnostics);

  const summaryLine = run.stderr
    .split("\n")
    .find((line) => line.startsWith("[docs-policy] result="));

  assert.equal(
    summaryLine,
    "[docs-policy] result=fail errors=4 version_key=\"docs_policy/v1\"",
  );
});

test("canonical docs guard exports deterministic forbidden-doc codes", () => {
  assert.equal(typeof FORBIDDEN_DOC_PATH_CODE, "string");
  assert.equal(typeof FORBIDDEN_DOC_FILENAME_CODE, "string");
  assert.equal(typeof FORBIDDEN_DOC_STATUS_CODE, "string");
});
