import assert from "node:assert/strict";
import test from "node:test";

import { analyzeLineLimits } from "./check-line-limit.ts";

test("analyzeLineLimits ignores non-code files and accepts files within limit", () => {
  const result = analyzeLineLimits({
    files: [
      "scripts/check-line-limit.ts",
      "README.md",
    ],
    maxCodeLines: 1000,
  });

  assert.equal(result.checked, 1);
  assert.deepEqual(result.violations, []);
});

test("analyzeLineLimits reports code files above the configured limit", () => {
  const result = analyzeLineLimits({
    files: ["scripts/check-line-limit.ts"],
    maxCodeLines: 10,
  });

  assert.equal(result.checked, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.file, "scripts/check-line-limit.ts");
  assert.equal(result.violations[0]?.max_lines, 10);
  assert.ok((result.violations[0]?.lines ?? 0) > 10);
});
