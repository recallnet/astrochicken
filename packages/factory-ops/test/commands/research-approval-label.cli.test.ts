import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeGhStub(mode = "ok") {
  const root = mkdtempSync(join(tmpdir(), "research-approval-label-gh-"));
  const statePath = join(root, "state.json");
  const ghPath = join(root, "gh");

  writeFileSync(statePath, JSON.stringify({ calls: [] }, null, 2), "utf8");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.HATCH_TEST_GH_STATE_PATH;
const mode = process.env.HATCH_TEST_GH_MODE || "ok";
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls.push(args);
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

if (args[0] === "issue" && args[1] === "edit") {
  if (mode === "label_not_found") {
    process.stderr.write("could not add label: label not found");
    process.exit(1);
  }
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  process.exit(0);
}

process.exit(0);
`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);

  return {
    binDir: root,
    statePath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runCli(args = [], { binDir, statePath, mode = "ok", expectedStatus = 0 } = {}) {
  const out = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_TEST_GH_STATE_PATH: statePath,
      HATCH_TEST_GH_MODE: mode,
    },
  });
  assert.equal(out.status, expectedStatus, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  return JSON.parse(String(out.stdout || "{}").trim() || "{}");
}

function readCalls(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8")).calls || [];
}

test("research set-approval-label applies approved label and posts context comment", () => {
  const stub = makeGhStub("ok");
  try {
    const payload = runCli([
      "research",
      "set-approval-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--approved",
      "true",
      "--approval-context",
      '{"stage_id":"backtesting"}',
    ], { ...stub, mode: "ok", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.code, "ok");
    assert.equal(payload.label, "research:approval/approved");
    assert.equal(payload.comment_posted, true);

    const calls = readCalls(stub.statePath);
    const editCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "edit") || [];
    const commentCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "comment") || [];
    assert.ok(editCall.includes("--add-label"));
    assert.ok(editCall.includes("research:approval/approved"));
    assert.ok(commentCall.includes("--body"));
    const body = commentCall[commentCall.indexOf("--body") + 1] || "";
    assert.match(body, /<!-- research-approval-context -->/);
  } finally {
    stub.cleanup();
  }
});

test("research set-approval-label returns label_not_found when label is missing", () => {
  const stub = makeGhStub("label_not_found");
  try {
    const payload = runCli([
      "research",
      "set-approval-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--approved",
      "true",
      "--approval-context",
      '{"stage_id":"backtesting"}',
    ], { ...stub, mode: "label_not_found", expectedStatus: 1 });

    assert.equal(payload.ok, false);
    assert.equal(payload.code, "label_not_found");
    assert.equal(payload.label, "research:approval/approved");
  } finally {
    stub.cleanup();
  }
});
