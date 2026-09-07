import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  compareCoveragePolicyBaseline,
  parseC8CoveragePolicy,
  parseVitestCoveragePolicy,
  writeCoveragePolicyBaseline,
} from "./check-coverage-policy-ratchet.ts";

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

test("parseVitestCoveragePolicy reads include, exclude, and thresholds", () => {
  const policy = parseVitestCoveragePolicy(`
    export default defineConfig({
      test: {
        coverage: {
          include: ["src/**/*.ts"],
          exclude: ["src/generated/**"],
          thresholds: {
            statements: 34,
            lines: 35,
            functions: 66,
            branches: 67,
          },
        },
      },
    });
  `);

  assert.deepEqual(policy.include, ["src/**/*.ts"]);
  assert.deepEqual(policy.exclude, ["src/generated/**"]);
  assert.deepEqual(policy.thresholds, {
    statements: 34,
    lines: 35,
    functions: 66,
    branches: 67,
  });
});

test("parseC8CoveragePolicy reads src, exclude, and thresholds from package script", () => {
  const policy = parseC8CoveragePolicy(JSON.stringify({
    suites: [{
      name: "wave-claim-gates",
      coverage_policy: {
        src: ["packages/factory-ops/src"],
        exclude: ["packages/factory-ops/src/generated/**"],
        thresholds: {
          statements: 57,
          lines: 58,
          functions: 55,
          branches: 61,
        },
      },
    }],
  }));

  assert.deepEqual(policy.src, ["packages/factory-ops/src"]);
  assert.deepEqual(policy.exclude, ["packages/factory-ops/src/generated/**"]);
  assert.deepEqual(policy.thresholds, {
    statements: 57,
    lines: 58,
    functions: 55,
    branches: 61,
  });
});

test("compareCoveragePolicyBaseline reports lowered thresholds and added excludes", () => {
  const comparison = compareCoveragePolicyBaseline(
    {
      policies: [
        {
          id: "apps_hatch_vitest",
          kind: "vitest",
          include: ["src/**/*.ts"],
          exclude: ["src/generated/**"],
          thresholds: { statements: 33, lines: 34, functions: 66, branches: 66 },
        },
      ],
    },
    {
      policies: [
        {
          id: "apps_hatch_vitest",
          kind: "vitest",
          include: ["src/**/*.ts"],
          exclude: [],
          thresholds: { statements: 34, lines: 34, functions: 66, branches: 66 },
        },
      ],
    },
  );

  assert.equal(comparison.violations.length, 2);
  assert.match(comparison.violations[0], /added coverage excludes/);
  assert.match(comparison.violations[1], /lowered statements threshold/);
});

test("writeCoveragePolicyBaseline writes deterministic payload", () => {
  const root = mkdtempSync(join(tmpdir(), "coverage-policy-baseline-"));
  const path = join(root, "baseline.json");
  writeCoveragePolicyBaseline(path, {
    policies: [
      {
        id: "apps_hatch_vitest",
        label: "apps/hatch vitest coverage policy",
        path: "apps/hatch/vitest.config.mjs",
        kind: "vitest",
        include: ["src/**/*.ts"],
        exclude: [],
        thresholds: { statements: 34, lines: 34, functions: 66, branches: 66 },
      },
    ],
  });

  const payload = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(payload.schema, "coverage_policy_ratchet_baseline/v1");
  assert.deepEqual(payload.policies, [
    {
      id: "apps_hatch_vitest",
      label: "apps/hatch vitest coverage policy",
      path: "apps/hatch/vitest.config.mjs",
      kind: "vitest",
      include: ["src/**/*.ts"],
      exclude: [],
      thresholds: { statements: 34, lines: 34, functions: 66, branches: 66 },
    },
  ]);
});
