#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { loadActiveSurfaceManifest, selectManifestScopedFiles } from "./lib/active-surface-manifest.ts";
import { PHASE1_GATE_SCOPE_CONTRACT } from "./lib/phase1-gate-scope-contract.ts";

const DOT_FILE_PATTERN = /\.dot$/;
const SOURCE_FILE_PATTERN = /\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const INTERNAL_CLI_PATTERN = /\bhatch-ops\b|packages\/factory-ops\/src\/cli\.mjs|factories\/mothership\/ops\/src\/cli\.mjs/;
const CHILD_PROCESS_PATTERN = /\b(?:spawn|spawnSync|exec|execSync)\s*\(/;
const GRAPH_TYPED_ACTION_TRANSPORT_MODE_RE = /\btyped_action_transport_mode\s*=\s*"?([a-z_]+)"?/i;
const TYPED_ACTION_TRANSPORT_ENFORCED = "enforced";

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readPathList(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\0").filter(Boolean);
}

function collectTrackedFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "").split("\0").filter(Boolean);
}

function countMatches(content = "", pattern) {
  const matches = content.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  return Array.isArray(matches) ? matches.length : 0;
}

function graphTypedActionTransportMode(content = "") {
  const match = content.match(GRAPH_TYPED_ACTION_TRANSPORT_MODE_RE);
  return String(match?.[1] || "").trim().toLowerCase();
}

export function analyzeInternalCliTransport({
  files = [],
  readFile = defaultReadFile,
  failOptedInGraphs = false,
  failActiveGraphs = false,
  manifest = null,
  activeGraphManifestClassifications = [],
} = {}) {
  const scopedFiles = manifest && Array.isArray(activeGraphManifestClassifications) && activeGraphManifestClassifications.length > 0
    ? selectManifestScopedFiles({
      manifest,
      files,
      surfaceType: "graph",
      classifications: activeGraphManifestClassifications,
    })
      .concat(files.filter((file) => SOURCE_FILE_PATTERN.test(file)))
    : files;
  const violations = [];
  let checked = 0;
  let optedInGraphFailures = 0;
  let activeGraphFailures = 0;

  for (const file of scopedFiles) {
    if (!DOT_FILE_PATTERN.test(file) && !SOURCE_FILE_PATTERN.test(file)) continue;

    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }

    checked += 1;

    if (DOT_FILE_PATTERN.test(file)) {
      const transportMode = graphTypedActionTransportMode(content);
      const internalCliCalls = countMatches(content, /\bhatch-ops\b/g)
        + countMatches(content, /packages\/factory-ops\/src\/cli\.mjs/g)
        + countMatches(content, /factories\/mothership\/ops\/src\/cli\.mjs/g);
      if (internalCliCalls > 0) {
        const optedIn = transportMode === TYPED_ACTION_TRANSPORT_ENFORCED;
        const activeGraphFailure = failActiveGraphs;
        if (failOptedInGraphs && optedIn) optedInGraphFailures += 1;
        if (activeGraphFailure) activeGraphFailures += 1;
        violations.push({
          file,
          kind: "graph_internal_cli_transport",
          internal_cli_calls: internalCliCalls,
          typed_action_transport_mode: transportMode || "legacy",
          opted_in_graph_failure: failOptedInGraphs && optedIn,
          active_graph_failure: activeGraphFailure,
        });
      }
      continue;
    }

    const hasChildProcess = CHILD_PROCESS_PATTERN.test(content);
    const hasInternalCliReference = INTERNAL_CLI_PATTERN.test(content);
    if (hasChildProcess && hasInternalCliReference) {
      violations.push({
        file,
        kind: "runtime_internal_cli_transport",
        internal_cli_calls: countMatches(content, INTERNAL_CLI_PATTERN),
      });
    }
  }

  const summary = {
    graph_internal_cli_transport: violations.filter((entry) => entry.kind === "graph_internal_cli_transport").length,
    runtime_internal_cli_transport: violations.filter((entry) => entry.kind === "runtime_internal_cli_transport").length,
    opted_in_graph_internal_cli_transport: optedInGraphFailures,
    active_graph_internal_cli_transport: activeGraphFailures,
  };

  return {
    schema_version: "internal_cli_transport_inventory/v1",
    ok: optedInGraphFailures === 0 && activeGraphFailures === 0,
    checked,
    summary,
    violations,
  };
}

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  const fileListPath = argValue(args, "--file-list");
  const allTracked = args.includes("--all-tracked");
  const jsonOutput = args.includes("--json");
  const failOptedInGraphs = args.includes("--fail-opted-in-graphs");
  const failActiveGraphs = args.includes("--fail-active-graphs");
  const activeGraphsOnly = args.includes("--active-graphs-only");

  if (allTracked && fileListPath) {
    throw new Error("Use only one input mode: --file-list or --all-tracked");
  }

  const files = allTracked ? collectTrackedFiles() : readPathList(fileListPath);
  const result = analyzeInternalCliTransport({
    files,
    failOptedInGraphs,
    failActiveGraphs,
    ...(activeGraphsOnly
      ? {
        manifest: loadActiveSurfaceManifest(),
        activeGraphManifestClassifications: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.classifications,
      }
      : {}),
  });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
    return;
  }

  for (const violation of result.violations) {
    process.stdout.write(
      `[internal-cli-transport] inventory kind=${violation.kind} file=${JSON.stringify(violation.file)} count=${violation.internal_cli_calls} transport_mode=${violation.typed_action_transport_mode || "n/a"} opted_in_failure=${violation.opted_in_graph_failure === true}\n`,
    );
  }
  process.stdout.write(
    `[internal-cli-transport] result=${result.ok ? "ok" : "fail"} checked=${result.checked} graph=${result.summary.graph_internal_cli_transport} runtime=${result.summary.runtime_internal_cli_transport} opted_in_graph=${result.summary.opted_in_graph_internal_cli_transport} active_graph=${result.summary.active_graph_internal_cli_transport}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-internal-cli-transport.ts") || process.argv[1]?.endsWith("check-internal-cli-transport.mjs")) {
  main();
}
