import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderFactoryEnvExample, validateFactoryEnvContracts } from "./check-factory-env-contracts.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-factory-env-contracts.ts");
const fixturesRoot = join(scriptsDir, "test", "fixtures", "factory-env-contracts");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

test("renderFactoryEnvExample emits deterministic sections", () => {
  const rendered = renderFactoryEnvExample({
    factoryId: "demo",
    sharedVariables: [
      { name: "HATCH_FACTORY_GITHUB_TOKEN", required: false, secret: true, description: "GitHub auth token.", example: "" },
    ],
    localOnlyVariables: [
      { name: "DEMO_SLACK_WEBHOOK_URL", required: false, secret: true, description: "Slack webhook for demo reports.", example: "" },
    ],
    mergedVariables: [
      { name: "HATCH_FACTORY_GITHUB_TOKEN", required: false, secret: true, description: "GitHub auth token.", example: "" },
      { name: "DEMO_SLACK_WEBHOOK_URL", required: false, secret: true, description: "Slack webhook for demo reports.", example: "" },
    ],
  });

  assert.match(rendered, /^# demo factory environment example/m);
  assert.match(rendered, /^# Shared runtime env$/m);
  assert.match(rendered, /^# Optional · secret$/m);
  assert.match(rendered, /^HATCH_FACTORY_GITHUB_TOKEN=$/m);
  assert.match(rendered, /^# Factory-specific env$/m);
  assert.match(rendered, /^DEMO_SLACK_WEBHOOK_URL=$/m);
});

test("shared GitHub token stays optional for non-isolated factories", () => {
  const result = validateFactoryEnvContracts({ manifestsRoot: process.cwd(), write: false });

  assert.equal(result.ok, true);

  const example = readFileSync(join(process.cwd(), "factories", "brainstorm", ".env.example"), "utf8");
  assert.match(example, /# Optional · secret\n# Optional GitHub auth token override for factories that opt into isolated GitHub auth\.\nHATCH_FACTORY_GITHUB_TOKEN=/);
  assert.doesNotMatch(example, /# Required · secret\n# Optional GitHub auth token override/);
});

test("validateFactoryEnvContracts accepts valid fixture", () => {
  const result = validateFactoryEnvContracts({ manifestsRoot: fixtureRoot("valid") });

  assert.equal(result.ok, true);
  assert.equal(result.factoryCount, 1);
  assert.equal(result.sharedVariableCount, 2);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.telemetry, "[factory-env-contracts] result=ok factory_count=1 shared_variable_count=2");
});

test("validateFactoryEnvContracts ignores hidden checkpoint artifacts", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "factory-env-hidden-artifacts-"));
  const repoRoot = join(tempRoot, "repo");
  cpSync(fixtureRoot("valid"), repoRoot, { recursive: true });
  writeFileSync(
    join(repoRoot, "factories", "demo", ".hatch-checkpoint-demo.json"),
    '{ "ignored_env": "${IGNORED_CHECKPOINT_ENV}" }\n',
  );

  const result = validateFactoryEnvContracts({ manifestsRoot: repoRoot });

  assert.equal(result.diagnostics.some((line) => line.includes("IGNORED_CHECKPOINT_ENV")), false);
});

test("validateFactoryEnvContracts fails when env reference is undeclared", () => {
  const result = validateFactoryEnvContracts({ manifestsRoot: fixtureRoot("invalid-undeclared-reference") });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("undeclared_env_reference") && line.includes("env=MISSING_FACTORY_TOKEN")), true);
});

test("validateFactoryEnvContracts fails when env example is stale", () => {
  const result = validateFactoryEnvContracts({ manifestsRoot: fixtureRoot("invalid-stale-example") });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("stale_example") && line.includes(".env.example")), true);
});

test("validateFactoryEnvContracts fails when env contract file is missing", () => {
  const result = validateFactoryEnvContracts({ manifestsRoot: fixtureRoot("invalid-missing-contract") });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_file") && line.includes("env.contract.json")), true);
});

test("validateFactoryEnvContracts --write regenerates env example deterministically", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "factory-env-contracts-"));
  const repoRoot = join(tempRoot, "repo");
  cpSync(fixtureRoot("invalid-stale-example"), repoRoot, { recursive: true });

  const result = validateFactoryEnvContracts({ manifestsRoot: repoRoot, write: true });
  assert.equal(result.ok, true);

  const examplePath = join(repoRoot, "factories", "demo", ".env.example");
  const expected = readFileSync(join(fixtureRoot("valid"), "factories", "demo", ".env.example"), "utf8");
  assert.equal(readFileSync(examplePath, "utf8"), expected);
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("valid")], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[factory-env-contracts] result=ok factory_count=1 shared_variable_count=2");
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic fail telemetry and diagnostics", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-undeclared-reference")], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /undeclared_env_reference factory=demo env=MISSING_FACTORY_TOKEN/);
  assert.match(run.stderr, /^\[factory-env-contracts\] result=fail diagnostics=\d+ factory_count=1 shared_variable_count=2\n?$/m);
});
