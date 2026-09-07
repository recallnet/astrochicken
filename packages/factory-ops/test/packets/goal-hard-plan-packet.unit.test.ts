import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGoalHardPlanCommentMarker,
  buildGoalHardPlanIssueComment,
  buildGoalHardPlanPacket,
  fromArtifact,
  getLatestGoalHardPlanPacket,
  hasGoalHardPlanPacket,
  inspectGoalHardPlanAttachment,
  parseGoalHardPlanCommentMarker,
  persistGoalHardPlanPacket,
  serializeToArtifact,
  validateGoalHardPlanPacket,
} from "../../src/lib/goal-hard-plan-packet.ts";

test("goal hard-plan packet builds registered durable packet family", () => {
  const packet = buildGoalHardPlanPacket({
    goalNumber: "2200",
    packetId: "plan-abc",
    planSummary: "Investigate and define hard-plan artifacts.",
    artifactRefs: [{ label: "research", url: "https://example.com/research.md" }],
    attachedBy: "agent",
    factoryId: "mothership",
  });

  const validation = validateGoalHardPlanPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.packet_type, "goal_hard_plan_packet");
  assert.equal(packet.schema_version, "goal_hard_plan_packet/v1");
  assert.equal(packet.handoff_kind, "goal_hard_plan");
  assert.equal(packet.goal_number, "2200");
  assert.equal(packet.packet_id, "plan-abc");
  assert.equal(packet.comment_marker, "<!-- goal-hard-plan:v1 goal=2200 packet=plan-abc -->");
});

test("goal hard-plan packet persists to factory-scoped durable packet root", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-hard-plan-packet-"));
  const packet = buildGoalHardPlanPacket({
    goalNumber: "2200",
    packetId: "plan-hard-1",
    planSummary: "Hard-plan summary",
    artifactRefs: [{ path: "artifacts/hard-plan.md" }],
    attachedBy: "agent",
    factoryId: "mothership",
  });

  const persisted = persistGoalHardPlanPacket({ repo, packet });
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/goal_hard_plan_packet\/plan-hard-1\.json$/);

  const latest = getLatestGoalHardPlanPacket({
    repo,
    factoryId: "mothership",
    goalNumber: "2200",
  });
  assert.ok(latest);
  assert.equal(latest.packet.packet_id, "plan-hard-1");
  assert.equal(hasGoalHardPlanPacket({ repo, factoryId: "mothership", goalNumber: "2200" }), true);
});

test("goal hard-plan packet rejects schema drift and malformed marker linkage", () => {
  const packet = buildGoalHardPlanPacket({
    goalNumber: "2200",
    packetId: "plan-hard-2",
    planSummary: "Hard-plan summary",
    artifactRefs: [{ path: "artifacts/hard-plan.md" }],
    attachedBy: "agent",
    factoryId: "mothership",
    commentMarker: "<!-- goal-hard-plan:v1 goal=2200 packet=other-packet -->",
  });

  const validation = validateGoalHardPlanPacket(packet);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("comment_marker_packet_mismatch:other-packet!=plan-hard-2"));
});

test("goal hard-plan packet artifact serialization round-trips", () => {
  const packet = buildGoalHardPlanPacket({
    goalNumber: "2200",
    packetId: "plan-roundtrip",
    planSummary: "Roundtrip hard-plan packet",
    artifactRefs: [{ ref: "packet://artifact/1" }],
    attachedBy: "agent",
    factoryId: "mothership",
  });

  const artifact = serializeToArtifact(packet);
  const parsed = fromArtifact(artifact);
  assert.equal(parsed.packet_id, "plan-roundtrip");
  assert.equal(parsed.goal_number, "2200");
});

test("goal hard-plan marker and comment helpers are deterministic", () => {
  const marker = buildGoalHardPlanCommentMarker({
    goalNumber: "2200",
    packetId: "plan-det",
  });
  assert.equal(marker, "<!-- goal-hard-plan:v1 goal=2200 packet=plan-det -->");

  const parsed = parseGoalHardPlanCommentMarker(`${marker}\nAttached.`);
  assert.equal(parsed.found, true);
  assert.equal(parsed.version, "v1");
  assert.equal(parsed.goal_number, "2200");
  assert.equal(parsed.packet_id, "plan-det");

  const body = buildGoalHardPlanIssueComment({
    goalNumber: "2200",
    packetId: "plan-det",
    planSummary: "Deterministic summary",
    artifactRefs: [{ label: "plan", path: "artifacts/plan.md" }],
    attachedAt: "2026-03-18T00:00:00.000Z",
  });

  assert.match(body, /<!-- goal-hard-plan:v1 goal=2200 packet=plan-det -->/);
  assert.match(body, /plan_summary=Deterministic summary/);
  assert.match(body, /artifact_count=1/);
  assert.match(body, /- artifacts\/plan\.md \(label=plan\)/);
});

test("inspectGoalHardPlanAttachment reports packet linkage metadata", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-hard-plan-packet-"));
  const packet = buildGoalHardPlanPacket({
    goalNumber: "2200",
    packetId: "plan-inspect",
    planSummary: "Inspect hard-plan attachment",
    artifactRefs: [{ url: "https://example.com/plan" }],
    attachedBy: "agent",
    attachedAt: "2026-03-18T00:00:00.000Z",
    goalIssueCommentId: "123456",
    goalIssueCommentUrl: "https://github.com/recallnet/astrochicken/issues/2200#issuecomment-123456",
    factoryId: "mothership",
  });
  persistGoalHardPlanPacket({ repo, packet });

  const out = inspectGoalHardPlanAttachment({
    repo,
    factoryId: "mothership",
    goalNumber: "2200",
  });

  assert.equal(out.attached, true);
  assert.equal(out.goal_number, "2200");
  assert.equal(out.packet_id, "plan-inspect");
  assert.equal(out.goal_issue_comment_id, "123456");
  assert.match(out.comment_marker, /goal-hard-plan:v1/);
});
