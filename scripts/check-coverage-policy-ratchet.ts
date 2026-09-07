#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_BASELINE_PATH = "scripts/coverage-policy-ratchet-baseline.json";

export const COVERAGE_POLICY_MANIFEST = Object.freeze([
  Object.freeze({
    id: "apps_hatch_vitest",
    label: "apps/hatch vitest coverage policy",
    kind: "vitest",
    path: "apps/hatch/vitest.config.ts",
  }),
  Object.freeze({
    id: "factory_ops_c8",
    label: "packages/factory-ops c8 coverage policy",
    kind: "package_test_manifest",
    path: "config/testing/package-test-manifests/packages-factory-ops.json",
  }),
]);

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function matchNumeric(content, pattern, label, path) {
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse ${label} from ${path}`);
  }
  return Number.parseInt(match[1], 10);
}

function extractStringList(body) {
  if (!body.trim()) {
    return [];
  }
  return [...body.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

export function parseVitestCoveragePolicy(content, path = "apps/hatch/vitest.config.ts") {
  const includeMatch = content.match(/include:\s*\[([^\]]*)\]/m);
  const excludeMatch = content.match(/exclude:\s*\[([^\]]*)\]/m);
  return {
    include: includeMatch ? extractStringList(includeMatch[1]) : [],
    exclude: excludeMatch ? extractStringList(excludeMatch[1]) : [],
    thresholds: {
      statements: matchNumeric(content, /statements:\s*(\d+)/, "coverage.thresholds.statements", path),
      lines: matchNumeric(content, /lines:\s*(\d+)/, "coverage.thresholds.lines", path),
      functions: matchNumeric(content, /functions:\s*(\d+)/, "coverage.thresholds.functions", path),
      branches: matchNumeric(content, /branches:\s*(\d+)/, "coverage.thresholds.branches", path),
    },
  };
}

function parseC8Args(script, path) {
  const src = [];
  const exclude = [];
  const thresholds = {};
  const tokens = script.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1]?.replace(/^['"]|['"]$/g, "") || "";
    if (token === "--src" && next) {
      src.push(next);
      index += 1;
      continue;
    }
    if (token === "--exclude" && next) {
      exclude.push(next);
      index += 1;
      continue;
    }
    if (token === "--statements" || token === "--lines" || token === "--functions" || token === "--branches") {
      if (!next) {
        throw new Error(`Missing ${token} value in ${path}`);
      }
      thresholds[token.slice(2)] = Number.parseInt(next, 10);
      index += 1;
    }
  }

  for (const key of ["statements", "lines", "functions", "branches"]) {
    if (!Number.isInteger(thresholds[key])) {
      throw new Error(`Missing --${key} threshold in ${path}`);
    }
  }

  return { src, exclude, thresholds };
}

export function parseC8CoveragePolicy(content, path = "config/testing/package-test-manifests/packages-factory-ops.json") {
  const manifest = JSON.parse(content);
  const suite = Array.isArray(manifest?.suites)
    ? manifest.suites.find((entry) => entry?.name === "wave-claim-gates")
    : null;
  if (!suite) {
    throw new Error(`Missing suites.wave-claim-gates in ${path}`);
  }
  if (suite.coverage_policy) {
    return {
      src: suite.coverage_policy.src || [],
      exclude: suite.coverage_policy.exclude || [],
      thresholds: suite.coverage_policy.thresholds || {},
    };
  }
  return parseC8Args(String(suite.command || ""), path);
}

export function readCoveragePolicy(manifestEntry) {
  if (!existsSync(manifestEntry.path)) {
    throw new Error(`Missing coverage policy path: ${manifestEntry.path}`);
  }
  const content = readFileSync(manifestEntry.path, "utf8");
  if (manifestEntry.kind === "vitest") {
    return {
      id: manifestEntry.id,
      label: manifestEntry.label,
      path: manifestEntry.path,
      kind: manifestEntry.kind,
      ...parseVitestCoveragePolicy(content, manifestEntry.path),
    };
  }
  if (manifestEntry.kind === "package_test_manifest") {
    return {
      id: manifestEntry.id,
      label: manifestEntry.label,
      path: manifestEntry.path,
      kind: "c8",
      ...parseC8CoveragePolicy(content, manifestEntry.path),
    };
  }
  throw new Error(`Unsupported policy kind: ${manifestEntry.kind}`);
}

export function analyzeCoveragePolicyRatchet({
  manifest = COVERAGE_POLICY_MANIFEST,
} = {}) {
  return {
    policies: manifest.map(readCoveragePolicy),
  };
}

function loadBaseline(path = DEFAULT_BASELINE_PATH) {
  if (!existsSync(path)) {
    return {
      schema: "coverage_policy_ratchet_baseline/v1",
      policies: [],
    };
  }
  return parseJsonFile(path);
}

function compareList(kind, baselineList = [], currentList = []) {
  const baselineSet = new Set(baselineList);
  const currentSet = new Set(currentList);
  return {
    kind,
    missing: baselineList.filter((entry) => !currentSet.has(entry)),
    added: currentList.filter((entry) => !baselineSet.has(entry)),
  };
}

export function compareCoveragePolicyBaseline(result, baseline) {
  const baselineById = new Map((baseline.policies || []).map((entry) => [entry.id, entry]));
  const policies = result.policies.map((policy) => {
    const baselinePolicy = baselineById.get(policy.id) || {};
    const scopeKey = policy.kind === "c8" ? "src" : "include";
    const scopeDiff = compareList(scopeKey, baselinePolicy[scopeKey] || [], policy[scopeKey] || []);
    const excludeDiff = compareList("exclude", baselinePolicy.exclude || [], policy.exclude || []);
    const thresholdDiffs = Object.fromEntries(
      Object.entries(policy.thresholds).map(([key, value]) => {
        const baselineValue = baselinePolicy?.thresholds?.[key];
        return [key, {
          baseline: baselineValue,
          current: value,
          lowered: Number.isInteger(baselineValue) ? value < baselineValue : false,
        }];
      }),
    );
    return {
      ...policy,
      scope_missing: scopeDiff.missing,
      scope_added: scopeDiff.added,
      new_excludes: excludeDiff.added,
      removed_excludes: excludeDiff.missing,
      threshold_diffs: thresholdDiffs,
    };
  });

  const violations = policies.flatMap((policy) => {
    const scopeLabel = policy.kind === "c8" ? "src" : "include";
    const policyViolations = [];
    if (policy.scope_missing.length > 0) {
      policyViolations.push(`${policy.id}: removed protected ${scopeLabel} entries: ${policy.scope_missing.join(", ")}`);
    }
    if (policy.new_excludes.length > 0) {
      policyViolations.push(`${policy.id}: added coverage excludes: ${policy.new_excludes.join(", ")}`);
    }
    for (const [name, diff] of Object.entries(policy.threshold_diffs)) {
      if (diff.lowered) {
        policyViolations.push(
          `${policy.id}: lowered ${name} threshold from ${diff.baseline} to ${diff.current}`,
        );
      }
    }
    return policyViolations;
  });

  return { policies, violations };
}

export function writeCoveragePolicyBaseline(path, result) {
  const payload = {
    schema: "coverage_policy_ratchet_baseline/v1",
    generated: new Date().toISOString(),
    description: "Checked-in coverage policy floors for critical runtime workspaces. Thresholds may increase and source scope may tighten, but protected includes/src roots cannot be removed and new source exclusions cannot be added without explicitly updating this baseline.",
    policies: result.policies.map((policy) => ({
      id: policy.id,
      label: policy.label,
      path: policy.path,
      kind: policy.kind,
      ...(policy.kind === "c8" ? { src: policy.src } : { include: policy.include }),
      exclude: policy.exclude,
      thresholds: policy.thresholds,
    })),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] || "";
}

async function main() {
  const args = process.argv.slice(2);
  const baselinePath = argValue(args, "--baseline") || DEFAULT_BASELINE_PATH;
  const updateBaseline = args.includes("--update-baseline");
  const json = args.includes("--json");

  const result = analyzeCoveragePolicyRatchet();

  if (updateBaseline) {
    writeCoveragePolicyBaseline(baselinePath, result);
    console.log(`[coverage-policy] baseline_updated path=${baselinePath}`);
    return;
  }

  const comparison = compareCoveragePolicyBaseline(result, loadBaseline(baselinePath));
  const payload = {
    result: comparison.violations.length === 0 ? "ok" : "fail",
    violation_count: comparison.violations.length,
    policies: comparison.policies,
    violations: comparison.violations,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    console.log(`[coverage-policy] result=${payload.result} violations=${payload.violation_count}`);
    for (const violation of comparison.violations) {
      console.error(`[coverage-policy] violation ${violation}`);
    }
  }

  if (comparison.violations.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]?.endsWith("check-coverage-policy-ratchet.ts") || process.argv[1]?.endsWith("check-coverage-policy-ratchet.mjs") === true;

if (isDirectRun) {
  await main();
}
