#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  analyzeDispatchLatencySloContract,
  DISPATCH_LATENCY_SLO_REPORT_JSON_PATH,
  DISPATCH_LATENCY_SLO_REPORT_MARKDOWN_PATH,
  listTrackedFilesFromGit,
} from "./lib/dispatch-latency-slo-contract.ts";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const allTracked = args.has("--all-tracked");

const files = allTracked ? listTrackedFilesFromGit() : [];
const result = analyzeDispatchLatencySloContract({ files });

if (write) {
  mkdirSync(path.dirname(DISPATCH_LATENCY_SLO_REPORT_JSON_PATH), { recursive: true });
  writeFileSync(DISPATCH_LATENCY_SLO_REPORT_JSON_PATH, result.rendered_json, "utf8");
  writeFileSync(DISPATCH_LATENCY_SLO_REPORT_MARKDOWN_PATH, result.rendered_markdown, "utf8");
}

console.log(`[dispatch-latency-slo-contract] result=${result.ok ? "ok" : "fail"} diagnostics=${result.report.diagnostics.length}`);

if (!result.ok) {
  for (const diagnostic of result.report.diagnostics) console.error(diagnostic);
  process.exit(1);
}
