import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeGhStub(mode = "open") {
  const binDir = mkdtempSync(join(tmpdir(), "upstream-bug-gate-gh-stub-"));
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, `#!/usr/bin/env bash
set -euo pipefail
mode="\${HATCH_TEST_GH_MODE:-open}"
if [[ "$*" == *"issue list"* && "$*" == *"--repo recallnet/astrochicken"* ]]; then
  if [[ "$mode" == "gh_error" ]]; then
    echo "gh auth failed" >&2
    exit 1
  fi
  if [[ "$mode" == "malformed" ]]; then
    printf '%s' '{not-json'
    exit 0
  fi
  if [[ "$mode" == "empty" ]]; then
    printf '%s' '[]'
    exit 0
  fi
  if [[ "$mode" == "needs_triage" ]]; then
    printf '%s' '[{"number":801,"title":"[bug] ambiguous replay incident","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"},{"name":"needs-triage"}],"body":""}]'
    exit 0
  fi
  printf '%s' '[{"number":701,"title":"[bug] runtime crash","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"}],"body":""},{"number":702,"title":"[bug] ops regression","labels":[{"name":"managed-factory-bug"},{"name":"factory:example-trading"}],"body":""}]'
  exit 0
fi
printf '%s' '[]'
`, "utf8");
  chmodSync(ghPath, 0o755);
  return binDir;
}

function runCli(mode, command = ["supervisor", "upstream-bug-gate"], args = ["--label", "managed-factory-bug", "--label", "factory:example-trading"]) {
  const binDir = makeGhStub(mode);
  try {
    return spawnSync("node", [
      opsCliPath,
      ...command,
      "--repo", "recallnet/astrochicken",
      ...args,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HATCH_TEST_GH_MODE: mode,
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

test("supervisor upstream-bug-gate CLI reports open upstream bugs", () => {
  const run = runCli("open");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "true");
  assert.equal(out.open_upstream_bug_count, 2);
  assert.deepEqual(out.open_upstream_bug_numbers, [701, 702]);
  assert.equal(out.parse_error, "");
});

test("supervisor upstream-bug-gate CLI reports clear state", () => {
  const run = runCli("empty");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "false");
  assert.equal(out.open_upstream_bug_count, 0);
  assert.deepEqual(out.open_upstream_bug_numbers, []);
  assert.equal(out.parse_error, "");
});

test("supervisor upstream-bug-gate CLI fails safe on malformed GH payload", () => {
  const run = runCli("malformed");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "false");
  assert.equal(out.open_upstream_bug_count, 0);
  assert.deepEqual(out.open_upstream_bug_numbers, []);
  assert.match(String(out.parse_error || ""), /gh_issue_list_failed/);
});

test("supervisor upstream-bug-gate CLI excludes needs-triage incidents from blocking", () => {
  const run = runCli("needs_triage");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "false");
  assert.equal(out.open_upstream_bug_count, 0);
  assert.deepEqual(out.open_upstream_bug_numbers, []);
  assert.equal(out.parse_error, "");
});

test("supervisor upstream-bug-gate CLI defaults to managed labels when no --label flags are provided", () => {
  const run = runCli("open", ["supervisor", "upstream-bug-gate"], []);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "true");
  assert.equal(out.open_upstream_bug_count, 2);
  assert.deepEqual(out.open_upstream_bug_numbers, [701, 702]);
  assert.equal(out.parse_error, "");
});

test("supervisor run --op upstream-bug-gate uses normalized argv path", () => {
  const run = runCli(
    "open",
    ["supervisor", "run", "--op", "upstream-bug-gate"],
    ["--label", "managed-factory-bug", "--label", "factory:example-trading"],
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "true");
  assert.equal(out.open_upstream_bug_count, 2);
  assert.deepEqual(out.open_upstream_bug_numbers, [701, 702]);
  assert.equal(out.parse_error, "");
});

test("supervisor upstream-bug-gate CLI stays non-blocking when gh exits non-zero", () => {
  const run = runCli("gh_error");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(String(run.stdout || "{}"));
  assert.equal(out.has_open_upstream_bugs, "false");
  assert.equal(out.open_upstream_bug_count, 0);
  assert.deepEqual(out.open_upstream_bug_numbers, []);
  assert.match(String(out.parse_error || ""), /gh_issue_list_failed/);
});
