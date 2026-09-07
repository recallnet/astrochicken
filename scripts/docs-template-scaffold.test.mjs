import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { scaffoldDocFromTemplate } from "./lib/docs-template-framework.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliPath = join(repoRoot, "scripts", "docs-scaffold-from-template.mjs");
const fixturesRoot = join(repoRoot, "scripts", "test", "fixtures", "docs-template-scaffold");
const cases = JSON.parse(readFileSync(join(fixturesRoot, "cases.json"), "utf8"));

const BASE_ARGS = [
  "--owner", "docs-stewards",
  "--status", "active",
  "--last-updated", "2026-03-02",
  "--summary", "Template summary",
  "--tags", "docs,factory,template",
];

test("docs template scaffold list is deterministic and sorted", () => {
  const run = spawnSync("node", [cliPath, "--list"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), ["architecture", "roadmap", "state_machines", "vision"]);
});

test("docs template scaffold renders deterministic output ordering", () => {
  for (const fixtureCase of cases) {
    const expected = readFileSync(resolve(repoRoot, fixtureCase.expectedPath), "utf8");

    const rendered = scaffoldDocFromTemplate({
      cwd: repoRoot,
      templateId: fixtureCase.templateId,
      title: fixtureCase.title,
      owner: "docs-stewards",
      status: "active",
      lastUpdated: "2026-03-02",
      summary: "Template summary",
      tags: "docs,factory,template",
    });
    assert.equal(rendered, expected, `library render mismatch for template ${fixtureCase.templateId}`);

    const cliRun = spawnSync(
      "node",
      [cliPath, "--template", fixtureCase.templateId, "--title", fixtureCase.title, ...BASE_ARGS],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.equal(cliRun.status, 0, `cli render failed for ${fixtureCase.templateId}: ${cliRun.stderr}`);
    assert.equal(cliRun.stdout, expected, `CLI render mismatch for template ${fixtureCase.templateId}`);

    const secondCliRun = spawnSync(
      "node",
      [cliPath, "--template", fixtureCase.templateId, "--title", fixtureCase.title, ...BASE_ARGS],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.equal(secondCliRun.stdout, cliRun.stdout, `CLI output drifted for template ${fixtureCase.templateId}`);
  }
});

test("docs template scaffold writes deterministic output file when --output is provided", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "docs-template-scaffold-"));
  const outputPath = join(tempDir, "scaffolded.md");

  const run = spawnSync(
    "node",
    [
      cliPath,
      "--template",
      "architecture",
      "--title",
      "Architecture Template",
      ...BASE_ARGS,
      "--output",
      outputPath,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    template_id: "architecture",
    output: outputPath,
  });

  const expected = readFileSync(join(fixturesRoot, "expected", "architecture.md"), "utf8");
  const written = readFileSync(outputPath, "utf8");
  assert.equal(written, expected);
});
