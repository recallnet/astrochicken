#!/usr/bin/env node
/**
 * Validates that pnpm-lock.yaml is in sync with all workspace package.json files.
 *
 * Catches the class of bug where a workspace package name or path changes but
 * pnpm-lock.yaml is not regenerated. This passes locally with stale installs
 * but fails deterministic pnpm bootstrap in CI and disposable worktrees.
 *
 * Exit 0 = sync, Exit 1 = drift detected.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lockfileHasImporter(lockfileText = "", importerPath = "") {
  const pattern = new RegExp(`(?:^|\\n)\\s{2}${escapeRegExp(importerPath)}:\\s*(?:\\{\\}|\\n)`, "m");
  return pattern.test(lockfileText);
}

function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lockfileText = readFileSync("pnpm-lock.yaml", "utf8");
  const errors = [];

  for (const wsGlob of pkg.workspaces || []) {
    const wsDir = wsGlob.replace(/\/\*$/, "");
    let entries;
    try {
      entries = readdirSync(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsPkgPath = join(wsDir, entry.name, "package.json");
      if (!existsSync(wsPkgPath)) continue;

      const wsMeta = JSON.parse(readFileSync(wsPkgPath, "utf8"));
      const wsName = wsMeta.name;
      if (!wsName) continue;

      const importerKey = join(wsDir, entry.name).replace(/\\/g, "/");
      if (!lockfileHasImporter(lockfileText, importerKey)) {
        errors.push(`workspace "${wsName}" (${importerKey}) missing from pnpm-lock.yaml`);
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`[lockfile-sync] result=fail errors=${errors.length}\n`);
    for (const err of errors) {
      process.stderr.write(`  ${err}\n`);
    }
    process.stderr.write("[lockfile-sync] run `pnpm install` to regenerate pnpm-lock.yaml\n");
    process.exit(1);
  }

  process.stdout.write("[lockfile-sync] result=ok errors=0\n");
}

main();
