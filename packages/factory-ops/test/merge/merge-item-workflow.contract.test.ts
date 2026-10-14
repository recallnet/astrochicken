import { assertWorkflowEdgeChain as assertEdgeChain } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { readCapabilityMergeGraphDot } from "../../src/lib/merge-capability.ts";

// ── Graph contract: state machine exhaustiveness ──────────────

test("merge_item.dot handles all attemptDeterministicMerge status values", () => {
  const dot = readCapabilityMergeGraphDot();
  const MERGE_STATUSES = ["merged", "already_merged", "conflict", "error"];

  for (const status of MERGE_STATUSES) {
    assert.match(dot, new RegExp(`merge_status=${status}`),
      `merge_item.dot must handle merge_status=${status}`);
  }
  assert.match(dot, /rebase_status=ready/);
  assert.match(dot, /rebase_status!=ready/);
  assert.match(dot, /resolution_source/);
  assert.match(dot, /merge_gate -> set_resolution_source_llm \[condition="merge_status=conflict"\]/);
  assert.match(dot, /route_error_to_resolver -> set_resolution_source_llm/);
});

test("merge_item.dot handles all resolution_status values", () => {
  const dot = readCapabilityMergeGraphDot();
  // resolved → set_status_merged, not-resolved → set_status_failed
  assert.match(dot, /resolution_status=resolved/);
  assert.match(dot, /resolution_status!=resolved/);
});

test("merge_item.dot conflict path is complete: packet → resolve → verify → gate", () => {
  const dot = readCapabilityMergeGraphDot();
  assertEdgeChain(dot, ["build_conflict_packet", "resolve_conflict", "finalize_merge_commit", "finalize_gate"]);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
});

test("merge_item.dot cleanup runs on failed resolution", () => {
  const dot = readCapabilityMergeGraphDot();
  assert.match(dot, /set_status_failed -> cleanup_failed_merge/);
  assert.match(dot, /cleanup_failed_merge -> encode_integration_command/);
  assert.match(dot, /encode_integration_command -> integration/);
});
