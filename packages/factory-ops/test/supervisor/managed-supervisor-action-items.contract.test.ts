import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("managed supervisor routes unresolved action items into the domain graph", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot", "utf8");
  assert.match(dot, /action_item_gate -> run_domain_graph \[condition="has_action_items=true"\]/);
  assert.match(dot, /action_item_gate -> select_intake \[condition="has_action_items!=true"\]/);
  assert.doesNotMatch(dot, /action_item_gate -> set_failure_classification_local \[condition="has_action_items=true"\]/);
});

test("managed supervisor shell parity keeps unresolved action items on the domain graph path", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/factory-runtime/managed-supervisor-shell.dot", "utf8");
  assert.match(dot, /action_item_gate -> run_domain_graph \[condition="has_action_items=true"\]/);
  assert.match(dot, /action_item_gate -> select_intake \[condition="has_action_items!=true"\]/);
  assert.doesNotMatch(dot, /action_item_gate -> set_failure_classification_local \[condition="has_action_items=true"\]/);
});
