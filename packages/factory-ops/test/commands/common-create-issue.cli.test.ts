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
  const root = mkdtempSync(join(tmpdir(), "common-create-issue-gh-"));
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

if (args[0] === "issue" && args[1] === "create") {
  process.stdout.write("https://github.com/recallnet/astrochicken/issues/2363\\n");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit" && args.includes("--add-label")) {
  const label = args[args.indexOf("--add-label") + 1] || "";
  if (mode === "missing_docs_label" && label === "docs") {
    process.stderr.write("could not add label: 'docs' not found\\n");
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

test("common create-issue exits successfully when optional label reconciliation hits label_not_found", () => {
  const stub = makeGhStub("missing_docs_label");
  try {
    const payload = runCli([
      "common",
      "create-issue",
      "--repo",
      "recallnet/astrochicken",
      "--issue-spec",
      JSON.stringify({
        issue_title: "Document canonical Hatch graph transition and convergence contract",
        issue_body: "Body.",
        issue_labels: "feature,docs",
      }),
    ], { ...stub, mode: "missing_docs_label", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.issue_url, "https://github.com/recallnet/astrochicken/issues/2363");
    assert.equal(payload.created_issue_number, "2363");
    assert.deepEqual(payload.applied_labels, ["feature"]);
    assert.deepEqual(payload.rejected_labels, ["docs"]);

    const calls = readCalls(stub.statePath);
    assert.deepEqual(calls[0], [
      "issue", "create", "--repo", "recallnet/astrochicken",
      "--title", "Document canonical Hatch graph transition and convergence contract",
      "--body", "Body.",
    ]);
  } finally {
    stub.cleanup();
  }
});
