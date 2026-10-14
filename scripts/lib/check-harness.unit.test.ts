import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { emitResult, parseArgs } from "./check-harness.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const harnessModuleUrl = pathToFileURL(join(repoRoot, "scripts", "lib", "check-harness.ts")).href;

function captureWrites(run) {
  const writes = { stdout: "", stderr: "" };
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk, encoding, callback) => {
    writes.stdout += String(chunk);
    if (typeof callback === "function") callback();
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    writes.stderr += String(chunk);
    if (typeof callback === "function") callback();
    return true;
  };

  try {
    run();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return writes;
}

function runMainInline(source) {
  return spawnSync("node", ["-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("parseArgs throws on unknown flags", () => {
  assert.throws(
    () => parseArgs(["--nope"], [{ flag: "--file", type: "string" }]),
    /Unknown argument: --nope/,
  );
});

test("parseArgs supports --help shortcut", () => {
  const parsed = parseArgs(["--help"], [{ flag: "--file", type: "string" }]);
  assert.deepEqual(parsed, { help: true });
});

test("parseArgs accumulates multi flags and boolean toggles", () => {
  const parsed = parseArgs(
    ["--file", "a.mjs", "--verbose", "--file", "b.mjs"],
    [
      { flag: "--file", type: "string", multi: true },
      { flag: "--verbose", type: "boolean" },
    ],
  );
  assert.deepEqual(parsed, { file: ["a.mjs", "b.mjs"], verbose: true });
});

test("parseArgs throws when required value is missing", () => {
  assert.throws(
    () => parseArgs(["--file"], [{ flag: "--file", type: "string" }]),
    /--file requires a value/,
  );
});

test("parseArgs returns defaults when argv is empty", () => {
  const parsed = parseArgs([], [
    { flag: "--file", type: "string", multi: true },
    { flag: "--verbose", type: "boolean" },
  ]);
  assert.deepEqual(parsed, { file: [], verbose: false });
});

test("emitResult writes ok output to stdout only", () => {
  const writes = captureWrites(() => {
    emitResult({ ok: true, gate: "example", message: "files=2" });
  });
  assert.equal(writes.stdout, "[example] result=ok files=2\n");
  assert.equal(writes.stderr, "");
});

test("emitResult writes diagnostics and fail summary to stderr", () => {
  const writes = captureWrites(() => {
    emitResult({
      ok: false,
      gate: "example",
      diagnostics: ["first", "second"],
    });
  });
  assert.equal(writes.stdout, "");
  assert.equal(writes.stderr, "first\nsecond\n[example] result=fail diagnostics=2\n");
});

test("main exits 0 when async check resolves ok", () => {
  const run = runMainInline(`
    const { main } = await import(${JSON.stringify(harnessModuleUrl)});
    await main(async () => ({ ok: true }), { gate: "harness-main", okMessage: "done=true" });
  `);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[harness-main\] result=ok done=true/);
});

test("main exits 1 when check resolves fail", () => {
  const run = runMainInline(`
    const { main } = await import(${JSON.stringify(harnessModuleUrl)});
    await main(async () => ({ ok: false, diagnostics: ["x"] }), { gate: "harness-main" });
  `);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /x/);
  assert.match(run.stderr, /\[harness-main\] result=fail diagnostics=1/);
});

test("main exits 1 and reports thrown errors", () => {
  const run = runMainInline(`
    const { main } = await import(${JSON.stringify(harnessModuleUrl)});
    await main(async () => { throw new Error("boom"); }, { gate: "harness-main" });
  `);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /boom/);
  assert.match(run.stderr, /\[harness-main\] result=fail diagnostics=1/);
});
