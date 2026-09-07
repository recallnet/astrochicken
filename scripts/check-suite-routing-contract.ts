#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "suite_routing_contract";
const CONFIG_PATH = "config/testing/suite-routing.json";
const ALLOWED_BUCKETS = new Set([
  "guard_only",
  "wave_claim_only",
  "all_suites",
  "platform_invariant_trigger",
  "neither_change",
]);

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    json: argv.includes("--json"),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortedBucketKey(parts) {
  return [...parts].sort().join("+");
}

export function validateSuiteRoutingContract({ repoRoot }) {
  const diagnostics = [];
  const configPath = resolve(repoRoot, CONFIG_PATH);
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  if (config.schema !== "hatch.suite-routing.v1") {
    diagnostics.push(`${CONFIG_PATH}.schema must be "hatch.suite-routing.v1"`);
  }

  if (!Array.isArray(config.routes) || config.routes.length === 0) {
    diagnostics.push(`${CONFIG_PATH}.routes must be a non-empty array`);
  }

  if (!isRecord(config.bucket_suites)) {
    diagnostics.push(`${CONFIG_PATH}.bucket_suites must be an object`);
  }

  if (!Array.isArray(config.selection_matrix) || config.selection_matrix.length === 0) {
    diagnostics.push(`${CONFIG_PATH}.selection_matrix must be a non-empty array`);
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, route_count: 0, matrix_rows: 0 };
  }

  const routes = config.routes;
  const routePatterns = new Set();
  let catchAllCount = 0;

  for (const [index, route] of routes.entries()) {
    if (!isRecord(route)) {
      diagnostics.push(`${CONFIG_PATH}.routes[${index}] must be an object`);
      continue;
    }
    if (typeof route.pattern !== "string" || route.pattern.trim() === "") {
      diagnostics.push(`${CONFIG_PATH}.routes[${index}].pattern must be a non-empty string`);
    }
    if (!ALLOWED_BUCKETS.has(route.bucket)) {
      diagnostics.push(`${CONFIG_PATH}.routes[${index}].bucket must be one of ${[...ALLOWED_BUCKETS].join(", ")}`);
    }
    if (routePatterns.has(route.pattern)) {
      diagnostics.push(`${CONFIG_PATH}.routes contains duplicate pattern ${JSON.stringify(route.pattern)}`);
    }
    routePatterns.add(route.pattern);
    if (route.pattern === "*") {
      catchAllCount += 1;
      if (index !== routes.length - 1) {
        diagnostics.push(`${CONFIG_PATH}.routes catch-all "*" must be the final route`);
      }
    }
  }

  if (catchAllCount !== 1) {
    diagnostics.push(`${CONFIG_PATH}.routes must contain exactly one "*" catch-all route`);
  }

  const bucketSuites = config.bucket_suites;
  for (const bucket of ALLOWED_BUCKETS) {
    if (!(bucket in bucketSuites)) {
      diagnostics.push(`${CONFIG_PATH}.bucket_suites missing bucket ${bucket}`);
      continue;
    }
    if (!Array.isArray(bucketSuites[bucket])) {
      diagnostics.push(`${CONFIG_PATH}.bucket_suites.${bucket} must be an array`);
      continue;
    }
    for (const suiteName of bucketSuites[bucket]) {
      if (typeof suiteName !== "string" || suiteName.trim() === "") {
        diagnostics.push(`${CONFIG_PATH}.bucket_suites.${bucket} must contain non-empty suite names`);
      }
    }
  }

  const matrixRows = new Map();
  for (const [index, row] of config.selection_matrix.entries()) {
    if (!isRecord(row)) {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix[${index}] must be an object`);
      continue;
    }
    if (typeof row.bucket_key !== "string" || row.bucket_key.trim() === "") {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix[${index}].bucket_key must be a non-empty string`);
      continue;
    }
    if (matrixRows.has(row.bucket_key)) {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix contains duplicate bucket_key ${row.bucket_key}`);
    }
    matrixRows.set(row.bucket_key, row);
    if (!ALLOWED_BUCKETS.has(row.selected_bucket)) {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix[${index}].selected_bucket must be one of ${[...ALLOWED_BUCKETS].join(", ")}`);
    }
    if (typeof row.reason !== "string" || row.reason.trim() === "") {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix[${index}].reason must be a non-empty string`);
    }
  }

  const routableBuckets = new Set(routes.map((route) => route.bucket));
  const combos = [];
  for (const bucket of routableBuckets) {
    combos.push([bucket]);
  }
  const sortedBuckets = [...routableBuckets].sort();
  for (let mask = 1; mask < (1 << sortedBuckets.length); mask += 1) {
    const combo = [];
    for (let bit = 0; bit < sortedBuckets.length; bit += 1) {
      if (mask & (1 << bit)) combo.push(sortedBuckets[bit]);
    }
    if (combo.length > 1) combos.push(combo);
  }

  for (const combo of combos) {
    const bucketKey = sortedBucketKey(combo);
    if (!matrixRows.has(bucketKey)) {
      diagnostics.push(`${CONFIG_PATH}.selection_matrix missing bucket_key ${bucketKey}`);
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    route_count: routes.length,
    matrix_rows: config.selection_matrix.length,
  };
}

function emitTelemetry(result) {
  console.log(
    `[${TELEMETRY_PREFIX}] result=${result.ok ? "ok" : "fail"} routes=${result.route_count} matrix_rows=${result.matrix_rows} errors=${result.diagnostics.length}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateSuiteRoutingContract(options);
  emitTelemetry(result);
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    const result = {
      ok: false,
      diagnostics: [String(error?.message || error)],
      route_count: 0,
      matrix_rows: 0,
    };
    emitTelemetry(result);
    process.exit(1);
  }
}
