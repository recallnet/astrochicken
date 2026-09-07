#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_QUERY_IDS = [
  "cost_per_skill",
  "cost_per_work_unit",
  "first_pass_rate",
  "retry_by_failure_class",
  "model_utilization",
  "cross_factory_benchmark",
  "prompt_version_comparison",
  "model_comparison",
  "latency_per_job",
];

const CONTRACT_PATH = resolve("docs/contracts/langfuse-benchmark-queries.json");

function fail(message) {
  process.stderr.write("[benchmark-queries] result=fail\n");
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main() {
  let entries;
  try {
    entries = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  } catch (error) {
    fail(`[benchmark-queries] FAIL: unable to parse contract JSON at ${CONTRACT_PATH}: ${String(error?.message || error)}`);
  }

  if (!Array.isArray(entries)) {
    fail("[benchmark-queries] FAIL: contract must be a top-level array");
  }

  const present = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      fail("[benchmark-queries] FAIL: each entry must be an object");
    }

    const queryId = String(entry.query_id || "").trim();
    if (!queryId) {
      fail("[benchmark-queries] FAIL: entry missing required string field 'query_id'");
    }

    if (typeof entry.description !== "string" || !entry.description.trim()) {
      fail(`[benchmark-queries] FAIL: query '${queryId}' missing non-empty string field 'description'`);
    }

    if (!entry.filter || typeof entry.filter !== "object" || Array.isArray(entry.filter)) {
      fail(`[benchmark-queries] FAIL: query '${queryId}' missing object field 'filter'`);
    }

    if (!Array.isArray(entry.group_by) || !entry.group_by.every((value) => typeof value === "string" && value.trim())) {
      fail(`[benchmark-queries] FAIL: query '${queryId}' must include non-empty string array 'group_by'`);
    }

    if (!Array.isArray(entry.metrics) || !entry.metrics.every((value) => typeof value === "string" && value.trim())) {
      fail(`[benchmark-queries] FAIL: query '${queryId}' must include non-empty string array 'metrics'`);
    }

    present.add(queryId);
  }

  const missing = REQUIRED_QUERY_IDS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    fail(`[benchmark-queries] FAIL: missing required query entries: ${missing.join(", ")}`);
  }

  if (present.size !== REQUIRED_QUERY_IDS.length) {
    const extra = [...present].filter((id) => !REQUIRED_QUERY_IDS.includes(id));
    if (extra.length > 0) {
      fail(`[benchmark-queries] FAIL: unexpected query entries present: ${extra.join(", ")}`);
    }
  }

  process.stdout.write("[benchmark-queries] ok: all required query entries present\n");
  process.stdout.write("[benchmark-queries] result=ok entries=9\n");
}

main();
