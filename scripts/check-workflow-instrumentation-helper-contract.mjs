import { readFileSync, writeFileSync } from "node:fs";

import {
  analyzeWorkflowInstrumentationHelpers,
  listTrackedFilesFromGit,
  WORKFLOW_INSTRUMENTATION_REPORT_JSON_PATH,
  WORKFLOW_INSTRUMENTATION_REPORT_MARKDOWN_PATH,
} from "./lib/workflow-instrumentation-helper-contract.ts";

function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (!text) return [];
  if (text.includes("\0")) return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function usage() {
  return "Usage: node scripts/check-workflow-instrumentation-helper-contract.mjs [--staged-file-list <path> | --all-tracked] [--write]";
}

function parseArgs(argv) {
  const options = {
    stagedFileList: "",
    allTracked: false,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged-file-list") {
      options.stagedFileList = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (options.stagedFileList && options.allTracked) {
    throw new Error(`Choose only one scope input\n${usage()}`);
  }
  return options;
}

export function analyzeWorkflowInstrumentationScope({ stagedFileList = "", allTracked = false } = {}) {
  const stagedScope = Boolean(stagedFileList) && !allTracked;
  const files = allTracked
    ? listTrackedFilesFromGit()
    : stagedFileList
      ? parsePathListBuffer(readFileSync(stagedFileList))
      : listTrackedFilesFromGit();

  return analyzeWorkflowInstrumentationHelpers({
    files,
    enforceReportDrift: !stagedScope,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const analysis = analyzeWorkflowInstrumentationScope(options);

  if (options.write) {
    writeFileSync(WORKFLOW_INSTRUMENTATION_REPORT_JSON_PATH, analysis.rendered_json, "utf8");
    writeFileSync(WORKFLOW_INSTRUMENTATION_REPORT_MARKDOWN_PATH, analysis.rendered_markdown, "utf8");
  }

  process.stdout.write(`[workflow-instrumentation-helper] result=${analysis.ok ? "ok" : "fail"} helper_consumer_files=${analysis.report.summary.helper_consumer_files} direct_bypass_files=${analysis.report.summary.direct_bypass_files} diagnostics=${analysis.diagnostics.length}\n`);
  if (!analysis.ok) {
    process.stderr.write(`${analysis.diagnostics.join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
