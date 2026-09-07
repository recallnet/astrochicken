#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  let factoryId = "mothership";
  let hatchDir = ".hatch";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--factory-id" && argv[i + 1]) {
      factoryId = String(argv[++i] || "").trim() || "mothership";
      continue;
    }
    if (arg.startsWith("--factory-id=")) {
      factoryId = String(arg.slice("--factory-id=".length) || "").trim() || "mothership";
      continue;
    }
    if (arg === "--hatch-dir" && argv[i + 1]) {
      hatchDir = String(argv[++i] || "").trim() || ".hatch";
      continue;
    }
    if (arg.startsWith("--hatch-dir=")) {
      hatchDir = String(arg.slice("--hatch-dir=".length) || "").trim() || ".hatch";
      continue;
    }
    throw new Error(`unknown flag: ${arg}`);
  }

  return { factoryId, hatchDir };
}

function main() {
  const { factoryId, hatchDir } = parseArgs(process.argv.slice(2));
  const hatchRoot = resolve(process.cwd(), hatchDir);
  const sourceRunsDir = join(hatchRoot, "runs");
  const targetRunsDir = join(hatchRoot, factoryId, "runs");

  if (!existsSync(sourceRunsDir)) {
    console.log(`[migrate-runs] source missing, nothing to migrate: ${sourceRunsDir}`);
    return;
  }

  mkdirSync(targetRunsDir, { recursive: true });

  const entries = readdirSync(sourceRunsDir);
  let moved = 0;
  let skipped = 0;

  for (const entry of entries) {
    const sourcePath = join(sourceRunsDir, entry);
    const targetPath = join(targetRunsDir, entry);

    if (existsSync(targetPath)) {
      console.log(`[migrate-runs] skip existing target: ${targetPath}`);
      skipped += 1;
      continue;
    }

    const sourceStat = statSync(sourcePath);
    if (!sourceStat.isDirectory() && !sourceStat.isFile()) {
      console.log(`[migrate-runs] skip unsupported entry: ${sourcePath}`);
      skipped += 1;
      continue;
    }

    renameSync(sourcePath, targetPath);
    console.log(`[migrate-runs] moved ${sourcePath} -> ${targetPath}`);
    moved += 1;
  }

  console.log(`[migrate-runs] complete factory_id=${factoryId} moved=${moved} skipped=${skipped}`);
}

main();
