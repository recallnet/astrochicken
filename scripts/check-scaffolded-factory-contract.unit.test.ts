import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptsDir, "check-scaffolded-factory-contract.ts");
const scriptSource = readFileSync(scriptPath, "utf8");

test("scaffolded factory contract targets only the intended Hatch Vitest contract files", () => {
  assert.match(scriptSource, /"exec",\s*"vitest",\s*"--run",\s*"src\/factory\/config-schema\.test\.ts",\s*"src\/factory\/scaffold\.test\.ts",\s*"src\/factory\/init\.test\.ts"/);
  assert.doesNotMatch(scriptSource, /"--filter",\s*"hatch",\s*"test"/);
});

test("scaffolded factory contract self-bootstraps workspace runtime links before running checks", () => {
  assert.match(scriptSource, /import\s+\{\s*runPostinstallBootstrap\s*\}\s+from\s+"\.\/postinstall-bootstrap\.mjs"/);
  assert.match(scriptSource, /runPostinstallBootstrap\(\)/);
});
