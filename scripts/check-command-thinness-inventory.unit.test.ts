import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCommandThinnessInventory } from "./check-command-thinness-inventory.ts";

test("analyzeCommandThinnessInventory ignores non-command files", () => {
  const result = analyzeCommandThinnessInventory({
    files: ["README.md", "packages/factory-ops/src/lib/helper.mjs"],
    readFile() {
      return "export const x = 1;\n";
    },
  });

  assert.equal(result.checked, 0);
  assert.deepEqual(result.violations, []);
});

test("analyzeCommandThinnessInventory reports oversized command modules", () => {
  const content = `${"if (x) {}\n".repeat(405)}`;
  const result = analyzeCommandThinnessInventory({
    files: ["packages/factory-ops/src/commands/example.mjs"],
    readFile() {
      return content;
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.summary.oversized, 1);
  assert.equal(result.summary.hotspots, 0);
  assert.equal(result.violations[0]?.classification, "oversized");
});

test("analyzeCommandThinnessInventory reports hotspot command modules", () => {
  const content = `${"switch (x) {}\n".repeat(810)}`;
  const result = analyzeCommandThinnessInventory({
    files: ["packages/factory-ops/src/commands/huge.mjs"],
    readFile() {
      return content;
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.summary.hotspots, 1);
  assert.equal(result.violations[0]?.classification, "hotspot");
  assert.ok((result.violations[0]?.complexity_signals ?? 0) >= 810);
});

test("analyzeCommandThinnessInventory includes CLI command entrypoints", () => {
  const content = `${"if (x) {}\n".repeat(405)}`;
  const result = analyzeCommandThinnessInventory({
    files: ["packages/factory-ops/src/cli/commands/release.ts"],
    readFile() {
      return content;
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.summary.oversized, 1);
  assert.equal(result.violations[0]?.file, "packages/factory-ops/src/cli/commands/release.ts");
});
