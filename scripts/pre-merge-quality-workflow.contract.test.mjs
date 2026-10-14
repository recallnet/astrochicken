import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GATE_MANIFEST } from "./lib/gate-manifest.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const workflowPath = join(repoRoot, ".github", "workflows", "pre-merge-quality.yml");
const packageJsonPath = join(repoRoot, "package.json");
const pnpmLockPath = join(repoRoot, "pnpm-lock.yaml");

function extractRunCommands(workflowText) {
  const commands = [];
  const runLinePattern = /^\s*run:\s*(.+)\s*$/gm;

  let match = runLinePattern.exec(workflowText);
  while (match) {
    const cmd = match[1].trim();
    // Skip multiline block indicators (run: |) — those are infrastructure steps, not gate commands
    if (cmd !== "|") commands.push(cmd);
    match = runLinePattern.exec(workflowText);
  }

  return commands;
}

test("pre-merge quality workflow enforces full repo QA before merge", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const qaScript = String(packageJson?.scripts?.["qa:pre-merge"] ?? "");
  const factoryHealthCiScript = String(packageJson?.scripts?.["factory:health:ci"] ?? "");

  assert.match(workflow, /^name:\s*Pre-Merge Quality\s*$/m);
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}push:\s*$/m);

  const commands = extractRunCommands(workflow);
  assert.deepEqual(commands, [
    "pnpm install --frozen-lockfile",
    "pnpm --filter hatch --silent build",
    "pnpm --silent qa:pre-merge",
    "pnpm --silent factory:health:ci -- --strict",
  ]);

  assert.match(
    workflow,
    /- name:\s*Run checked-in factory health\s+env:\s+HATCH_CANONICAL_EVENT_STORE_URL: postgres:\/\/astrochicken:astrochicken@127\.0\.0\.1:55432\/astrochicken_factory\s+NODE_OPTIONS: --experimental-strip-types\s+run:\s*pnpm --silent factory:health:ci -- --strict/m,
  );
  assert.equal((workflow.match(/continue-on-error:\s*true/g) ?? []).length, 0);
  assert.equal(/baseline:refresh|--update-baseline|\|\|\s*true/u.test(workflow), false);

  assert.equal(qaScript, "node scripts/run-gates.mjs --profile full --all-tracked");
  assert.equal(factoryHealthCiScript, "node scripts/run-factory-health-ci.mjs");
});

test("pre-merge quality workflow install contract is pnpm lockfile-safe", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const commands = extractRunCommands(workflow);
  const installCommand = commands[0] ?? "";
  assert.equal(installCommand, "pnpm install --frozen-lockfile");
  assert.equal(existsSync(pnpmLockPath), true);
});

test("gate manifest wires duplication_scan into full profile only", () => {
  const duplicationGate = GATE_MANIFEST.find((gate) => gate.id === "duplication_scan");
  const deadCodeGate = GATE_MANIFEST.find((gate) => gate.id === "dead_code");

  assert.ok(duplicationGate, "Expected duplication_scan gate in GATE_MANIFEST");
  assert.equal(duplicationGate.phase, "quality");
  assert.equal(duplicationGate.command, "pnpm");
  assert.deepEqual(duplicationGate.args, ["--silent", "cpd:ci"]);
  assert.equal(duplicationGate.qualityCategory, "mandatory");
  assert.equal(duplicationGate.profiles.includes("full"), true);
  assert.equal(duplicationGate.profiles.includes("fast"), false);

  assert.ok(deadCodeGate, "Expected dead_code gate in GATE_MANIFEST");
  assert.equal(deadCodeGate.phase, "quality");
  assert.equal(deadCodeGate.command, "pnpm");
  assert.deepEqual(deadCodeGate.args, ["--silent", "knip"]);
  assert.equal(deadCodeGate.qualityCategory, "mandatory");
  assert.equal(deadCodeGate.profiles.includes("fast"), true);
  assert.equal(deadCodeGate.profiles.includes("full"), true);
});

test("strict checked-in factory health has an isolated CI event store", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /image:\s*postgres:18/);
  assert.match(workflow, /HATCH_CANONICAL_EVENT_STORE_URL:\s*postgres:\/\/astrochicken:astrochicken@127\.0\.0\.1:55432\/astrochicken_factory/);
});
