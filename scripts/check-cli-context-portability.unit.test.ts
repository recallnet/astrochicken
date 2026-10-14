import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptsDir, "check-cli-context-portability.ts");
const scriptSource = readFileSync(scriptPath, "utf8");

test("cli context portability targets only the intended Hatch Vitest contract files", () => {
  assert.match(scriptSource, /isRetryableCliContextFailure/);
  assert.match(scriptSource, /"transient_child_resolution"/);
  assert.match(scriptSource, /function boundedVitestArgs/);
  assert.match(
    scriptSource,
    /"--pool",\s*"forks",\s*"--no-file-parallelism",\s*"--testTimeout",\s*"120000",\s*"--hookTimeout",\s*"120000",\s*"--maxWorkers",\s*"1"/,
  );
  assert.doesNotMatch(scriptSource, /--poolOptions|--minWorkers/);
  assert.match(scriptSource, /boundedVitestArgs\("src\/cli-run-config\.test\.ts"\)/);
  assert.match(
    scriptSource,
    /^run\("factory_ops_context",\s*"node",\s*\[\s*"--test",\s*"packages\/factory-ops\/test\/supervisor\/factory-context-resolution-cli\.cli\.test\.ts"/m,
  );
  assert.match(
    scriptSource,
    /boundedVitestArgs\(\s*"src\/pipeline\/handler\/pipeline-parent-context\.test\.ts",\s*"src\/runs-context-portability\.integration\.test\.ts",?\s*\)/,
  );
  assert.doesNotMatch(scriptSource, /"--filter",\s*"hatch",\s*"test"/);
});
