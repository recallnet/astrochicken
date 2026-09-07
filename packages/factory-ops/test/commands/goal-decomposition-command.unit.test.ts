import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkGoalAlreadyDecomposedByPacket,
  listGoalDecompositionLedger,
  persistGoalDecompositionLedger,
} from "../../src/commands/goal-decomposition-packet.ts";

function buildFixture() {
  return {
    goalIssueRaw: JSON.stringify({ number: 1753, title: "Packet standardization" }),
    goalContextRaw: JSON.stringify({ summary: "Standardize packet contracts" }),
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Centralize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
  };
}

test("persistGoalDecompositionLedger writes canonical packet refs and created issue numbers", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-command-"));
  const out = persistGoalDecompositionLedger({
    repo,
    factoryId: "mothership",
    ...buildFixture(),
  });
  assert.equal(out.packet_type, "goal_decomposition_packet");
  assert.equal(out.goal_issue_number, "1753");
  assert.deepEqual(out.created_issue_numbers, ["1754"]);
  assert.match(out.packet_path, /\.hatch\/mothership\/packets\/goal_decomposition_packet\//);
});

test("checkGoalAlreadyDecomposedByPacket returns true when decomposition ledger exists", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-command-"));
  persistGoalDecompositionLedger({
    repo,
    factoryId: "mothership",
    ...buildFixture(),
  });
  assert.equal(checkGoalAlreadyDecomposedByPacket({
    repo,
    factoryId: "mothership",
    issueNumber: "1753",
  }), "true");
});

test("listGoalDecompositionLedger returns durable packet locator summary", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-command-"));
  persistGoalDecompositionLedger({
    repo,
    factoryId: "mothership",
    ...buildFixture(),
  });
  const out = listGoalDecompositionLedger({
    repo,
    factoryId: "mothership",
    issueNumber: "1753",
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].goal_issue_number, "1753");
  assert.deepEqual(out[0].created_issue_numbers, ["1754"]);
});
