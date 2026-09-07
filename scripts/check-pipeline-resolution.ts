#!/usr/bin/env node

import { scanAndVerify } from "./lib/pipeline-resolution-gate.ts";

const result = scanAndVerify({ repoRoot: process.cwd() });

if (result.ok) {
  console.log(`[pipeline_resolution] result=ok checked=${result.total} failures=0`);
} else {
  console.error(`[pipeline_resolution] result=fail checked=${result.total} failures=${result.failures.length}`);
  for (const f of result.failures) {
    console.error(`[pipeline_resolution] broken_ref kind=${f.kind} node="${f.nodeId}" ref="${f.ref}" file="${f.filePath}"`);
    console.error(`  error: ${f.error}`);
  }
  process.exit(1);
}
