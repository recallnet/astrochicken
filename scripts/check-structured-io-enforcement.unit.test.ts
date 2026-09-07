import assert from "node:assert/strict";
import test from "node:test";

import { analyzeStructuredIoEnforcement } from "./check-structured-io-enforcement.ts";

test("structured IO enforcement passes when release nodes declare contracts", () => {
  const dot = `
    digraph x {
      build_release_report_context [action_output_contract="release.report_context@v1"]
      publish_release_report [action_context_b64="\${x}" action_narrative_b64="\${y}" action_input_contract="release.report_context@v1+release.narrative@v1" action_output_contract="release.report_issue_delivery@v1"]
      create_shaping_followup_issue [action_context_b64="\${x}" action_narrative_b64="\${y}" action_input_contract="release.report_context@v1+release.narrative@v1" action_output_contract="release.shaping_followup_delivery@v1"]
      build_release_slack_blocks [action_context_b64="\${x}" action_narrative_b64="\${y}" action_input_contract="release.report_context@v1+release.narrative@v1" action_output_contract="release.slack_payload@v1"]
      post_release_to_slack [action_context_b64="\${x}" action_payload_b64="\${y}" action_input_contract="release.report_context@v1+release.slack_payload@v1" action_output_contract="release.slack_delivery@v1"]
      update_release_dedup_cursor [action_context_b64="\${x}" action_delivery_status="\${y}" action_input_contract="release.report_context@v1+release.delivery_status@v1" action_output_contract="release.dedup_cursor_update@v1"]
    }
  `;

  const result = analyzeStructuredIoEnforcement({ dot });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("structured IO enforcement fails when release nodes lack declared contracts", () => {
  const dot = `
    digraph x {
      build_release_report_context [label="x"]
      publish_release_report [action_context_b64="\${x}" action_narrative_b64="\${y}"]
      create_shaping_followup_issue [action_context_b64="\${x}" action_narrative_b64="\${y}"]
      build_release_slack_blocks [action_context_b64="\${x}" action_narrative_b64="\${y}"]
      post_release_to_slack [action_context_b64="\${x}" action_payload_b64="\${y}"]
      update_release_dedup_cursor [action_context_b64="\${x}" action_delivery_status="\${y}"]
    }
  `;

  const result = analyzeStructuredIoEnforcement({ dot });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((entry) => entry.node_id === "build_release_report_context" && entry.code === "missing_action_output_contract"));
  assert.ok(result.violations.some((entry) => entry.node_id === "publish_release_report" && entry.code === "missing_action_input_contract"));
});

test("structured IO enforcement passes on rendered workflow source graph", async () => {
  const { loadGraphSemanticsText } = await import("./lib/load-graph-semantics.ts");
  const result = analyzeStructuredIoEnforcement({
    dot: loadGraphSemanticsText("packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs"),
  });
  assert.equal(result.ok, true);
});
