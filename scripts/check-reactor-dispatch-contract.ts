import { readFileSync, writeFileSync } from "node:fs";

import {
  analyzeReactorDispatchContract,
  listTrackedFilesFromGit,
  REACTOR_DISPATCH_REPORT_JSON_PATH,
  REACTOR_DISPATCH_REPORT_MARKDOWN_PATH,
} from "./lib/reactor-dispatch-contract.ts";

function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (!text) return [];
  if (text.includes("\0")) return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function usage() {
  return "Usage: node scripts/check-reactor-dispatch-contract.ts [--staged-file-list <path> | --all-tracked] [--write]";
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

export function analyzeReactorDispatchScope({ stagedFileList = "", allTracked = false } = {}) {
  const files = allTracked
    ? listTrackedFilesFromGit()
    : stagedFileList
      ? parsePathListBuffer(readFileSync(stagedFileList))
      : listTrackedFilesFromGit();
  return analyzeReactorDispatchContract({ files });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const analysis = analyzeReactorDispatchScope(options);

  if (options.write) {
    writeFileSync(REACTOR_DISPATCH_REPORT_JSON_PATH, analysis.rendered_json, "utf8");
    writeFileSync(REACTOR_DISPATCH_REPORT_MARKDOWN_PATH, analysis.rendered_markdown, "utf8");
  }

  process.stdout.write(`[reactor-dispatch-contract] result=${analysis.ok ? "ok" : "fail"} diagnostics=${analysis.report.diagnostics.length}\n`);
  if (!analysis.ok) {
    process.stderr.write(`${analysis.report.diagnostics.join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
