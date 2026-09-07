#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const GITHUB_TRUTH_READ_REPORT_JSON_PATH = "docs/contracts/github-truth-read-inventory.json";
export const GITHUB_TRUTH_READ_REPORT_MARKDOWN_PATH = "docs/contracts/github-truth-read-inventory.md";

const ALLOWED_OWNER_PATH_PREFIXES = Object.freeze([
  "packages/github-adapter/src/",
]);

const EXECUTION_CRITICAL_SCOPE_PATHS = new Set([
  "packages/factory-ops/src/commands/factory-fleet-status.ts",
  "packages/factory-ops/src/commands/factory-status.ts",
  "packages/factory-ops/src/commands/factory-subscribe.ts",
  "packages/factory-ops/src/commands/factory-tick-status.ts",
  "packages/factory-ops/src/commands/goal-final-state-review.ts",
  "packages/factory-ops/src/commands/goal-list-executable.ts",
  "packages/factory-ops/src/commands/goal-queue-ops.ts",
  "packages/factory-ops/src/commands/milestone-next-issue.ts",
  "packages/factory-ops/src/commands/milestone-seed-state.ts",
  "packages/factory-ops/src/commands/wave-block-ready.ts",
  "packages/factory-ops/src/commands/wave-create-ready.ts",
  "packages/factory-ops/src/commands/wave-dispatch-select.ts",
  "packages/factory-ops/src/commands/wave-filter-ready-issues.ts",
  "packages/factory-ops/src/commands/wave-find-ready.ts",
  "packages/factory-ops/src/lib/canonical-control-state.ts",
  "packages/factory-ops/src/lib/canonical-packet-projection.ts",
  "packages/factory-ops/src/lib/command-owners/wave-dispatch-select.ts",
  "packages/factory-ops/src/lib/factory-fleet-canonical.ts",
  "packages/factory-ops/src/lib/factory-fleet-postgres-projection.ts",
  "packages/factory-ops/src/lib/factory-status-canonical.ts",
  "packages/factory-ops/src/lib/factory-status-postgres-projection.ts",
  "packages/factory-ops/src/lib/factory-tick-canonical.ts",
  "packages/factory-ops/src/lib/factory-tick-postgres-projection.ts",
  "packages/factory-ops/src/lib/run-inspection.ts",
  "packages/factory-ops/src/lib/supervisor-state-snapshot-packet-first.ts",
]);

const OPERATION_DETECTORS = Object.freeze([
  {
    id: "gh_issue_view",
    label: "gh issue view",
    pattern:
      /(?:ghJson(?:Fn)?|gh|ghFn)\(\s*\[\s*["']issue["']\s*,\s*["']view["']|(?:spawnSync(?:Fn)?|runner|execFileSync)\(\s*["']gh["']\s*,\s*\[\s*["']issue["']\s*,\s*["']view["']/gms,
  },
  {
    id: "gh_issue_list",
    label: "gh issue list",
    pattern:
      /(?:ghJson(?:Fn)?|gh|ghFn)\(\s*\[\s*["']issue["']\s*,\s*["']list["']|(?:spawnSync(?:Fn)?|runner|execFileSync)\(\s*["']gh["']\s*,\s*\[\s*["']issue["']\s*,\s*["']list["']/gms,
  },
  {
    id: "gh_api_graphql",
    label: "GraphQL",
    pattern:
      /(?:ghJson(?:Fn)?|gh|ghFn)\(\s*\[\s*["']api["']\s*,\s*["']graphql["']|(?:spawnSync(?:Fn)?|runner|execFileSync)\(\s*["']gh["']\s*,\s*\[\s*["']api["']\s*,\s*["']graphql["']/gms,
  },
  {
    id: "gh_api",
    label: "gh api",
    pattern:
      /(?:ghJson(?:Fn)?|gh|ghFn)\(\s*\[\s*["']api["']\s*,\s*(?:["'](?!graphql["'])[^"']+["']|`[^`]+`)|(?:spawnSync(?:Fn)?|runner|execFileSync)\(\s*["']gh["']\s*,\s*\[\s*["']api["']\s*,\s*(?:["'](?!graphql["'])[^"']+["']|`[^`]+`)|(?:ghJsonPaginated(?:Fn)?|ghPaginatedFn)\(/gms,
  },
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeRepoRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, path.resolve(repoRoot, targetPath)).split(path.sep).join("/");
}

function defaultReadFile(targetPath) {
  return readFileSync(targetPath, "utf8");
}

function shouldCheckFile(file) {
  const normalized = String(file || "");
  if (ALLOWED_OWNER_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return EXECUTION_CRITICAL_SCOPE_PATHS.has(normalized);
}

function countLineNumber(source, index) {
  return String(source.slice(0, index)).split("\n").length;
}

function compareStringArrays(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function sortNumbers(values = []) {
  return [...new Set(values.map((value) => Number(value)).filter(Number.isFinite))].sort((left, right) => left - right);
}

function detectOperations(source = "") {
  const operations = [];
  for (const detector of OPERATION_DETECTORS) {
    const matches = [];
    for (const match of source.matchAll(detector.pattern)) {
      matches.push({
        line: countLineNumber(source, match.index || 0),
        operation: detector.id,
        label: detector.label,
      });
    }
    if (matches.length > 0) {
      operations.push(...matches);
    }
  }
  return operations.sort((left, right) => left.line - right.line || left.operation.localeCompare(right.operation));
}

function buildAllowlistLookup(allowlistEntries = []) {
  const lookup = new Map();
  const diagnostics = [];
  for (const entry of allowlistEntries) {
    const file = String(entry?.path || "").trim();
    if (!file) {
      diagnostics.push("allowlist_entry_missing_path");
      continue;
    }
    if (lookup.has(file)) {
      diagnostics.push(`allowlist_duplicate_entry file=${JSON.stringify(file)}`);
      continue;
    }
    lookup.set(file, {
      path: file,
      operations: sortStrings(entry?.operations || []),
      owner: String(entry?.owner || "").trim(),
      justification: String(entry?.justification || "").trim(),
    });
  }
  return { lookup, diagnostics };
}

export function loadGitHubTruthReadAllowlist({
  allowlistPath = "",
  readFile = defaultReadFile,
} = {}) {
  if (!allowlistPath || !existsSync(allowlistPath)) {
    return {
      schema_version: "github_truth_read_allowlist/v1",
      owner: "permanent execution-critical scope",
      entries: [],
    };
  }
  const parsed = JSON.parse(readFile(allowlistPath));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return {
    schema_version: String(parsed?.schema_version || ""),
    owner: String(parsed?.owner || ""),
    entries: entries.map((entry) => ({
      path: String(entry?.path || ""),
      operations: sortStrings(entry?.operations || []),
      owner: String(entry?.owner || ""),
      justification: String(entry?.justification || ""),
    })),
  };
}

export function renderGitHubTruthReadInventoryMarkdown(report) {
  const lines = [
    "# GitHub Truth-Read Inventory",
    "",
    "Checked-in inventory for execution-critical runtime GitHub reads outside `packages/github-adapter`.",
    "",
    `- Files scanned: ${report.summary.files_scanned}`,
    `- Allowlisted findings: ${report.summary.allowlisted_findings}`,
    `- Unallowlisted findings: ${report.summary.unallowlisted_findings}`,
    `- Stale allowlist entries: ${report.summary.stale_allowlist_entries}`,
    "",
    "| Path | Operations | Allowlisted | Owner | Justification |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const entry of report.inventory) {
    lines.push(
      `| \`${entry.path}\` | \`${entry.operations.join(", ")}\` | ${entry.allowlisted ? "yes" : "no"} | ${entry.owner || ""} | ${entry.justification || ""} |`,
    );
  }

  if (report.inventory.length === 0) {
    lines.push("| _none_ |  |  |  |  |");
  }

  return `${lines.join("\n")}\n`;
}

export function analyzeGitHubTruthReadBoundary({
  repoRoot = process.cwd(),
  files = [],
  allowlist = { entries: [] },
  readFile = defaultReadFile,
  expectedJson = null,
  expectedMarkdown = null,
} = {}) {
  const diagnostics = [];
  const { lookup: allowlistLookup, diagnostics: allowlistDiagnostics } = buildAllowlistLookup(allowlist.entries);
  diagnostics.push(...allowlistDiagnostics);

  const inventory = [];
  const actualFiles = new Set();
  let filesScanned = 0;

  for (const file of sortStrings(files)) {
    const relativePath = normalizeRepoRelative(repoRoot, file);
    if (!shouldCheckFile(relativePath)) {
      continue;
    }
    filesScanned += 1;
    if (ALLOWED_OWNER_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
      continue;
    }
    let source = "";
    try {
      source = readFile(path.resolve(repoRoot, relativePath));
    } catch (error) {
      diagnostics.push(`unreadable_file file=${JSON.stringify(relativePath)} error=${JSON.stringify(String(error?.message || error))}`);
      continue;
    }
    const matches = detectOperations(source);
    if (matches.length === 0) {
      continue;
    }

    const operations = sortStrings(matches.map((entry) => entry.operation));
    const allowlisted = allowlistLookup.get(relativePath);
    actualFiles.add(relativePath);

    inventory.push({
      path: relativePath,
      operations,
      lines: sortNumbers(matches.map((entry) => entry.line)),
      allowlisted: Boolean(allowlisted),
      owner: allowlisted?.owner || "",
      justification: allowlisted?.justification || "",
    });

    if (!allowlisted) {
      diagnostics.push(
        `unallowlisted_execution_critical_github_truth_read file=${JSON.stringify(relativePath)} operations=${JSON.stringify(operations)}`,
      );
      continue;
    }
    if (!compareStringArrays(allowlisted.operations, operations)) {
      diagnostics.push(
        `allowlist_operation_drift file=${JSON.stringify(relativePath)} expected=${JSON.stringify(allowlisted.operations)} actual=${JSON.stringify(operations)}`,
      );
    }
  }

  for (const entry of allowlist.entries || []) {
    if (!actualFiles.has(entry.path)) {
      diagnostics.push(`stale_allowlist_entry file=${JSON.stringify(entry.path)}`);
    }
  }

  inventory.sort((left, right) => left.path.localeCompare(right.path));
  const report = {
    schema_version: "github_truth_read_inventory/v1",
    generated_at: "checked-in",
    summary: {
      files_scanned: filesScanned,
      allowlisted_findings: inventory.filter((entry) => entry.allowlisted).length,
      unallowlisted_findings: inventory.filter((entry) => !entry.allowlisted).length,
      stale_allowlist_entries: diagnostics.filter((entry) => entry.startsWith("stale_allowlist_entry ")).length,
    },
    inventory,
  };
  const rendered_json = stableJson(report);
  const rendered_markdown = renderGitHubTruthReadInventoryMarkdown(report);

  if (typeof expectedJson === "string" && expectedJson !== rendered_json) {
    diagnostics.push(`inventory_json_drift path=${JSON.stringify(GITHUB_TRUTH_READ_REPORT_JSON_PATH)}`);
  }
  if (typeof expectedMarkdown === "string" && expectedMarkdown !== rendered_markdown) {
    diagnostics.push(`inventory_markdown_drift path=${JSON.stringify(GITHUB_TRUTH_READ_REPORT_MARKDOWN_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    rendered_json,
    rendered_markdown,
  };
}

export function loadCheckedInGitHubTruthReadArtifacts({
  readFile = defaultReadFile,
  jsonPath = GITHUB_TRUTH_READ_REPORT_JSON_PATH,
  markdownPath = GITHUB_TRUTH_READ_REPORT_MARKDOWN_PATH,
} = {}) {
  return {
    json: existsSync(jsonPath) ? readFile(jsonPath) : null,
    markdown: existsSync(markdownPath) ? readFile(markdownPath) : null,
  };
}

function collectTrackedFiles(repoRoot = process.cwd()) {
  return String(execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" }) || "")
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(path.resolve(repoRoot, file)));
}

function parseArgs(argv = []) {
  const options = {
    allTracked: false,
    files: [],
    json: false,
    write: false,
    allowlistPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current) continue;
    if (current === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    if (current === "--json") {
      options.json = true;
      continue;
    }
    if (current === "--write") {
      options.write = true;
      continue;
    }
    if (current === "--allowlist" && index + 1 < argv.length) {
      options.allowlistPath = String(argv[index + 1] || "");
      index += 1;
      continue;
    }
    options.files.push(current);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = options.allTracked || options.files.length === 0 ? collectTrackedFiles(process.cwd()) : options.files;
  const allowlist = loadGitHubTruthReadAllowlist({ allowlistPath: options.allowlistPath });
  const checkedIn = loadCheckedInGitHubTruthReadArtifacts();
  const analysis = analyzeGitHubTruthReadBoundary({
    repoRoot: process.cwd(),
    files,
    allowlist,
    expectedJson: options.write ? null : checkedIn.json,
    expectedMarkdown: options.write ? null : checkedIn.markdown,
  });

  if (options.write) {
    writeFileSync(GITHUB_TRUTH_READ_REPORT_JSON_PATH, analysis.rendered_json);
    writeFileSync(GITHUB_TRUTH_READ_REPORT_MARKDOWN_PATH, analysis.rendered_markdown);
    process.stdout.write(
      `[github_truth_read_boundary] result=ok files=${analysis.report.summary.files_scanned} allowlisted=${analysis.report.summary.allowlisted_findings} unallowlisted=${analysis.report.summary.unallowlisted_findings} stale=${analysis.report.summary.stale_allowlist_entries} wrote=true\n`,
    );
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    process.exitCode = analysis.ok ? 0 : 1;
    return;
  }

  for (const diagnostic of analysis.diagnostics) {
    process.stdout.write(`[github_truth_read_boundary] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(
    `[github_truth_read_boundary] result=${analysis.ok ? "ok" : "fail"} files=${analysis.report.summary.files_scanned} allowlisted=${analysis.report.summary.allowlisted_findings} unallowlisted=${analysis.report.summary.unallowlisted_findings} stale=${analysis.report.summary.stale_allowlist_entries} diagnostics=${analysis.diagnostics.length}\n`,
  );
  process.exitCode = analysis.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith("check-github-truth-read-boundary.ts") || process.argv[1]?.endsWith("check-github-truth-read-boundary.mjs")) {
  // @context:decision !critical Commit 17 removes the migration residual
  // allowlist. The permanent boundary scans only the execution-critical
  // canonical-truth surfaces, so the checked-in inventory must stay empty and
  // any new GitHub truth read there is an immediate structural regression.
  main();
}
