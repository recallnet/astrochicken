import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRIAGE_ONLY_PACKET_TYPES,
  evaluateManagedActionItemGate,
  isDispatchBlocker,
} from "../../src/commands/supervisor-managed-action-item-gate.ts";

describe("evaluateManagedActionItemGate", () => {
  it("exports the managed non-blocking packet set", () => {
    assert.equal(TRIAGE_ONLY_PACKET_TYPES.has("goal_execution_path_packet"), true);
    assert.equal(TRIAGE_ONLY_PACKET_TYPES.has("orphan_feature_triage"), true);
    assert.equal(TRIAGE_ONLY_PACKET_TYPES.has("goal_decomposition_packet"), true);
    assert.equal(TRIAGE_ONLY_PACKET_TYPES.has("merge_conflict_packet"), true);
  });

  it("isDispatchBlocker returns false for non-blocking packets and true by default", () => {
    assert.equal(isDispatchBlocker({ remediation_packet: { packet_type: "goal_execution_path_packet" } }), false);
    assert.equal(isDispatchBlocker({ remediation_packet: { packet_type: "human_blocker" } }), true);
    assert.equal(isDispatchBlocker({ problem: "no packet metadata" }), true);
  });

  // Basic behavior
  it("returns no action items when called with no args", () => {
    assert.deepStrictEqual(evaluateManagedActionItemGate(), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("returns no action items for empty snapshot", () => {
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot: "" }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("returns has_action_items true with 1 item", () => {
    const snapshot = JSON.stringify({ action_items: ["fix bug"] });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 1);
  });

  it("returns correct count with 3 items", () => {
    const snapshot = JSON.stringify({ action_items: ["a", "b", "c"] });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 3);
  });

  it("returns no action items for empty action_items array", () => {
    const snapshot = JSON.stringify({ action_items: [] });
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("returns no action items when action_items key is absent", () => {
    const snapshot = JSON.stringify({ other: "data" });
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  // Snapshot parsing
  it("parses valid JSON snapshot correctly", () => {
    const snapshot = JSON.stringify({ action_items: [{ id: 1 }] });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 1);
  });

  it("treats invalid JSON snapshot as empty", () => {
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot: "not json" }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("treats array JSON snapshot as empty (not a plain object)", () => {
    const snapshot = JSON.stringify([{ action_items: ["x"] }]);
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  // Base64 snapshot
  it("decodes valid base64 with action items", () => {
    const obj = { action_items: ["deploy", "test"] };
    const snapshotB64 = Buffer.from(JSON.stringify(obj)).toString("base64");
    const result = evaluateManagedActionItemGate({ snapshotB64 });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 2);
  });

  it("snapshotB64 takes priority over snapshot", () => {
    const b64Obj = { action_items: ["from-b64"] };
    const snapshotB64 = Buffer.from(JSON.stringify(b64Obj)).toString("base64");
    const snapshot = JSON.stringify({ action_items: ["from-plain", "extra"] });
    const result = evaluateManagedActionItemGate({ snapshot, snapshotB64 });
    assert.equal(result.action_item_count, 1);
  });

  it("falls back to empty for invalid base64", () => {
    // "!!!" is not valid base64 but Buffer.from won't throw; the decoded
    // string will be garbage that fails JSON.parse, yielding the fallback.
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshotB64: "!!!" }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("falls back to empty when base64 contains invalid JSON", () => {
    const snapshotB64 = Buffer.from("not json at all").toString("base64");
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshotB64 }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  // Edge cases
  it("treats whitespace-only snapshot as empty", () => {
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot: "   \n\t  " }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  it("treats non-array action_items as empty", () => {
    const snapshot = JSON.stringify({ action_items: "not-an-array" });
    assert.deepStrictEqual(evaluateManagedActionItemGate({ snapshot }), {
      has_action_items: "false",
      action_item_count: 0,
    });
  });

  // --- Triage filtering: triage-only items must not block dispatch ---

  const TRIAGE_PACKET_TYPES = [
    "orphan_feature_triage",
    "closed_goal_feature_triage",
    "relabel_merge_followup",
    "merge_followup_triage",
    "unlabeled_issue_classification",
    "goal_execution_path_packet",
    "stale_bug_recheck",
    "goal_decomposition_packet",
    "merge_conflict_packet",
  ];

  const BLOCKING_PACKET_TYPES = [
    "human_blocker_recheck",
    "human_blocker",
    "close_stale_wave_giveup_bug",
    "run_liveness_recovery",
    "local_cli_runtime_crash",
    "remote_cli_runtime_crash",
    "review_harness_degradation",
    "control_plane_blocker_review",
  ];

  function makeItem(packetType) {
    return {
      issue: 100,
      title: `item-${packetType}`,
      problem: `test problem for ${packetType}`,
      remediation_packet: { packetType },
    };
  }

  function makeSnakeItem(packet_type) {
    return {
      issue: 101,
      title: `item-${packet_type}`,
      problem: `test problem for ${packet_type}`,
      remediation_packet: { packet_type },
    };
  }

  for (const pt of TRIAGE_PACKET_TYPES) {
    it(`excludes triage item with packetType="${pt}" from dispatch blocking`, () => {
      const snapshot = JSON.stringify({ action_items: [makeItem(pt)] });
      const result = evaluateManagedActionItemGate({ snapshot });
      assert.equal(result.has_action_items, "false",
        `packetType "${pt}" should not block dispatch`);
      assert.equal(result.action_item_count, 0);
    });

    it(`excludes triage item with packet_type="${pt}" from dispatch blocking`, () => {
      const snapshot = JSON.stringify({ action_items: [makeSnakeItem(pt)] });
      const result = evaluateManagedActionItemGate({ snapshot });
      assert.equal(result.has_action_items, "false",
        `packet_type "${pt}" should not block dispatch`);
      assert.equal(result.action_item_count, 0);
    });
  }

  for (const pt of BLOCKING_PACKET_TYPES) {
    it(`counts blocking item with packetType="${pt}" as dispatch blocker`, () => {
      const snapshot = JSON.stringify({ action_items: [makeItem(pt)] });
      const result = evaluateManagedActionItemGate({ snapshot });
      assert.equal(result.has_action_items, "true",
        `packetType "${pt}" should block dispatch`);
      assert.equal(result.action_item_count, 1);
    });

    it(`counts blocking item with packet_type="${pt}" as dispatch blocker`, () => {
      const snapshot = JSON.stringify({ action_items: [makeSnakeItem(pt)] });
      const result = evaluateManagedActionItemGate({ snapshot });
      assert.equal(result.has_action_items, "true",
        `packet_type "${pt}" should block dispatch`);
      assert.equal(result.action_item_count, 1);
    });
  }

  it("items without remediation_packet block by default", () => {
    const snapshot = JSON.stringify({
      action_items: [{ problem: "stuck goal detected" }],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 1);
  });

  it("items with empty packetType block by default", () => {
    const snapshot = JSON.stringify({
      action_items: [{ remediation_packet: { packetType: "" } }],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 1);
  });

  it("filters triage items from a mixed list, counts only blockers", () => {
    const snapshot = JSON.stringify({
      action_items: [
        makeItem("orphan_feature_triage"),
        makeItem("run_liveness_recovery"),
        makeItem("closed_goal_feature_triage"),
        makeItem("human_blocker"),
        makeItem("unlabeled_issue_classification"),
      ],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 2);
  });

  it("filters triage items from a mixed snake_case list, counts only blockers", () => {
    const snapshot = JSON.stringify({
      action_items: [
        makeSnakeItem("orphan_feature_triage"),
        makeSnakeItem("run_liveness_recovery"),
        makeSnakeItem("closed_goal_feature_triage"),
        makeSnakeItem("human_blocker"),
        makeSnakeItem("unlabeled_issue_classification"),
      ],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 2);
  });

  it("returns false when ALL items are triage-only", () => {
    const snapshot = JSON.stringify({
      action_items: [
        makeItem("orphan_feature_triage"),
        makeItem("closed_goal_feature_triage"),
        makeItem("relabel_merge_followup"),
        makeItem("merge_followup_triage"),
        makeItem("unlabeled_issue_classification"),
      ],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "false");
    assert.equal(result.action_item_count, 0);
  });

  it("plain string items (legacy format) block by default", () => {
    const snapshot = JSON.stringify({ action_items: ["fix bug", "deploy"] });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "true");
    assert.equal(result.action_item_count, 2);
  });

  it("triage filtering works with base64 snapshot", () => {
    const obj = {
      action_items: [
        makeItem("orphan_feature_triage"),
        makeItem("stale_bug_recheck"),
      ],
    };
    const snapshotB64 = Buffer.from(JSON.stringify(obj)).toString("base64");
    const result = evaluateManagedActionItemGate({ snapshotB64 });
    assert.equal(result.has_action_items, "false");
    assert.equal(result.action_item_count, 0);
  });

  it("does not block dispatch on live-style stale bug rechecks mixed with orphan triage", () => {
    const snapshot = JSON.stringify({
      action_items: [
        makeItem("orphan_feature_triage"),
        makeItem("orphan_feature_triage"),
        {
          issue: 1798,
          title: "V4: example-trading sum-to-one current audit (2026-03-30)",
          problem: "open bug older than 1 hour — verify if still reproducible",
          remediation_packet: { packetType: "stale_bug_recheck" },
        },
      ],
    });
    const result = evaluateManagedActionItemGate({ snapshot });
    assert.equal(result.has_action_items, "false");
    assert.equal(result.action_item_count, 0);
  });
});
