import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  makePacketId,
  buildNamedPacketEnvelope,
  validateNamedPacketBase,
  buildPacketRef,
  buildPacketTakeoverContract,
  validatePacketTakeoverContract,
  PACKET_STATE_OPEN,
  PACKET_STATE_RESOLVED,
  PACKET_STATE_SUPERSEDED,
  PACKET_STATE_ESCALATED,
  PACKET_STATES,
  PACKET_REGISTRY,
  DURABLE_PACKET_TYPES,
  TAKEOVER_PACKET_TYPES,
  isDurablePacketType,
  isTakeoverPacketType,
  findPacketRegistryEntry,
  validateRegisteredPacketType,
  validateDurablePacketPayload,
  buildPacketRegistrySnapshot,
} from "../../src/lib/packet-core.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("packet constants", () => {
  it("PACKET_STATE_OPEN is 'open'", () => {
    assert.equal(PACKET_STATE_OPEN, "open");
  });

  it("PACKET_STATE_RESOLVED is 'resolved'", () => {
    assert.equal(PACKET_STATE_RESOLVED, "resolved");
  });

  it("PACKET_STATE_SUPERSEDED is 'superseded'", () => {
    assert.equal(PACKET_STATE_SUPERSEDED, "superseded");
  });

  it("PACKET_STATE_ESCALATED is 'escalated'", () => {
    assert.equal(PACKET_STATE_ESCALATED, "escalated");
  });

  it("PACKET_STATES contains all four states", () => {
    assert.deepEqual(
      [...PACKET_STATES],
      ["open", "resolved", "superseded", "escalated"],
    );
  });

  it("PACKET_STATES is frozen", () => {
    assert.ok(Object.isFrozen(PACKET_STATES));
  });
});

// ---------------------------------------------------------------------------
// makePacketId
// ---------------------------------------------------------------------------
describe("makePacketId", () => {
  it("returns deterministic id for same inputs", () => {
    const a = makePacketId({ packetType: "test", identity: { key: "val" } });
    const b = makePacketId({ packetType: "test", identity: { key: "val" } });
    assert.equal(a, b);
  });

  it("returns different id for different packetType", () => {
    const a = makePacketId({ packetType: "alpha", identity: {} });
    const b = makePacketId({ packetType: "beta", identity: {} });
    assert.notEqual(a, b);
  });

  it("returns different id for different identity", () => {
    const a = makePacketId({ packetType: "test", identity: { x: 1 } });
    const b = makePacketId({ packetType: "test", identity: { x: 2 } });
    assert.notEqual(a, b);
  });

  it("format is <sanitized_type>_<20-char-hex>", () => {
    const id = makePacketId({ packetType: "my_type", identity: {} });
    const match = id.match(/^([a-zA-Z0-9._-]+)_([0-9a-f]{20})$/);
    assert.ok(match, `id did not match expected format: ${id}`);
  });

  it("sanitizes special chars in packetType to underscores", () => {
    const id = makePacketId({ packetType: "hello world!@#", identity: {} });
    // The prefix portion should have special chars replaced with _
    const prefix = id.slice(0, id.lastIndexOf("_"));
    assert.ok(!/[^a-zA-Z0-9._/-]/.test(prefix), `prefix contains special chars: ${prefix}`);
  });

  it("falls back to 'packet' when packetType is empty", () => {
    const id = makePacketId({ packetType: "", identity: {} });
    assert.ok(id.startsWith("packet_"), `expected 'packet_' prefix, got: ${id}`);
  });

  it("handles non-object identity gracefully", () => {
    const a = makePacketId({ packetType: "t", identity: "bad" });
    const b = makePacketId({ packetType: "t", identity: {} });
    assert.equal(a, b);
  });

  it("handles null identity gracefully", () => {
    const a = makePacketId({ packetType: "t", identity: null });
    const b = makePacketId({ packetType: "t", identity: {} });
    assert.equal(a, b);
  });

  it("handles no arguments", () => {
    const id = makePacketId();
    assert.ok(id.startsWith("packet_"));
  });
});

// ---------------------------------------------------------------------------
// buildNamedPacketEnvelope
// ---------------------------------------------------------------------------
describe("buildNamedPacketEnvelope", () => {
  it("trims all string fields", () => {
    const env = buildNamedPacketEnvelope({
      schemaVersion: "  v1  ",
      packetType: "  test  ",
      packetId: " id1 ",
      factoryId: " f ",
      runId: "  r  ",
      pipeline: " p ",
      nodeId: "  n  ",
      targetRepo: " tr ",
      controlPlaneRepo: " cp ",
    });
    assert.equal(env.schema_version, "v1");
    assert.equal(env.packet_type, "test");
    assert.equal(env.packet_id, "id1");
    assert.equal(env.factory_id, "f");
    assert.equal(env.run_id, "r");
    assert.equal(env.pipeline, "p");
    assert.equal(env.node_id, "n");
    assert.equal(env.target_repo, "tr");
    assert.equal(env.control_plane_repo, "cp");
  });

  it("defaults packetState to 'open'", () => {
    const env = buildNamedPacketEnvelope({});
    assert.equal(env.packet_state, "open");
  });

  it("defaults packetState to 'open' when empty string provided", () => {
    const env = buildNamedPacketEnvelope({ packetState: "" });
    assert.equal(env.packet_state, "open");
  });

  it("defaults created_at to ISO string when empty", () => {
    const before = new Date().toISOString();
    const env = buildNamedPacketEnvelope({});
    const after = new Date().toISOString();
    assert.ok(env.created_at >= before && env.created_at <= after);
  });

  it("uses provided createdAt when given", () => {
    const env = buildNamedPacketEnvelope({ createdAt: "2024-01-01T00:00:00Z" });
    assert.equal(env.created_at, "2024-01-01T00:00:00Z");
  });

  it("handles no arguments", () => {
    const env = buildNamedPacketEnvelope();
    assert.equal(env.packet_state, "open");
    assert.ok(env.created_at);
  });
});

// ---------------------------------------------------------------------------
// validateNamedPacketBase
// ---------------------------------------------------------------------------
describe("validateNamedPacketBase", () => {
  const validPacket = {
    schema_version: "v1",
    packet_type: "test",
    packet_id: "abc",
    created_at: "2024-01-01T00:00:00Z",
    packet_state: "open",
  };

  it("returns ok for valid packet", () => {
    const result = validateNamedPacketBase(validPacket);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("reports missing schema_version", () => {
    const result = validateNamedPacketBase({ ...validPacket, schema_version: "" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing_required_field:schema_version"));
  });

  it("reports missing packet_type", () => {
    const result = validateNamedPacketBase({ ...validPacket, packet_type: "" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing_required_field:packet_type"));
  });

  it("reports missing packet_id", () => {
    const result = validateNamedPacketBase({ ...validPacket, packet_id: "" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing_required_field:packet_id"));
  });

  it("reports missing created_at", () => {
    const result = validateNamedPacketBase({ ...validPacket, created_at: "" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("missing_required_field:created_at"));
  });

  it("reports invalid packet_state", () => {
    const result = validateNamedPacketBase({ ...validPacket, packet_state: "bogus" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("invalid_packet_state:bogus"));
  });

  it("reports multiple missing fields", () => {
    const result = validateNamedPacketBase({
      schema_version: "",
      packet_type: "",
      packet_id: "",
      created_at: "",
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 4);
  });

  it("defaults packet_state to open when absent", () => {
    const { packet_state, ...noState } = validPacket;
    const result = validateNamedPacketBase(noState);
    assert.equal(result.ok, true);
  });

  it("handles no arguments", () => {
    const result = validateNamedPacketBase();
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// buildPacketRef
// ---------------------------------------------------------------------------
describe("buildPacketRef", () => {
  it("returns normalized ref object", () => {
    const packet = {
      packet_type: " test ",
      schema_version: " v1 ",
      packet_id: " id1 ",
      packet_state: " resolved ",
      factory_id: " f1 ",
      run_id: " r1 ",
      pipeline: " p1 ",
      node_id: " n1 ",
    };
    const ref = buildPacketRef(packet, " /some/path.json ");
    assert.equal(ref.packet_type, "test");
    assert.equal(ref.schema_version, "v1");
    assert.equal(ref.packet_id, "id1");
    assert.equal(ref.packet_state, "resolved");
    assert.equal(ref.packet_path, "/some/path.json");
    assert.equal(ref.factory_id, "f1");
    assert.equal(ref.run_id, "r1");
    assert.equal(ref.pipeline, "p1");
    assert.equal(ref.node_id, "n1");
  });

  it("defaults packet_state to 'open'", () => {
    const ref = buildPacketRef({}, "");
    assert.equal(ref.packet_state, "open");
  });

  it("handles no arguments", () => {
    const ref = buildPacketRef();
    assert.equal(ref.packet_state, "open");
    assert.equal(ref.packet_type, "");
  });
});

// ---------------------------------------------------------------------------
// buildPacketTakeoverContract
// ---------------------------------------------------------------------------
describe("buildPacketTakeoverContract", () => {
  it("normalizes all fields", () => {
    const contract = buildPacketTakeoverContract({
      handoffOwner: "  owner  ",
      handoffKind: "  kind  ",
      resourceRefs: { a: 1 },
      inspectionCommands: ["  cmd1  "],
      executionCommands: ["cmd2"],
      verifyCommands: ["cmd3"],
      expectedOutcomes: ["out1"],
      preserveWork: { b: 2 },
      operatorPrompt: "  do something  ",
    });
    assert.equal(contract.handoff_owner, "owner");
    assert.equal(contract.handoff_kind, "kind");
    assert.deepEqual(contract.resource_refs, { a: 1 });
    assert.deepEqual(contract.inspection_commands, ["cmd1"]);
    assert.deepEqual(contract.execution_commands, ["cmd2"]);
    assert.deepEqual(contract.verify_commands, ["cmd3"]);
    assert.deepEqual(contract.expected_outcomes, ["out1"]);
    assert.deepEqual(contract.preserve_work, { b: 2 });
    assert.equal(contract.operator_prompt, "do something");
  });

  it("returns correct shape with defaults", () => {
    const contract = buildPacketTakeoverContract();
    assert.equal(contract.handoff_owner, "");
    assert.equal(contract.handoff_kind, "");
    assert.deepEqual(contract.resource_refs, {});
    assert.deepEqual(contract.inspection_commands, []);
    assert.deepEqual(contract.execution_commands, []);
    assert.deepEqual(contract.verify_commands, []);
    assert.deepEqual(contract.expected_outcomes, []);
    assert.deepEqual(contract.preserve_work, {});
    assert.equal(contract.operator_prompt, "");
  });

  it("filters empty strings from command lists", () => {
    const contract = buildPacketTakeoverContract({
      executionCommands: ["a", "", "  ", "b"],
    });
    assert.deepEqual(contract.execution_commands, ["a", "b"]);
  });

  it("returns empty object for non-object resourceRefs", () => {
    const contract = buildPacketTakeoverContract({ resourceRefs: "bad" });
    assert.deepEqual(contract.resource_refs, {});
  });
});

// ---------------------------------------------------------------------------
// validatePacketTakeoverContract
// ---------------------------------------------------------------------------
describe("validatePacketTakeoverContract", () => {
  it("returns ok when required=false regardless of content", () => {
    const result = validatePacketTakeoverContract({}, { required: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("returns ok when required defaults to false", () => {
    const result = validatePacketTakeoverContract({});
    assert.equal(result.ok, true);
  });

  it("returns ok when required=true and all fields present", () => {
    const packet = {
      handoff_owner: "owner",
      handoff_kind: "kind",
      operator_prompt: "prompt",
      inspection_commands: ["cmd"],
      execution_commands: ["cmd"],
      verify_commands: ["cmd"],
      expected_outcomes: ["out"],
      resource_refs: { a: 1 },
      preserve_work: { b: 2 },
    };
    const result = validatePacketTakeoverContract(packet, { required: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("reports missing handoff_owner when required", () => {
    const result = validatePacketTakeoverContract(
      { handoff_kind: "k", operator_prompt: "p", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: ["x"], resource_refs: {}, preserve_work: {} },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:handoff_owner"));
  });

  it("reports missing handoff_kind when required", () => {
    const result = validatePacketTakeoverContract(
      { handoff_owner: "o", operator_prompt: "p", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: ["x"], resource_refs: {}, preserve_work: {} },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:handoff_kind"));
  });

  it("reports missing operator_prompt when required", () => {
    const result = validatePacketTakeoverContract(
      { handoff_owner: "o", handoff_kind: "k", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: ["x"], resource_refs: {}, preserve_work: {} },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:operator_prompt"));
  });

  it("reports empty expected_outcomes as missing", () => {
    const result = validatePacketTakeoverContract(
      { handoff_owner: "o", handoff_kind: "k", operator_prompt: "p", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: [], resource_refs: {}, preserve_work: {} },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:expected_outcomes"));
  });

  it("reports missing resource_refs when not object", () => {
    const result = validatePacketTakeoverContract(
      { handoff_owner: "o", handoff_kind: "k", operator_prompt: "p", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: ["x"], resource_refs: null, preserve_work: {} },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:resource_refs"));
  });

  it("reports missing preserve_work when array", () => {
    const result = validatePacketTakeoverContract(
      { handoff_owner: "o", handoff_kind: "k", operator_prompt: "p", inspection_commands: [], execution_commands: [], verify_commands: [], expected_outcomes: ["x"], resource_refs: {}, preserve_work: [] },
      { required: true },
    );
    assert.ok(result.errors.includes("missing_required_field:preserve_work"));
  });

  it("collects multiple errors", () => {
    const result = validatePacketTakeoverContract({}, { required: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 1);
  });
});

// ---------------------------------------------------------------------------
// PACKET_REGISTRY, DURABLE_PACKET_TYPES, TAKEOVER_PACKET_TYPES
// ---------------------------------------------------------------------------
describe("PACKET_REGISTRY", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(PACKET_REGISTRY));
    assert.ok(Array.isArray(PACKET_REGISTRY));
  });

  it("each entry is frozen", () => {
    for (const entry of PACKET_REGISTRY) {
      assert.ok(Object.isFrozen(entry), `entry ${entry.packet_type} is not frozen`);
    }
  });

  it("every entry has required fields", () => {
    for (const entry of PACKET_REGISTRY) {
      assert.ok(entry.packet_type, `missing packet_type`);
      assert.ok(entry.family, `missing family for ${entry.packet_type}`);
      assert.ok(entry.schema_version, `missing schema_version for ${entry.packet_type}`);
      assert.ok(typeof entry.durable === "boolean", `durable not boolean for ${entry.packet_type}`);
      assert.ok(entry.storage_class, `missing storage_class for ${entry.packet_type}`);
      assert.ok(entry.consumer, `missing consumer for ${entry.packet_type}`);
      assert.ok(entry.validator, `missing validator for ${entry.packet_type}`);
    }
  });

  it("DURABLE_PACKET_TYPES is a Set of durable entries", () => {
    assert.ok(DURABLE_PACKET_TYPES instanceof Set);
    for (const entry of PACKET_REGISTRY) {
      if (entry.durable === true) {
        assert.ok(DURABLE_PACKET_TYPES.has(entry.packet_type), `missing durable type: ${entry.packet_type}`);
      } else {
        assert.ok(!DURABLE_PACKET_TYPES.has(entry.packet_type), `non-durable in set: ${entry.packet_type}`);
      }
    }
  });

  it("TAKEOVER_PACKET_TYPES is a Set of entries with takeover_contract", () => {
    assert.ok(TAKEOVER_PACKET_TYPES instanceof Set);
    for (const entry of PACKET_REGISTRY) {
      const hasTakeover = !!(entry.takeover_contract && entry.takeover_contract.trim());
      if (hasTakeover) {
        assert.ok(TAKEOVER_PACKET_TYPES.has(entry.packet_type), `missing takeover type: ${entry.packet_type}`);
      } else {
        assert.ok(!TAKEOVER_PACKET_TYPES.has(entry.packet_type), `non-takeover in set: ${entry.packet_type}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// isDurablePacketType / isTakeoverPacketType
// ---------------------------------------------------------------------------
describe("isDurablePacketType", () => {
  it("returns true for a durable type", () => {
    assert.equal(isDurablePacketType("merge_conflict_packet"), true);
  });

  it("returns false for a non-durable type", () => {
    assert.equal(isDurablePacketType("control_plane_blocker_review"), false);
  });

  it("returns false for unknown type", () => {
    assert.equal(isDurablePacketType("no_such_type"), false);
  });

  it("trims input", () => {
    assert.equal(isDurablePacketType("  merge_conflict_packet  "), true);
  });

  it("handles empty", () => {
    assert.equal(isDurablePacketType(""), false);
    assert.equal(isDurablePacketType(), false);
  });
});

describe("isTakeoverPacketType", () => {
  it("returns true for a takeover type", () => {
    assert.equal(isTakeoverPacketType("merge_conflict_packet"), true);
  });

  it("returns false for a non-takeover type", () => {
    assert.equal(isTakeoverPacketType("control_plane_blocker_review"), false);
  });

  it("returns false for unknown type", () => {
    assert.equal(isTakeoverPacketType("no_such_type"), false);
  });
});

// ---------------------------------------------------------------------------
// findPacketRegistryEntry
// ---------------------------------------------------------------------------
describe("findPacketRegistryEntry", () => {
  it("returns entry for known type", () => {
    const entry = findPacketRegistryEntry("incident_packet");
    assert.ok(entry);
    assert.equal(entry.packet_type, "incident_packet");
    assert.equal(entry.durable, true);
  });

  it("returns null for unknown type", () => {
    assert.equal(findPacketRegistryEntry("nope"), null);
  });

  it("trims input", () => {
    const entry = findPacketRegistryEntry("  incident_packet  ");
    assert.ok(entry);
  });

  it("returns null for empty", () => {
    assert.equal(findPacketRegistryEntry(""), null);
    assert.equal(findPacketRegistryEntry(), null);
  });
});

// ---------------------------------------------------------------------------
// validateRegisteredPacketType
// ---------------------------------------------------------------------------
describe("validateRegisteredPacketType", () => {
  it("returns ok for known type with matching schema", () => {
    const result = validateRegisteredPacketType({
      packetType: "incident_packet",
      schemaVersion: "incident_packet.v1",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.ok(result.entry);
  });

  it("returns ok when schemaVersion is empty (not checked)", () => {
    const result = validateRegisteredPacketType({
      packetType: "incident_packet",
      schemaVersion: "",
    });
    assert.equal(result.ok, true);
  });

  it("returns error for unregistered type", () => {
    const result = validateRegisteredPacketType({ packetType: "nope" });
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].startsWith("unregistered_packet_type:"));
    assert.equal(result.entry, null);
  });

  it("returns error for empty packetType", () => {
    const result = validateRegisteredPacketType({});
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes("(empty)"));
  });

  it("returns error for schema_version mismatch", () => {
    const result = validateRegisteredPacketType({
      packetType: "incident_packet",
      schemaVersion: "wrong/v99",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].startsWith("schema_version_mismatch:"));
    assert.ok(result.entry); // entry is still returned
  });
});

// ---------------------------------------------------------------------------
// validateDurablePacketPayload
// ---------------------------------------------------------------------------
describe("validateDurablePacketPayload", () => {
  it("returns ok for unregistered packet type", () => {
    const result = validateDurablePacketPayload({ packet_type: "unknown_xyz" });
    assert.equal(result.ok, true);
    assert.equal(result.entry, null);
  });

  it("returns ok for fully valid durable packet (no takeover)", () => {
    // reviewer_context_packet is durable but has no takeover_contract
    const result = validateDurablePacketPayload({
      packet_type: "reviewer_context_packet",
      schema_version: "reviewer_context/v1",
      packet_id: "abc",
      created_at: "2024-01-01T00:00:00Z",
      packet_state: "open",
    });
    assert.equal(result.ok, true);
    assert.ok(result.entry);
  });

  it("returns ok for fully valid durable+takeover packet", () => {
    const result = validateDurablePacketPayload({
      packet_type: "incident_packet",
      schema_version: "incident_packet.v1",
      packet_id: "abc",
      created_at: "2024-01-01T00:00:00Z",
      packet_state: "open",
      handoff_owner: "owner",
      handoff_kind: "kind",
    });
    assert.equal(result.ok, true);
    assert.ok(result.entry);
  });

  it("reports missing required fields for durable type", () => {
    const result = validateDurablePacketPayload({
      packet_type: "incident_packet",
      schema_version: "incident_packet.v1",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("packet_id")));
    assert.ok(result.errors.some((e) => e.includes("created_at")));
    assert.ok(result.errors.some((e) => e.includes("packet_state")));
  });

  it("reports schema_version mismatch", () => {
    const result = validateDurablePacketPayload({
      packet_type: "incident_packet",
      schema_version: "wrong",
      packet_id: "abc",
      created_at: "2024-01-01",
      packet_state: "open",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].startsWith("schema_version_mismatch:"));
  });

  it("reports missing handoff fields for takeover type", () => {
    const result = validateDurablePacketPayload({
      packet_type: "merge_conflict_packet",
      schema_version: "merge_conflict_packet/v1",
      packet_id: "abc",
      created_at: "2024-01-01",
      packet_state: "open",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("handoff_owner")));
    assert.ok(result.errors.some((e) => e.includes("handoff_kind")));
  });

  it("returns ok for takeover type with handoff fields", () => {
    const result = validateDurablePacketPayload({
      packet_type: "merge_conflict_packet",
      schema_version: "merge_conflict_packet/v1",
      packet_id: "abc",
      created_at: "2024-01-01",
      packet_state: "open",
      handoff_owner: "owner",
      handoff_kind: "kind",
    });
    assert.equal(result.ok, true);
  });

  it("skips durable checks for non-durable registered type", () => {
    const result = validateDurablePacketPayload({
      packet_type: "control_plane_blocker_review",
      schema_version: "remediation_packet/v1",
    });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// buildPacketRegistrySnapshot
// ---------------------------------------------------------------------------
describe("buildPacketRegistrySnapshot", () => {
  it("returns correct schema_version", () => {
    const snapshot = buildPacketRegistrySnapshot();
    assert.equal(snapshot.schema_version, "packet_registry/v1");
  });

  it("returns sorted packet_types", () => {
    const snapshot = buildPacketRegistrySnapshot();
    const names = snapshot.packet_types.map((e) => e.packet_type);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  });

  it("includes ephemeral_justification only for non-durable types", () => {
    const snapshot = buildPacketRegistrySnapshot();
    for (const entry of snapshot.packet_types) {
      if (entry.durable) {
        assert.equal(entry.ephemeral_justification, undefined, `durable type ${entry.packet_type} has ephemeral_justification`);
      } else {
        assert.ok("ephemeral_justification" in entry, `non-durable type ${entry.packet_type} missing ephemeral_justification`);
      }
    }
  });

  it("maps all registry entries", () => {
    const snapshot = buildPacketRegistrySnapshot();
    assert.equal(snapshot.packet_types.length, PACKET_REGISTRY.length);
  });
});
