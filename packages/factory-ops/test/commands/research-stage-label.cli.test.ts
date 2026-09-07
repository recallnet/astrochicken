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
  const root = mkdtempSync(join(tmpdir(), "research-stage-label-gh-"));
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

if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ labels: [{ name: "research:stage/hypothesis_formulation" }] }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit") {
  if (mode === "label_not_found" && args.includes("--add-label")) {
    process.stderr.write("could not add label: 'research:stage/backtesting' not found");
    process.exit(1);
  }
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

test("research set-stage-label applies stage label via gh issue edit", () => {
  const stub = makeGhStub("ok");
  try {
    const payload = runCli([
      "research",
      "set-stage-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--stage",
      "backtesting",
    ], { ...stub, mode: "ok", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.code, "ok");
    assert.equal(payload.stage, "backtesting");
    assert.equal(payload.label, "research:stage/backtesting");

    const calls = readCalls(stub.statePath).map((args) => args.join(" "));
    assert.ok(calls.some((line) => line.includes("issue edit 1 --repo example-org/example-research --add-label research:stage/backtesting")));
  } finally {
    stub.cleanup();
  }
});

test("research set-stage-label returns label_not_found without throwing", () => {
  const stub = makeGhStub("label_not_found");
  try {
    const payload = runCli([
      "research",
      "set-stage-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--stage",
      "backtesting",
    ], { ...stub, mode: "label_not_found", expectedStatus: 1 });

    assert.equal(payload.ok, false);
    assert.equal(payload.code, "label_not_found");
    assert.equal(payload.stage, "backtesting");
    assert.equal(payload.label, "research:stage/backtesting");
  } finally {
    stub.cleanup();
  }
});
