#!/usr/bin/env node

import { loadGraphSemanticsText } from "./lib/load-graph-semantics.ts";

const ENFORCED_GRAPH = "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs";
const NODE_IDS = Object.freeze([
  "build_release_report_context",
  "publish_release_report",
  "create_shaping_followup_issue",
  "build_release_slack_blocks",
  "post_release_to_slack",
  "update_release_dedup_cursor",
]);

function extractNodeBlock(dot, nodeId) {
  const start = dot.indexOf(`${nodeId} [`);
  if (start === -1) return "";
  let depth = 0;
  for (let index = start; index < dot.length; index += 1) {
    const char = dot[index];
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return dot.slice(start, index + 1);
    }
  }
  return "";
}

export function analyzeStructuredIoEnforcement({ dot }) {
  const content = String(dot || "");
  const violations = [];

  for (const nodeId of NODE_IDS) {
    const block = extractNodeBlock(content, nodeId);
    if (!block) {
      violations.push({ node_id: nodeId, code: "missing_node" });
      continue;
    }
    if (!/action_output_contract="/.test(block)) {
      violations.push({ node_id: nodeId, code: "missing_action_output_contract" });
    }
    if (/action_(?:context|narrative|payload|delivery_status)(?:_b64)?="/.test(block) && !/action_input_contract="/.test(block)) {
      violations.push({ node_id: nodeId, code: "missing_action_input_contract" });
    }
  }

  return {
    schema_version: "structured_io_enforcement/v1",
    ok: violations.length === 0,
    graph: ENFORCED_GRAPH,
    violations,
  };
}

function main() {
  const dot = loadGraphSemanticsText(ENFORCED_GRAPH);
  const result = analyzeStructuredIoEnforcement({ dot });
  for (const violation of result.violations) {
    process.stdout.write(`[structured-io] fail graph=${ENFORCED_GRAPH} node=${violation.node_id} code=${violation.code}\n`);
  }
  process.stdout.write(`[structured-io] result=${result.ok ? "ok" : "fail"} graph=${ENFORCED_GRAPH} violations=${result.violations.length}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("check-structured-io-enforcement.ts") || process.argv[1]?.endsWith("check-structured-io-enforcement.mjs")) {
  main();
}
