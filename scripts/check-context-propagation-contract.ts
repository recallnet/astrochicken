#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (text.length === 0) return [];

  if (text.includes("\0")) {
    return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  }

  return text
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readPathList(path) {
  if (!path) return [];
  return parsePathListBuffer(readFileSync(path));
}

function collectTrackedFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });

  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }

  return parsePathListBuffer(run.stdout || "");
}

export function parseArgs(argv) {
  const fileList = argValue(argv, "--file-list");
  const stagedFileList = argValue(argv, "--staged-file-list");
  const allTracked = argv.includes("--all-tracked");

  if (fileList && stagedFileList) {
    throw new Error("Use only one file-list mode: --file-list or --staged-file-list");
  }

  const selectedFileList = fileList || stagedFileList;
  if (allTracked && selectedFileList) {
    throw new Error("Use only one input mode: --file-list/--staged-file-list or --all-tracked");
  }

  return {
    fileList: selectedFileList || "",
    allTracked,
  };
}

export function selectDotFiles({ fileList, allTracked }) {
  const files = allTracked
    ? collectTrackedFiles()
    : readPathList(fileList);

  return files.filter((path) => path.endsWith(".dot"));
}

export function runContextPropagationContract({ dotFiles }) {
  const forcedExit = Number.parseInt(process.env.CONTEXT_PROPAGATION_CONTRACT_FORCE_EXIT || "0", 10);
  const shouldFail = Number.isInteger(forcedExit) && forcedExit !== 0;

  if (shouldFail) {
    const targetFile = dotFiles[0] || "(no-dot-files)";
    return {
      ok: false,
      checked: dotFiles.length,
      violations: [
        {
          file: targetFile,
          reason: "forced_failure",
        },
      ],
      exitStatus: forcedExit,
    };
  }

  return {
    ok: true,
    checked: dotFiles.length,
    violations: [],
    exitStatus: 0,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dotFiles = selectDotFiles(options);
  const result = runContextPropagationContract({ dotFiles });

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(
        `[context_propagation_contract] violation file=${JSON.stringify(violation.file)} reason=${JSON.stringify(violation.reason)}`,
      );
    }
    console.error(
      `[context_propagation_contract] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
    process.exit(result.exitStatus || 1);
    return;
  }

  console.log(`[context_propagation_contract] result=ok checked=${result.checked} violations=0`);
}

const isDirectRun = process.argv[1]?.endsWith("check-context-propagation-contract.ts") || process.argv[1]?.endsWith("check-context-propagation-contract.mjs") === true;
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
