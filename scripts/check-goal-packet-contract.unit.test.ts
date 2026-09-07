import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeGoalPacketContract } from "./check-goal-packet-contract.ts";

test("goal packet contract accepts decomposition packetized goal graphs", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-packet-contract-"));
  const files = [
    {
      path: join(root, "goal_run.dot"),
      checks: [
        /persist_decomposition_packet/,
        /action_id="goal\.persist_decomposition_packet"/,
        /action_id="goal\.guard_duplicate_decompose"/,
      ],
      body:
        'persist_decomposition_packet action_id="goal.persist_decomposition_packet"\n' +
        'duplicate_decompose_guard action_id="goal.guard_duplicate_decompose"',
    },
  ];
  writeFileSync(files[0].path, files[0].body, "utf8");
  const diagnostics = analyzeGoalPacketContract(files);
  assert.equal(diagnostics.length, 0);
});

test("goal packet contract accepts duplicate decompose guard metadata without fixed attribute order", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-packet-contract-"));
  const path = join(root, "goal_run.dot");
  writeFileSync(
    path,
    'duplicate_decompose_guard [type="tool" governance="irreversible" action_runtime="in_process" action_id="goal.guard_duplicate_decompose" action_factory_id="${factory_id}" action_repo_root="${repo}"]\n' +
      'persist_decomposition_packet action_id="goal.persist_decomposition_packet"',
    "utf8",
  );
  const diagnostics = analyzeGoalPacketContract([{
    path,
    checks: [
      /persist_decomposition_packet/,
      /action_id="goal\.persist_decomposition_packet"/,
      /duplicate_decompose_guard \[type="tool" governance="irreversible" action_runtime="in_process" action_id="goal\.guard_duplicate_decompose"/,
      /duplicate_decompose_guard \[(?=[^\]]*action_repo_root="\$\{repo\}")(?=[^\]]*action_factory_id="\$\{factory_id\}")[^\]]*\]/,
    ],
  }]);
  assert.equal(diagnostics.length, 0);
});

test("goal packet contract rejects packetless goal graph", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-packet-contract-"));
  mkdirSync(root, { recursive: true });
  const path = join(root, "goal_run.dot");
  writeFileSync(path, "check-decomposed", "utf8");
  const diagnostics = analyzeGoalPacketContract([{ path, checks: [/persist_decomposition_packet/] }]);
  assert.equal(diagnostics.length, 1);
});
