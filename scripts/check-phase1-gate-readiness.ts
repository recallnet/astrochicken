#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

import {
  analyzePhase1GateReadinessArtifacts,
  loadCheckedInPhase1GateReadinessArtifacts,
  PHASE1_GATE_READINESS_REPORT_JSON_PATH,
  PHASE1_GATE_READINESS_REPORT_MARKDOWN_PATH,
} from "./lib/phase1-gate-readiness.ts";

function collectTrackedFiles() {
  return String(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }) || "")
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(file));
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const writeArtifacts = args.includes("--write");
  const files = collectTrackedFiles();
  const checkedIn = loadCheckedInPhase1GateReadinessArtifacts();
  const analysis = analyzePhase1GateReadinessArtifacts({
    files,
    expectedJson: checkedIn.json,
    expectedMarkdown: checkedIn.markdown,
  });

  if (writeArtifacts) {
    writeFileSync(PHASE1_GATE_READINESS_REPORT_JSON_PATH, analysis.rendered_json);
    writeFileSync(PHASE1_GATE_READINESS_REPORT_MARKDOWN_PATH, analysis.rendered_markdown);
    process.stdout.write(
      `[phase1-gate-readiness] result=ok graph=${analysis.report.summary.graph_transport_violations} runtime=${analysis.report.summary.runtime_internal_cli_violations} command=${analysis.report.summary.command_thinness_violations} diagnostics=${analysis.report.diagnostics.length} wrote=true\n`,
    );
    process.exit(0);
    return;
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    process.exit(analysis.ok ? 0 : 1);
    return;
  }

  for (const diagnostic of analysis.diagnostics) {
    process.stdout.write(`[phase1-gate-readiness] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[phase1-gate-readiness] result=${analysis.ok ? "ok" : "fail"} graph=${analysis.report.summary.graph_transport_violations} runtime=${analysis.report.summary.runtime_internal_cli_violations} command=${analysis.report.summary.command_thinness_violations} diagnostics=${analysis.diagnostics.length}\n`,
  );
  process.exit(analysis.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-phase1-gate-readiness.ts") || process.argv[1]?.endsWith("check-phase1-gate-readiness.mjs")) {
  main();
}
