#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lib/check-harness.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const FACTORY_TEMPLATE_PACKET_CONTRACT_FILES = [
  {
    path: resolve(REPO_ROOT, "factories/_templates/factory/graphs/factory_supervisor_tick.dot.template"),
    checks: [
      /named packet/i,
      /packet_path, packet_id, packet_type, and schema_version/i,
      /recovery_owner="supervisor"/,
      /recovery_sink_type="wait"/,
    ],
  },
  {
    path: resolve(REPO_ROOT, "docs/skills/factory-design/templates/subgraph-production-line.dot"),
    checks: [
      /build_review_recovery_packet/,
      /build_judge_context_recovery_packet/,
      /build_judge_failure_packet/,
      /build_merge_recovery_packet/,
      /recovery_wait \[type="wait\.human" recovery_owner="supervisor" recovery_sink_type="wait"/,
    ],
    rejects: [
      /report_review_failed -> done/,
      /report_judge_context_failed -> done/,
      /report_judge_failed -> done/,
    ],
  },
  {
    path: resolve(REPO_ROOT, "docs/skills/factory-design/templates/role-definitions.md"),
    checks: [
      /named packet family/i,
      /freeform agent-to-agent messaging remains allowed/i,
      /emit a named durable recovery packet before cleanup/i,
      /packet recovery sink/i,
      /goal_decomposition_packet/i,
      /durable decomposition ledger/i,
    ],
  },
  {
    path: resolve(REPO_ROOT, "packages/factory-skills/skills/merge_conflict_resolver/SKILL.md"),
    checks: [
      /\.hatch\/<factory_id>\/runs\/<run_id>\/packets\/merge_conflict_packet\/<packet_id>\.json/,
      /Treat the packet as the recovery map/i,
    ],
  },
];

export function analyzeFactoryTemplatePacketContract(files = FACTORY_TEMPLATE_PACKET_CONTRACT_FILES) {
  const diagnostics = [];
  for (const file of files) {
    const body = readFileSync(file.path, "utf8");
    for (const pattern of file.checks) {
      if (!pattern.test(body)) {
        diagnostics.push({
          file: file.path,
          pattern: String(pattern),
        });
      }
    }
    for (const pattern of file.rejects || []) {
      if (pattern.test(body)) {
        diagnostics.push({
          file: file.path,
          pattern: `reject:${String(pattern)}`,
        });
      }
    }
  }
  return diagnostics;
}

function checkFactoryTemplatePacketContract() {
  const diagnostics = analyzeFactoryTemplatePacketContract().map(
    (diagnostic) => `[factory-template-packet-contract] missing file=${diagnostic.file} pattern=${diagnostic.pattern}`,
  );

  const templateDotPath = resolve(REPO_ROOT, "factories/_templates/factory/graphs/factory_supervisor_tick.dot.template");
  const roleDefinitionsPath = resolve(REPO_ROOT, "docs/skills/factory-design/templates/role-definitions.md");
  const templateDotBody = readFileSync(templateDotPath, "utf8");
  const roleDefinitionsBody = readFileSync(roleDefinitionsPath, "utf8");

  if (!templateDotBody.includes("FREEFORM-VS-PACKET BOUNDARY")) {
    diagnostics.push("[template-packet-contract] FAIL: missing freeform-vs-packet boundary comment in template DOT");
  }
  if (!(roleDefinitionsBody.includes("Allowed Freeform") && roleDefinitionsBody.includes("Must Packetize"))) {
    diagnostics.push("[template-packet-contract] FAIL: missing freeform-vs-packet boundary table in role-definitions.md");
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    files: FACTORY_TEMPLATE_PACKET_CONTRACT_FILES.length,
  };
}

const isDirectRun = process.argv[1]?.endsWith("check-factory-template-packet-contract.ts") || process.argv[1]?.endsWith("check-factory-template-packet-contract.mjs") === true;
if (isDirectRun) {
  main(checkFactoryTemplatePacketContract, {
    gate: "factory-template-packet-contract",
    okMessage: (_args, result) => `files=${result.files}`,
  });
}
