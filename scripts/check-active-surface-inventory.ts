#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  ACTIVE_SURFACE_INVENTORY_JSON_PATH,
  ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH,
  buildActiveSurfaceInventory,
  renderActiveSurfaceInventoryMarkdown,
} from "./lib/active-surface-inventory.ts";

function collectTrackedFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "").split("\0").filter(Boolean).filter((file) => existsSync(file));
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function analyzeActiveSurfaceInventory({
  repoRoot = process.cwd(),
  files = collectTrackedFiles({ cwd: repoRoot }),
} = {}) {
  const inventory = buildActiveSurfaceInventory({ repoRoot, files });
  const expectedJson = stringifyJson(inventory);
  const expectedMarkdown = renderActiveSurfaceInventoryMarkdown(inventory);
  const currentJson = readText(ACTIVE_SURFACE_INVENTORY_JSON_PATH);
  const currentMarkdown = readText(ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH);
  const diagnostics = [...inventory.diagnostics];

  if (currentJson !== expectedJson) {
    diagnostics.push(`inventory_json_drift path=${JSON.stringify(ACTIVE_SURFACE_INVENTORY_JSON_PATH)}`);
  }
  if (currentMarkdown !== expectedMarkdown) {
    diagnostics.push(`inventory_markdown_drift path=${JSON.stringify(ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH)}`);
  }

  return {
    schema_version: "active_surface_inventory_check/v1",
    ok: diagnostics.length === 0,
    inventory_json_path: ACTIVE_SURFACE_INVENTORY_JSON_PATH,
    inventory_markdown_path: ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH,
    summary: inventory.summary,
    diagnostics,
    inventory,
    expected_json: expectedJson,
    expected_markdown: expectedMarkdown,
  };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const jsonOutput = args.includes("--json");
  const result = analyzeActiveSurfaceInventory();

  if (write) {
    writeFileSync(ACTIVE_SURFACE_INVENTORY_JSON_PATH, result.expected_json, "utf8");
    writeFileSync(ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH, result.expected_markdown, "utf8");
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({
      schema_version: result.schema_version,
      ok: result.ok,
      inventory_json_path: result.inventory_json_path,
      inventory_markdown_path: result.inventory_markdown_path,
      summary: result.summary,
      diagnostics: result.diagnostics,
    }, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  for (const diagnostic of result.diagnostics) {
    process.stdout.write(`[active-surface-inventory] fail ${diagnostic}\n`);
  }
  process.stdout.write(
    `[active-surface-inventory] result=${result.ok ? "ok" : "fail"} roots=${result.summary.live_graph_roots} graphs=${result.summary.active_graphs} runtime=${result.summary.active_runtime_files} commands=${result.summary.active_command_reachable_files} diagnostics=${result.diagnostics.length}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-active-surface-inventory.ts") || process.argv[1]?.endsWith("check-active-surface-inventory.mjs")) {
  main();
}
