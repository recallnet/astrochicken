#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analyzeLineageProjectionSamples,
  OPENLINEAGE_SAMPLES_JSON_PATH,
  OPENLINEAGE_SAMPLES_MARKDOWN_PATH,
  writeLineageProjectionSamples,
} from "./lib/lineage-projection-samples.ts";

const write = process.argv.includes("--write");
const analysis = write
  ? writeLineageProjectionSamples({ repoRoot: process.cwd() })
  : analyzeLineageProjectionSamples({
    expectedJson: safeRead(OPENLINEAGE_SAMPLES_JSON_PATH),
    expectedMarkdown: safeRead(OPENLINEAGE_SAMPLES_MARKDOWN_PATH),
  });

for (const diagnostic of analysis.diagnostics) {
  process.stdout.write(`[lineage_projection_presence] diagnostic ${diagnostic}\n`);
}
process.stdout.write(
  `[lineage_projection_presence] result=${analysis.ok ? "ok" : "fail"} diagnostics=${analysis.diagnostics.length}\n`,
);
process.exit(analysis.ok ? 0 : 1);

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
