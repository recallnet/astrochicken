import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const COMMAND_STATUS_PATH = "packages/factory-ops/src/commands/factory-status.ts";
const FACTORY_OPS_SRC_ROOT = "packages/factory-ops/src";
const LEGACY_SUPPORT_PATH = "packages/factory-ops/src/lib/factory-status-support.ts";

function walkFiles(rootDir) {
  const files = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(relative(REPO_ROOT, absolute).replaceAll("\\", "/"));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

test("factory-status command routes active-summary through the canonical Postgres-backed owner", () => {
  const source = readFileSync(join(REPO_ROOT, COMMAND_STATUS_PATH), "utf8");
  assert.doesNotMatch(source, /legacyFixtureFactoryActiveSummary/);
  assert.match(source, /factoryActiveSummary as readCanonicalFactoryActiveSummary/);
  assert.match(source, /return readCanonicalFactoryActiveSummary\(\{ runsDir, now, context \}\);/);
});

test("legacy fixture status helpers are only imported from test files", () => {
  const sourceFiles = walkFiles(join(REPO_ROOT, FACTORY_OPS_SRC_ROOT))
    .filter((pathValue) => pathValue.endsWith(".mjs"))
    .filter((pathValue) => pathValue !== LEGACY_SUPPORT_PATH);

  const violations = [];
  for (const pathValue of sourceFiles) {
    const source = readFileSync(join(REPO_ROOT, pathValue), "utf8");
    if (/import[\s\S]*\blegacyFixture[A-Za-z0-9_]*[\s\S]*from\s+["'][^"']*factory-status-support\.mjs["']/.test(source)) {
      violations.push(pathValue);
    }
  }

  assert.deepEqual(violations, []);
});
