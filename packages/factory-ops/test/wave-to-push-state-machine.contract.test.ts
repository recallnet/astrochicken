import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readCapabilityMergeGraphDot } from "../src/lib/merge-capability.ts";

const machine = JSON.parse(readFileSync("packages/factory-ops/test/state-machines/wave-to-push.machine.json", "utf8"));
const waveDot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
const mergeDot = readCapabilityMergeGraphDot();

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function edgePattern(from, to, condition) {
  const fromPattern = escapeRegex(from);
  const toPattern = escapeRegex(to);
  if (!condition || condition === "always") return new RegExp(`${fromPattern} -> ${toPattern}`);
  return new RegExp(`${fromPattern} -> ${toPattern} \\[condition=\"${escapeRegex(condition)}\"\\]`);
}

test("wave-to-push machine map has stable schema", () => {
  assert.equal(machine.schema_version, "wave_to_push_machine/v1");
  assert.ok(machine.graphs?.wave_execute);
  assert.ok(machine.graphs?.merge_item);
});

test("wave_execute transitions in machine map are present in DOT", () => {
  for (const t of machine.graphs.wave_execute.transitions) {
    assert.match(waveDot, edgePattern(t.from, t.to, t.condition), `Missing wave_execute transition: ${t.from} -> ${t.to} (${t.condition})`);
  }
});

test("merge_item transitions in machine map are present in DOT", () => {
  for (const t of machine.graphs.merge_item.transitions) {
    assert.match(mergeDot, edgePattern(t.from, t.to, t.condition), `Missing merge_item transition: ${t.from} -> ${t.to} (${t.condition})`);
  }
});

test("wave_execute terminal failure path is explicit and deterministic", () => {
  assert.match(waveDot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(waveDot, /emit_resolution_failure -> set_wave_merge_failed/);
  assert.doesNotMatch(waveDot, /emit_merge_conflict_fallback_defect/);
  assert.match(waveDot, /push_gate -> build_push_failure_packet \[condition="push_status!=pushed"\]/);
  // Push failure routes through LLM resolver before failing
  assert.match(waveDot, /build_push_failure_packet -> resolve_push_failure/);
  assert.match(waveDot, /retry_push_gate -> set_wave_merge_failed \[condition="push_status!=pushed"\]/);
});

test("wave_execute demo subflow is fail-open and rejoins judge path", () => {
  assert.match(waveDot, /run_wave_demo_generate \[type="pipeline"[^\n]*fail_open="true"/);
  assert.match(waveDot, /run_wave_demo_generate \[type="pipeline"[^\n]*export_keys="artifact_url,demo_status,demo_error,demo_strategy_resolved"/);
  assert.match(waveDot, /handle_merge_failures -> clear_demo_artifact_url/);
  assert.match(waveDot, /clear_demo_artifact_url -> clear_demo_status -> clear_demo_error -> resolve_demo_strategy_policy -> merge_gate/);
  assert.match(waveDot, /merge_gate -> run_demo_gate \[condition="merged_count!=0"\]/);
  assert.match(waveDot, /run_demo_gate -> judge \[condition="demo_strategy_policy=none"\]/);
  assert.match(waveDot, /run_demo_gate -> run_wave_demo_generate \[condition="demo_strategy_policy!=none"\]/);
  assert.match(waveDot, /run_wave_demo_generate -> judge/);
  assert.doesNotMatch(waveDot, /run_wave_demo_generate -> set_wave_merge_failed/);
});
