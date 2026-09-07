import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scriptPath = join(process.cwd(), "scripts", "check-factory-portability-contract.mjs");
const scriptSource = readFileSync(scriptPath, "utf8");

test("factory portability contract runs node test with single-worker concurrency", () => {
  assert.match(scriptSource, /"--test-concurrency=1"/);
});
