import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import {
  analyzePhase1BurndownArtifacts,
  loadCheckedInPhase1BurndownArtifacts,
  PHASE1_BURNDOWN_INVENTORY_JSON_PATH,
  PHASE1_BURNDOWN_INVENTORY_MARKDOWN_PATH,
} from "./lib/phase1-burndown-finalization.ts";

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\u0000").filter(Boolean).sort();
}

function run(argv = process.argv.slice(2)) {
  const write = argv.includes("--write");
  const artifacts = loadCheckedInPhase1BurndownArtifacts();
  const analysis = analyzePhase1BurndownArtifacts({
    files: trackedFiles(),
    expectedJson: artifacts.json,
    expectedMarkdown: artifacts.markdown,
  });

  if (write) {
    writeFileSync(PHASE1_BURNDOWN_INVENTORY_JSON_PATH, analysis.rendered_json);
    writeFileSync(PHASE1_BURNDOWN_INVENTORY_MARKDOWN_PATH, analysis.rendered_markdown);
    process.stdout.write(`[phase1-burndown-finalization] result=ok phase1_targets=${analysis.audit.summary.phase1_targets} out_of_scope=${analysis.audit.summary.out_of_scope_targets} diagnostics=${analysis.audit.summary.diagnostics} wrote=true\n`);
    return;
  }

  for (const diagnostic of analysis.diagnostics) {
    process.stderr.write(`[phase1-burndown-finalization] diagnostic ${diagnostic}\n`);
  }
  process.stdout.write(`[phase1-burndown-finalization] result=${analysis.ok ? "ok" : "fail"} phase1_targets=${analysis.audit.summary.phase1_targets} out_of_scope=${analysis.audit.summary.out_of_scope_targets} diagnostics=${analysis.diagnostics.length}\n`);
  process.exitCode = analysis.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith("check-phase1-burndown-finalization.ts") || process.argv[1]?.endsWith("check-phase1-burndown-finalization.mjs")) {
  run();
}
