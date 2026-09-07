#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { main } from "./lib/check-harness.ts";
import { loadGraphSemanticsText } from "./lib/load-graph-semantics.ts";

export const GOAL_PACKET_CONTRACT_FILES = Object.freeze([
  {
    path: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    checks: [
      /persist_decomposition_packet/,
      /action_id="goal\.persist_decomposition_packet"/,
      /duplicate_decompose_guard \[type="tool" governance="irreversible" action_runtime="in_process" action_id="goal\.guard_duplicate_decompose"/,
      /duplicate_decompose_guard \[(?=[^\]]*action_repo_root="\$\{repo\}")(?=[^\]]*action_factory_id="\$\{factory_id\}")[^\]]*\]/,
    ],
  },
  {
    path: "docs/skills/factory-design/templates/role-definitions.md",
    checks: [
      /goal_decomposition_packet/,
      /durable decomposition ledger/i,
    ],
  },
]);

export function analyzeGoalPacketContract(files = GOAL_PACKET_CONTRACT_FILES) {
  const diagnostics = [];
  for (const file of files) {
    const body = String(file.path).endsWith(".workflow-source.mjs")
      ? loadGraphSemanticsText(file.path)
      : readFileSync(file.path, "utf8");
    for (const pattern of file.checks) {
      if (!pattern.test(body)) {
        diagnostics.push({
          file: file.path,
          pattern: String(pattern),
        });
      }
    }
  }
  return diagnostics;
}

function checkGoalPacketContract() {
  const diagnostics = analyzeGoalPacketContract().map(
    (diagnostic) => `[goal-packet-contract] missing file=${diagnostic.file} pattern=${diagnostic.pattern}`,
  );
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    files: GOAL_PACKET_CONTRACT_FILES.length,
  };
}

const isDirectRun = process.argv[1]?.endsWith("check-goal-packet-contract.ts") || process.argv[1]?.endsWith("check-goal-packet-contract.mjs") === true;
if (isDirectRun) {
  main(checkGoalPacketContract, {
    gate: "goal-packet-contract",
    okMessage: (_args, result) => `files=${result.files}`,
  });
}
