import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGoalDecompositionPacket,
  hasActiveGoalDecompositionPacket,
  persistGoalDecompositionPacket,
  validateGoalDecompositionPacket,
} from "../../src/lib/goal-decomposition-packet.ts";
import { resolvePacketStoragePath } from "../../src/lib/packet-core.ts";

test("goal decomposition packet builds registered durable packet family", () => {
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1753",
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Standardize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
    factoryId: "mothership",
  });
  const validation = validateGoalDecompositionPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.packet_type, "goal_decomposition_packet");
  assert.equal(packet.schema_version, "goal_decomposition_packet/v1");
  assert.equal(packet.handoff_kind, "goal_decomposition_dedupe");
  assert.equal(packet.resource_refs.goal_issue_number, "1753");
});

test("goal decomposition packet persists to factory-scoped durable packet root", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-packet-"));
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1753",
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Standardize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
    factoryId: "mothership",
  });
  const persisted = persistGoalDecompositionPacket({ repo, packet });
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/goal_decomposition_packet\/goal_decomposition_packet_/);
});

test("goal decomposition packet powers decomposed-goal dedupe across runs", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-packet-"));
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1753",
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Standardize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
    factoryId: "mothership",
  });
  persistGoalDecompositionPacket({ repo, packet });
  assert.equal(hasActiveGoalDecompositionPacket({
    repo,
    factoryId: "mothership",
    goalIssueNumber: "1753",
  }), true);
});

test("packet core resolves factory packet storage without run id", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-decomposition-packet-"));
  const out = resolvePacketStoragePath({
    repo,
    packetType: "goal_decomposition_packet",
    packetId: "goal_decomposition_packet_fixture",
    factoryId: "mothership",
  });
  assert.match(out.packet_path, /\.hatch\/mothership\/packets\/goal_decomposition_packet\/goal_decomposition_packet_fixture\.json$/);
  assert.equal(out.storage_class, "factory_packet");
});
