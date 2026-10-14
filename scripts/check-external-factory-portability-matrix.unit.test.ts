import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptsDir, "check-external-factory-portability-matrix.ts");
const scriptSource = readFileSync(scriptPath, "utf8");

test("external factory portability matrix targets only the intended Vitest contract files", () => {
  assert.match(scriptSource, /"exec",\s*"vitest",\s*"--run",\s*"src\/factory\/external-factory-portability\.contract\.test\.ts"/);
  assert.match(scriptSource, /"exec",\s*"vitest",\s*"--run",\s*"src\/factory\/supervisor-snapshot-context-portability\.contract\.test\.ts"/);
  assert.doesNotMatch(scriptSource, /"--filter",\s*"hatch",\s*"test"/);
});
