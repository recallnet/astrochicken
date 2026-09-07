import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import {
  analyzePhase1OwnershipArtifacts,
  loadCheckedInPhase1OwnershipArtifacts,
  PHASE1_OWNERSHIP_MAP_MARKDOWN_PATH,
} from "./lib/phase1-ownership-map.ts";

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\u0000").filter(Boolean).sort();
}

function run(argv = process.argv.slice(2)) {
  const write = argv.includes("--write");
  const artifacts = loadCheckedInPhase1OwnershipArtifacts();
  const analysis = analyzePhase1OwnershipArtifacts({
    files: trackedFiles(),
    expectedMarkdown: artifacts.markdown,
  });

  if (write) {
    writeFileSync(PHASE1_OWNERSHIP_MAP_MARKDOWN_PATH, analysis.rendered_markdown);
    process.stdout.write(`[phase1-ownership-map] result=ok active=${analysis.audit.summary.active_targets} legacy=${analysis.audit.summary.legacy_targets} diagnostics=${analysis.audit.summary.diagnostics} wrote=true\n`);
    return;
  }

  for (const diagnostic of analysis.diagnostics) {
    process.stderr.write(`[phase1-ownership-map] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(`[phase1-ownership-map] result=${analysis.ok ? "ok" : "fail"} active=${analysis.audit.summary.active_targets} legacy=${analysis.audit.summary.legacy_targets} diagnostics=${analysis.diagnostics.length}\n`);
  process.exitCode = analysis.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith("check-phase1-ownership-map.ts") || process.argv[1]?.endsWith("check-phase1-ownership-map.mjs")) {
  run();
}
