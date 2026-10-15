import { assertWorkflowEdgeChain as assertEdgeChain } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { readCapabilityMergeGraphDot, readCapabilityMergeSkillMarkdown } from "../../src/lib/merge-capability.ts";

test("merge_item escalates non-merge errors (including dirty_worktree) into resolver path", () => {
  const dot = readCapabilityMergeGraphDot();

  assert.match(dot, /merge_gate -> set_resolution_source_llm \[condition="merge_status=conflict"\]/);
  assert.match(dot, /merge_gate -> route_error_to_resolver \[condition="merge_status=error"\]/);
  assert.match(dot, /route_error_to_resolver -> set_resolution_source_llm/);
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet/);
  assertEdgeChain(dot, ["build_conflict_packet", "resolve_conflict", "finalize_merge_commit", "finalize_gate"]);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /verify_resolution \[type="tool" governance="reversible" action_runtime="in_process" action_id="merge.verify_resolution"/);
});

test("merge_item emits explicit resolution_source for deterministic and llm paths", () => {
  const dot = readCapabilityMergeGraphDot();

  assert.match(dot, /set_resolution_source_deterministic\s*\[.*output_key="resolution_source".*printf 'deterministic'/s);
  assert.match(dot, /rebase_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> attempt_merge/);
  assert.match(dot, /set_resolution_source_llm\s*\[.*output_key="resolution_source".*printf 'llm'/s);
  assert.match(dot, /rebase_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
  assert.match(dot, /merge_gate -> set_resolution_source_llm \[condition="merge_status=conflict"\]/);
  assert.match(dot, /route_error_to_resolver -> set_resolution_source_llm/);
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet/);
  assert.match(dot, /action_merge_resolver="\$\{resolution_source\}"/);
});

test("resolve_conflict node passes conflict_packet_path to the agent", () => {
  const dot = readCapabilityMergeGraphDot();

  // The resolve_conflict prompt must reference the conflict packet path
  // so the LLM agent knows where to find the conflict data.
  assert.match(dot, /resolve_conflict\b[\s\S]*?\$\{conflict_packet_path\}/,
    "resolve_conflict prompt must include ${conflict_packet_path} so the agent can find the conflict packet");
});

test("resolve_conflict node inherits model/provider from merge_resolver role defaults", () => {
  const dot = readCapabilityMergeGraphDot();

  const nodeMatch = dot.match(/resolve_conflict\s*\[([^\]]+)\]/);
  assert.ok(nodeMatch, "resolve_conflict node must exist");
  assert.match(nodeMatch[1], /class\s*=\s*"merge_resolver"/,
    "resolve_conflict must use merge_resolver role class");
});

test("merge conflict resolver skill retains packet-first guidance in capability package", () => {
  const skill = readCapabilityMergeSkillMarkdown();
  assert.match(skill, /\.hatch\/<factory_id>\/runs\/<run_id>\/packets\/merge_conflict_packet\/<packet_id>\.json/);
  assert.match(skill, /Treat the packet as the recovery map/i);
});

test("merge_item rebases branch on main before attempting merge", () => {
  const dot = readCapabilityMergeGraphDot();

  // There must be a rebase node that runs before attempt_merge
  assert.match(dot, /setup_merge_worktree/, "merge_item.dot must create a dedicated merge worktree before rebase");
  assert.match(dot, /rebase_on_main/, "merge_item.dot must have a rebase_on_main node");
  assert.match(dot, /action_id="merge.rebase_on_main"/, "rebase node must use merge.rebase_on_main typed action");

  // The flow must be: extract_merge -> setup_merge_worktree -> rebase_on_main -> rebase_gate -> attempt_merge
  assertEdgeChain(dot, ["extract_merge", "setup_merge_worktree", "rebase_on_main"],
    "merge worktree setup must happen after extract and before rebase");
  assert.match(dot, /rebase_on_main -> rebase_gate/,
    "rebase must route through rebase_gate");
  assert.match(dot, /rebase_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/,
    "ready rebase must set deterministic resolver source before merge attempt");
  assert.match(dot, /set_resolution_source_deterministic -> attempt_merge/,
    "attempt_merge must follow deterministic resolver-source assignment");

  // Rebase conflicts must route to LLM resolver path with explicit resolver source
  assert.match(dot, /rebase_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/,
    "rebase non-ready must set llm resolver source before conflict resolution");
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet/,
    "llm resolver path must build conflict packet after resolver-source assignment");
});

test("merge_item integration node uses merge run-integration command with canonical key", () => {
  const dot = readCapabilityMergeGraphDot();
  const integrationNode = dot.match(/integration\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(integrationNode, /output_key="integration_result"/);
  assert.match(integrationNode, /action_runtime="in_process"/);
  assert.match(integrationNode, /action_id="merge.run_integration"/);
  assert.match(integrationNode, /action_integration_command_b64="\$\{integration_command_b64\}"/);
  assert.doesNotMatch(integrationNode, /# hatch:no-inline-script-ok/);
  assert.doesNotMatch(integrationNode, /integration_output/);
});

test("merge_item report consumes integration_result canonical key", () => {
  const dot = readCapabilityMergeGraphDot();
  const reportNode = dot.match(/report\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(reportNode, /action_runtime="in_process"/);
  assert.match(reportNode, /action_id="merge.build_report"/);
  assert.match(reportNode, /action_notes_b64="\$\{merge_notes_b64\}"/);
  assert.match(reportNode, /action_integration_result="\$\{integration_result\}"/);
  assert.match(reportNode, /action_merge_resolver="\$\{resolution_source\}"/);
  assert.match(reportNode, /action_path_taken="merge"/);
  assert.doesNotMatch(reportNode, /integration_output/);
});

test("merge_item integration path remains non-blocking in graph routing", () => {
  const dot = readCapabilityMergeGraphDot();
  assert.match(dot, /set_status_merged -> encode_integration_command/);
  assert.match(dot, /set_status_already -> encode_integration_command/);
  assert.match(dot, /cleanup_failed_merge -> encode_integration_command/);
  assert.match(dot, /encode_integration_command -> integration/);
  assertEdgeChain(dot, ["integration", "close_issue", "encode_merge_notes", "report", "cleanup_merge_worktree", "done"]);
});

test("merge_item conflict agents never run in the canonical checkout cwd", () => {
  const dot = readCapabilityMergeGraphDot();
  assert.match(dot, /resolve_conflict[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /retry_resolve_conflict[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  assert.doesNotMatch(dot, /resolve_conflict[\s\S]*workdir="\$\{repo\}"/);
});
