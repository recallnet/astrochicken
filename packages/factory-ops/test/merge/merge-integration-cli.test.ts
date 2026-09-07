import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function runCli(args) {
  return spawnSync("node", [opsCliPath, ...args], { cwd: repoRoot, encoding: "utf8" });
}

test("merge run-integration no-op path is deterministic and successful", () => {
  const run = runCli(["merge", "run-integration", "--repo", repoRoot]);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.integration_command, "");
  assert.equal(out.integration_exit_code, 0);
  assert.equal(out.integration_stdout, "");
  assert.equal(out.integration_stderr, "");
  assert.equal(out.integration_duration_ms, 0);
  assert.equal(out.integration_legacy_text, "integration_exit_code=0 (no command)");
});

test("merge run-integration captures non-zero exit and still returns CLI exit 0", () => {
  const run = runCli([
    "merge",
    "run-integration",
    "--repo",
    repoRoot,
    "--integration-command",
    "printf 'integration failed'; exit 7",
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.integration_exit_code, 7);
  assert.match(out.integration_stdout, /integration failed/);
  assert.equal(out.integration_legacy_text, "integration_exit_code=7");
});

test("merge run-integration accepts quote-safe command payload via --integration-command-b64", () => {
  const command = "printf \"O'Hare\"; exit 4";
  const run = runCli([
    "merge",
    "run-integration",
    "--repo",
    repoRoot,
    "--integration-command-b64",
    Buffer.from(command, "utf8").toString("base64"),
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.integration_exit_code, 4);
  assert.match(out.integration_stdout, /O'Hare/);
  assert.equal(out.integration_legacy_text, "integration_exit_code=4");
});

test("merge run-integration treats non-base64 --integration-command-b64 payload as raw", () => {
  const command = "printf raw-b64-fallback; exit 6";
  const run = runCli([
    "merge",
    "run-integration",
    "--repo",
    repoRoot,
    "--integration-command-b64",
    command,
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.integration_exit_code, 6);
  assert.match(out.integration_stdout, /raw-b64-fallback/);
  assert.equal(out.integration_legacy_text, "integration_exit_code=6");
});

test("merge run-integration rejects mixed transport flags deterministically", () => {
  const run = runCli([
    "merge",
    "run-integration",
    "--repo",
    repoRoot,
    "--integration-command",
    "true",
    "--integration-command-b64",
    Buffer.from("true", "utf8").toString("base64"),
  ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /merge run-integration accepts one payload transport at a time/);
});

test("merge report appends legacy integration text from integration_result payload", () => {
  const integrationResult = JSON.stringify({ integration_exit_code: 9, integration_legacy_text: "integration_exit_code=9" });
  const run = runCli([
    "merge",
    "report",
    "--issue",
    "11",
    "--branch",
    "wave/11",
    "--merge-status",
    "merged",
    "--notes",
    "resolver_notes",
    "--integration-result-b64",
    Buffer.from(integrationResult, "utf8").toString("base64"),
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.notes, "resolver_notes integration_exit_code=9");
});

test("merge report accepts quote-safe notes payload via --notes-b64", () => {
  const notes = "merge stderr:\nO'Hare conflict in parser";
  const run = runCli([
    "merge",
    "report",
    "--issue",
    "12",
    "--branch",
    "wave/12",
    "--merge-status",
    "failed",
    "--notes-b64",
    Buffer.from(notes, "utf8").toString("base64"),
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.notes, notes);
});

test("merge report treats non-base64 *-b64 payloads as raw", () => {
  const integrationResult = JSON.stringify({ integration_exit_code: 5, integration_legacy_text: "integration_exit_code=5" });
  const run = runCli([
    "merge",
    "report",
    "--issue",
    "14",
    "--branch",
    "wave/14",
    "--merge-status",
    "failed",
    "--notes-b64",
    "raw notes from graph",
    "--integration-result-b64",
    integrationResult,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.notes, "raw notes from graph integration_exit_code=5");
});

test("merge report rejects mixed raw and b64 notes transport deterministically", () => {
  const run = runCli([
    "merge",
    "report",
    "--issue",
    "13",
    "--branch",
    "wave/13",
    "--merge-status",
    "failed",
    "--notes",
    "raw",
    "--notes-b64",
    Buffer.from("raw", "utf8").toString("base64"),
  ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /merge report notes accepts one payload transport at a time/);
});
