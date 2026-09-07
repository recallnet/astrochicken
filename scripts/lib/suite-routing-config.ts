import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "../..");
const suiteRoutingPath = resolve(repoRoot, "config/testing/suite-routing.json");

function readSuiteRoutingConfig() {
  return JSON.parse(readFileSync(suiteRoutingPath, "utf8"));
}

function freezeRoute(route) {
  return Object.freeze({
    pattern: route.pattern,
    bucket: route.bucket,
  });
}

const suiteRoutingConfig = readSuiteRoutingConfig();

export const TEST_SUITE_ROUTE_PATTERNS = Object.freeze(
  (suiteRoutingConfig.routes || []).map(freezeRoute),
);

export const TEST_SUITE_BUCKET_TO_SUITES = Object.freeze(
  Object.fromEntries(
    Object.entries(suiteRoutingConfig.bucket_suites || {}).map(([bucket, suites]) => [
      bucket,
      Object.freeze([...(suites || [])]),
    ]),
  ),
);

export const TEST_SUITE_BUCKET_SELECTION_MATRIX = Object.freeze(
  Object.fromEntries(
    (suiteRoutingConfig.selection_matrix || []).map((entry) => [
      entry.bucket_key,
      Object.freeze({
        selectedBucket: entry.selected_bucket,
        reason: entry.reason,
      }),
    ]),
  ),
);
