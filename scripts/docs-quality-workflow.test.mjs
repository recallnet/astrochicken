import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const workflowPath = join(repoRoot, ".github", "workflows", "docs-quality.yml");
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

test("docs quality workflow enforces deterministic docs command sequence with strict failures", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.match(workflow, /^name:\s*Docs Quality\s*$/m);
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}pull_request:\s*$/m);
  assert.match(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /^\s{4}branches:\s*$/m);
  assert.match(workflow, /^\s{6}-\s*main\s*$/m);

  const commands = extractRunCommands(workflow);
  assert.deepEqual(commands, [
    "pnpm install --frozen-lockfile",
    "pnpm docs:check",
    "pnpm docs:state:check",
  ]);

  assert.equal(workflow.includes("continue-on-error: true"), false);

  for (const command of commands) {
    assert.equal(/baseline:refresh|--update-baseline|\|\|\s*true/u.test(command), false);
  }

  const docsCheckScript = String(packageJson?.scripts?.["docs:check"] ?? "");
  assert.match(docsCheckScript, /^pnpm docs:lint\b/);
  assert.match(docsCheckScript, /pnpm docs:state:check\b/);
  assert.match(docsCheckScript, /node scripts\/docs-check-benchmark-queries\.mjs\b/);
  assert.equal(/baseline:refresh|--update-baseline/u.test(docsCheckScript), false);
});

test("docs quality workflow install contract is pnpm lockfile-safe", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const commands = extractRunCommands(workflow);
  const installCommand = commands[0] ?? "";
  assert.equal(installCommand, "pnpm install --frozen-lockfile");
  assert.equal(existsSync(pnpmLockPath), true);
});

test("docs quality workflow cache contract is lockfile-safe", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.equal(/\bcache:\s*"?(pnpm)"?\b/m.test(workflow), true);
  assert.equal(existsSync(pnpmLockPath), true);
  assert.equal(extractRunCommands(workflow)[0], "pnpm install --frozen-lockfile");
});
