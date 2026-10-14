import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  runContextPropagationContract,
  selectDotFiles,
} from "./check-context-propagation-contract.ts";
import { baselineFixtureCommit, initFixtureRepo } from "./test/helpers/git-fixture.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = join(repoRoot, "scripts", "check-context-propagation-contract.ts");

function toNulBuffer(paths) {
  if (!paths.length) {
    return Buffer.alloc(0);
  }
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

test("parseArgs accepts --file-list and --staged-file-list aliases", () => {
  assert.deepEqual(parseArgs(["--file-list", "/tmp/a"]), {
    fileList: "/tmp/a",
    allTracked: false,
  });

  assert.deepEqual(parseArgs(["--staged-file-list", "/tmp/b"]), {
    fileList: "/tmp/b",
    allTracked: false,
  });
});

test("parseArgs rejects conflicting file-list modes", () => {
  assert.throws(
    () => parseArgs(["--file-list", "/tmp/a", "--staged-file-list", "/tmp/b"]),
    /Use only one file-list mode/,
  );

  assert.throws(
    () => parseArgs(["--staged-file-list", "/tmp/a", "--all-tracked"]),
    /Use only one input mode/,
  );
});

test("selectDotFiles filters to dot files from staged file list", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "context-propagation-contract-"));
  const listPath = join(fixtureDir, "staged-files.list");
  writeFileSync(listPath, toNulBuffer([
    "docs/guide.md",
    "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    "apps/hatch/src/pipeline/handler/worktree.ts",
    "apps/hatch/examples/sample.dot",
  ]));

  const dotFiles = selectDotFiles({ fileList: listPath, allTracked: false });
  assert.deepEqual(dotFiles, [
    "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    "apps/hatch/examples/sample.dot",
  ]);
});

test("runContextPropagationContract returns fail result when forced by env", () => {
  process.env.CONTEXT_PROPAGATION_CONTRACT_FORCE_EXIT = "9";
  try {
    const result = runContextPropagationContract({ dotFiles: ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"] });
    assert.equal(result.ok, false);
    assert.equal(result.checked, 1);
    assert.equal(result.violations.length, 1);
    assert.equal(result.exitStatus, 9);
  } finally {
    delete process.env.CONTEXT_PROPAGATION_CONTRACT_FORCE_EXIT;
  }
});

test("CLI supports --file-list mode", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "context-propagation-contract-cli-"));
  const listPath = join(fixtureDir, "staged-files.list");
  writeFileSync(listPath, toNulBuffer(["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]));

  const run = spawnSync("node", [scriptPath, "--file-list", listPath], {
    encoding: "utf8",
    cwd: repoRoot,
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\[context_propagation_contract\] result=ok checked=1 violations=0/);
});

test("CLI supports --all-tracked mode", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "context-propagation-contract-cli-all-tracked-"));
  mkdirSync(join(fixtureDir, "factories", "mothership", "graphs"), { recursive: true });
  mkdirSync(join(fixtureDir, "scripts"), { recursive: true });
  writeFileSync(join(fixtureDir, "factories", "mothership", "graphs", "wave_execute.dot"), "digraph t { a -> b; }\n");
  writeFileSync(join(fixtureDir, "scripts", "notes.mjs"), "export const note = true;\n");

  initFixtureRepo(fixtureDir);
  baselineFixtureCommit(fixtureDir, "fixture");

  const run = spawnSync("node", [scriptPath, "--all-tracked"], {
    encoding: "utf8",
    cwd: fixtureDir,
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\[context_propagation_contract\] result=ok checked=1 violations=0/);
});
