import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  makePacketId,
  buildNamedPacketEnvelope,
  persistNamedPacket,
  readPacketFromPath,
  updatePersistedPacketState,
  listPersistedPackets,
  listPersistedFactoryPackets,
  buildPacketRegistrySnapshot,
  findPacketRegistryEntry,
  PACKET_STATE_OPEN,
  PACKET_STATE_RESOLVED,
  PACKET_STATE_SUPERSEDED,
  PACKET_STATE_ESCALATED,
  PACKET_REGISTRY,
} from "../../src/lib/packet-core.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function minimalPacket(overrides = {}) {
  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: "test_packet/v1",
      packetType: "test_packet",
      packetId: makePacketId({ packetType: "test_packet", identity: { ts: Date.now() } }),
      packetState: PACKET_STATE_OPEN,
      ...overrides,
    }),
  };
}

function makeTmpRepo() {
  return mkdtempSync(join(tmpdir(), "pkt-core-test-"));
}

// ===========================================================================
// persistNamedPacket (FS tests)
// ===========================================================================
describe("persistNamedPacket", () => {
  it("writes a valid packet to disk and returns ref/path/storage_class", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket({ factoryId: "f1", runId: "r1" });
    const result = persistNamedPacket({ repo, packet });

    assert.ok(existsSync(result.packet_path));
    assert.ok(result.packet_dir);
    assert.ok(result.storage_class);
    assert.ok(result.packet_ref);
    assert.equal(result.packet_ref.packet_type, "test_packet");

    const onDisk = JSON.parse(readFileSync(result.packet_path, "utf8"));
    assert.equal(onDisk.schema_version, "test_packet/v1");
    assert.equal(onDisk.packet_type, "test_packet");
  });

  it("throws for invalid base packet (missing required fields)", () => {
    const repo = makeTmpRepo();
    assert.throws(
      () => persistNamedPacket({ repo, packet: {} }),
      /invalid_named_packet/,
    );
  });

  it("throws for durable payload validation failures", () => {
    const repo = makeTmpRepo();
    const packet = buildNamedPacketEnvelope({
      schemaVersion: "remediation_packet/v1",
      packetType: "remote_cli_runtime_crash",
      packetId: "pkt_1",
      packetState: PACKET_STATE_OPEN,
      factoryId: "f1",
      runId: "r1",
    });
    // Missing handoff_owner and handoff_kind
    assert.throws(
      () => persistNamedPacket({ repo, packet }),
      /invalid_durable_packet_payload/,
    );
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const result = persistNamedPacket({ repo, packet });
    const raw = readFileSync(result.packet_path, "utf8");
    assert.ok(raw.endsWith("\n"));
    // Pretty-printed means it contains newlines inside the JSON
    assert.ok(raw.includes("\n  "));
  });

  it("persists at repo_packet storage class when no factory/run", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const result = persistNamedPacket({ repo, packet });
    assert.equal(result.storage_class, "repo_packet");
  });

  it("persists at factory_run_packet storage class with both IDs", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket({ factoryId: "f1", runId: "r1" });
    const result = persistNamedPacket({ repo, packet });
    assert.equal(result.storage_class, "factory_run_packet");
  });
});

// ===========================================================================
// readPacketFromPath (FS tests)
// ===========================================================================
describe("readPacketFromPath", () => {
  it("reads a valid JSON packet file", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const result = persistNamedPacket({ repo, packet });
    const read = readPacketFromPath(result.packet_path);
    assert.ok(read);
    assert.equal(read.packet_type, "test_packet");
    assert.equal(read.schema_version, "test_packet/v1");
  });

  it("returns null for non-existent path", () => {
    assert.equal(readPacketFromPath("/no/such/file.json"), null);
  });

  it("returns null for empty path", () => {
    assert.equal(readPacketFromPath(""), null);
  });

  it("returns null for no arguments", () => {
    assert.equal(readPacketFromPath(), null);
  });

  it("returns null for invalid JSON content", () => {
    const repo = makeTmpRepo();
    const path = join(repo, "bad.json");
    writeFileSync(path, "not json at all", "utf8");
    assert.equal(readPacketFromPath(path), null);
  });

  it("returns parsed value for JSON array (typeof array === 'object')", () => {
    const repo = makeTmpRepo();
    const path = join(repo, "array.json");
    writeFileSync(path, "[1,2,3]", "utf8");
    // Arrays pass the `typeof === 'object'` check, so they are returned
    const result = readPacketFromPath(path);
    assert.deepEqual(result, [1, 2, 3]);
  });

  it("returns null for JSON string value", () => {
    const repo = makeTmpRepo();
    const path = join(repo, "string.json");
    writeFileSync(path, '"hello"', "utf8");
    assert.equal(readPacketFromPath(path), null);
  });

  it("returns null for JSON null value", () => {
    const repo = makeTmpRepo();
    const path = join(repo, "null.json");
    writeFileSync(path, "null", "utf8");
    assert.equal(readPacketFromPath(path), null);
  });

  it("trims the path before resolving", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const result = persistNamedPacket({ repo, packet });
    const read = readPacketFromPath(`  ${result.packet_path}  `);
    assert.ok(read);
  });
});

// ===========================================================================
// updatePersistedPacketState (FS tests)
// ===========================================================================
describe("updatePersistedPacketState", () => {
  it("updates state and writes back to disk", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket({ factoryId: "f1", runId: "r1" });
    const persisted = persistNamedPacket({ repo, packet });

    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: PACKET_STATE_RESOLVED,
      nowIso: "2025-06-01T00:00:00Z",
    });

    assert.equal(updated.packet_state, PACKET_STATE_RESOLVED);
    assert.equal(updated.updated_at, "2025-06-01T00:00:00Z");

    const onDisk = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
    assert.equal(onDisk.packet_state, PACKET_STATE_RESOLVED);
    assert.equal(onDisk.updated_at, "2025-06-01T00:00:00Z");
  });

  it("includes status_reason when provided", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const persisted = persistNamedPacket({ repo, packet });

    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: PACKET_STATE_SUPERSEDED,
      statusReason: "obsolete",
    });

    assert.equal(updated.status_reason, "obsolete");
    const onDisk = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
    assert.equal(onDisk.status_reason, "obsolete");
  });

  it("omits status_reason field when not provided", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const persisted = persistNamedPacket({ repo, packet });

    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: PACKET_STATE_RESOLVED,
    });

    assert.equal(updated.status_reason, undefined);
  });

  it("returns null for non-existent path", () => {
    const result = updatePersistedPacketState({
      packetPath: "/no/such/file.json",
      packetState: PACKET_STATE_RESOLVED,
    });
    assert.equal(result, null);
  });

  it("returns null for empty path", () => {
    const result = updatePersistedPacketState({
      packetPath: "",
      packetState: PACKET_STATE_RESOLVED,
    });
    assert.equal(result, null);
  });

  it("throws for missing packetState", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const persisted = persistNamedPacket({ repo, packet });

    assert.throws(
      () =>
        updatePersistedPacketState({
          packetPath: persisted.packet_path,
          packetState: "",
        }),
      /missing_packet_state/,
    );
  });

  it("throws for invalid packetState", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const persisted = persistNamedPacket({ repo, packet });

    assert.throws(
      () =>
        updatePersistedPacketState({
          packetPath: persisted.packet_path,
          packetState: "bogus",
        }),
      /invalid_packet_state:bogus/,
    );
  });

  it("throws when file exists but contains non-JSON", () => {
    const repo = makeTmpRepo();
    const badPath = join(repo, "corrupt.json");
    writeFileSync(badPath, "not json", "utf8");

    assert.throws(
      () =>
        updatePersistedPacketState({
          packetPath: badPath,
          packetState: PACKET_STATE_RESOLVED,
        }),
      /packet_read_failed/,
    );
  });

  it("supports the escalated state", () => {
    const repo = makeTmpRepo();
    const packet = minimalPacket();
    const persisted = persistNamedPacket({ repo, packet });

    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: PACKET_STATE_ESCALATED,
    });

    assert.equal(updated.packet_state, PACKET_STATE_ESCALATED);
  });

  it("preserves original packet fields after state update", () => {
    const repo = makeTmpRepo();
    const packet = { ...minimalPacket(), custom_field: "keep_me" };
    const persisted = persistNamedPacket({ repo, packet });

    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: PACKET_STATE_RESOLVED,
    });

    assert.equal(updated.custom_field, "keep_me");
    assert.equal(updated.schema_version, "test_packet/v1");
  });
});

// ===========================================================================
// listPersistedPackets (FS tests)
// ===========================================================================
describe("listPersistedPackets", () => {
  // Registered packet types require matching schema_version and handoff fields.
  // This helper adds the correct fields based on the registry entry.
  function setupRunWithPacket(repo, factoryId, runId, packetType, packetOverrides = {}) {
    const regEntry = findPacketRegistryEntry(packetType);
    const extraFields = {};
    if (regEntry) {
      extraFields.schemaVersion = regEntry.schema_version;
      if (regEntry.takeover_contract) {
        extraFields.handoff_owner = "supervisor";
        extraFields.handoff_kind = regEntry.takeover_contract;
      }
    }
    const packet = {
      ...buildNamedPacketEnvelope({
        packetType,
        packetId: makePacketId({ packetType, identity: { runId, ts: Date.now(), r: Math.random() } }),
        factoryId,
        runId,
        ...extraFields,
        ...packetOverrides,
      }),
      // handoff fields must be top-level for durable payload validation
      ...(regEntry?.takeover_contract
        ? {
            handoff_owner: packetOverrides.handoff_owner || "supervisor",
            handoff_kind: packetOverrides.handoff_kind || regEntry.takeover_contract,
          }
        : {}),
    };
    return persistNamedPacket({ repo, packet });
  }

  it("returns empty array when runsDir does not exist", () => {
    const result = listPersistedPackets({ runsDir: "/nonexistent/path" });
    assert.deepEqual(result, []);
  });

  it("returns empty array when runsDir is empty", () => {
    const repo = makeTmpRepo();
    const runsDir = join(repo, "runs");
    mkdirSync(runsDir, { recursive: true });
    const result = listPersistedPackets({ runsDir });
    assert.deepEqual(result, []);
  });

  it("discovers packets across multiple runs", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet", {
      createdAt: "2025-01-01T00:00:00Z",
    });
    setupRunWithPacket(repo, "f1", "run-2", "incident_packet", {
      createdAt: "2025-01-02T00:00:00Z",
    });

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({ runsDir });
    assert.equal(packets.length, 2);
  });

  it("filters by packetTypes", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");
    setupRunWithPacket(repo, "f1", "run-1", "human_blocker");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({
      runsDir,
      packetTypes: ["incident_packet"],
    });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].packet.packet_type, "incident_packet");
  });

  it("filters by packetState", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet", {
      packetState: PACKET_STATE_OPEN,
    });
    setupRunWithPacket(repo, "f1", "run-2", "incident_packet", {
      packetState: PACKET_STATE_RESOLVED,
    });

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const openPackets = listPersistedPackets({
      runsDir,
      packetState: PACKET_STATE_OPEN,
    });
    const allOpen = openPackets.filter((p) => p.packet.packet_state === PACKET_STATE_OPEN);
    assert.equal(allOpen.length, openPackets.length);
    assert.ok(allOpen.length >= 1);
  });

  it("filters by durableOnly", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const durablePackets = listPersistedPackets({
      runsDir,
      durableOnly: true,
    });
    assert.ok(durablePackets.length >= 1);
    for (const p of durablePackets) {
      assert.ok(p.registry_entry.durable, `expected durable entry for ${p.packet.packet_type}`);
    }
  });

  it("filters by families", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");
    setupRunWithPacket(repo, "f1", "run-1", "merge_conflict_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({
      runsDir,
      families: ["incident_packet"],
    });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].registry_entry.family, "incident_packet");
  });

  it("filters by windowMs", () => {
    const repo = makeTmpRepo();
    const oldDate = "2020-01-01T00:00:00Z";
    const recentDate = new Date().toISOString();

    setupRunWithPacket(repo, "f1", "run-1", "incident_packet", { createdAt: oldDate });
    setupRunWithPacket(repo, "f1", "run-2", "incident_packet", { createdAt: recentDate });

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({
      runsDir,
      windowMs: 60 * 60 * 1000, // 1 hour
      nowMs: Date.now(),
    });
    // Only the recent one should survive the window filter
    assert.equal(packets.length, 1);
  });

  it("sorts results by created_at descending", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet", {
      createdAt: "2025-01-01T00:00:00Z",
    });
    setupRunWithPacket(repo, "f1", "run-2", "incident_packet", {
      createdAt: "2025-06-01T00:00:00Z",
    });
    setupRunWithPacket(repo, "f1", "run-3", "incident_packet", {
      createdAt: "2025-03-01T00:00:00Z",
    });

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({ runsDir });
    for (let i = 1; i < packets.length; i++) {
      assert.ok(
        String(packets[i - 1].packet.created_at) >= String(packets[i].packet.created_at),
        "expected descending order by created_at",
      );
    }
  });

  it("includes run_id in result entries", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-abc", "incident_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({ runsDir });
    assert.equal(packets[0].run_id, "run-abc");
  });

  it("includes packet_ref in result entries", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packets = listPersistedPackets({ runsDir });
    assert.ok(packets[0].packet_ref);
    assert.equal(packets[0].packet_ref.packet_type, "incident_packet");
    assert.ok(packets[0].packet_ref.packet_path);
  });

  it("skips non-JSON files in packet directories", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    // Drop a non-JSON file in the packet directory
    const packetDir = join(runsDir, "run-1", "packets", "incident_packet");
    writeFileSync(join(packetDir, "readme.txt"), "not a packet", "utf8");

    const packets = listPersistedPackets({ runsDir });
    assert.equal(packets.length, 1); // only the real .json packet
  });

  it("skips unregistered packet types", () => {
    const repo = makeTmpRepo();
    const runsDir = join(repo, "runs");
    const packetDir = join(runsDir, "run-1", "packets", "unknown_type");
    mkdirSync(packetDir, { recursive: true });
    writeFileSync(
      join(packetDir, "pkt.json"),
      JSON.stringify({ packet_type: "unknown_type", created_at: "2025-01-01T00:00:00Z" }),
      "utf8",
    );

    const packets = listPersistedPackets({ runsDir });
    assert.equal(packets.length, 0);
  });

  it("skips corrupt JSON files gracefully", () => {
    const repo = makeTmpRepo();
    setupRunWithPacket(repo, "f1", "run-1", "incident_packet");

    const runsDir = join(repo, ".hatch", "f1", "runs");
    const packetDir = join(runsDir, "run-1", "packets", "incident_packet");
    writeFileSync(join(packetDir, "corrupt.json"), "{bad json", "utf8");

    const packets = listPersistedPackets({ runsDir });
    assert.equal(packets.length, 1); // only the valid one
  });
});

// ===========================================================================
// listPersistedFactoryPackets (FS tests)
// ===========================================================================
describe("listPersistedFactoryPackets", () => {
  it("returns empty array when repo is empty", () => {
    const result = listPersistedFactoryPackets({ repo: "", factoryId: "f1" });
    assert.deepEqual(result, []);
  });

  it("returns empty array when factoryId is empty", () => {
    const repo = makeTmpRepo();
    const result = listPersistedFactoryPackets({ repo, factoryId: "" });
    assert.deepEqual(result, []);
  });

  it("returns empty array when no packets exist", () => {
    const repo = makeTmpRepo();
    const result = listPersistedFactoryPackets({ repo, factoryId: "f1" });
    assert.deepEqual(result, []);
  });

  it("discovers factory-scoped packets", () => {
    const repo = makeTmpRepo();
    // Persist a packet at factory scope (no runId)
    const packet = {
      ...buildNamedPacketEnvelope({
        schemaVersion: "incident_packet.v1",
        packetType: "incident_packet",
        packetId: makePacketId({ packetType: "incident_packet", identity: { n: 1 } }),
        factoryId: "mothership",
      }),
      handoff_owner: "control_plane",
      handoff_kind: "control_plane_incident",
    };
    persistNamedPacket({ repo, packet });

    const packets = listPersistedFactoryPackets({
      repo,
      factoryId: "mothership",
    });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].packet.packet_type, "incident_packet");
  });

  it("filters by packetTypes", () => {
    const repo = makeTmpRepo();
    const pkt1 = {
      ...buildNamedPacketEnvelope({
        schemaVersion: "incident_packet.v1",
        packetType: "incident_packet",
        packetId: makePacketId({ packetType: "incident_packet", identity: { n: 1 } }),
        factoryId: "mothership",
      }),
      handoff_owner: "cp",
      handoff_kind: "control_plane_incident",
    };
    const pkt2 = {
      ...buildNamedPacketEnvelope({
        schemaVersion: "human_blocker.v1",
        packetType: "human_blocker",
        packetId: makePacketId({ packetType: "human_blocker", identity: { n: 2 } }),
        factoryId: "mothership",
      }),
      handoff_owner: "supervisor",
      handoff_kind: "human_blocker_review",
    };
    persistNamedPacket({ repo, packet: pkt1 });
    persistNamedPacket({ repo, packet: pkt2 });

    const packets = listPersistedFactoryPackets({
      repo,
      factoryId: "mothership",
      packetTypes: ["human_blocker"],
    });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].packet.packet_type, "human_blocker");
  });

  it("filters by durableOnly", () => {
    const repo = makeTmpRepo();
    const pkt = {
      ...buildNamedPacketEnvelope({
        schemaVersion: "incident_packet.v1",
        packetType: "incident_packet",
        packetId: makePacketId({ packetType: "incident_packet", identity: { n: 1 } }),
        factoryId: "mothership",
      }),
      handoff_owner: "cp",
      handoff_kind: "control_plane_incident",
    };
    persistNamedPacket({ repo, packet: pkt });

    const packets = listPersistedFactoryPackets({
      repo,
      factoryId: "mothership",
      durableOnly: true,
    });
    assert.equal(packets.length, 1);
  });

  it("handles no arguments gracefully", () => {
    const result = listPersistedFactoryPackets();
    assert.deepEqual(result, []);
  });
});

// ===========================================================================
// buildPacketRegistrySnapshot
// ===========================================================================
describe("buildPacketRegistrySnapshot", () => {
  it("returns a snapshot with schema_version and generated_at", () => {
    const snapshot = buildPacketRegistrySnapshot();
    assert.equal(snapshot.schema_version, "packet_registry/v1");
    assert.equal(snapshot.generated_at, "static");
  });

  it("includes all registry entries in packet_types", () => {
    const snapshot = buildPacketRegistrySnapshot();
    assert.equal(snapshot.packet_types.length, PACKET_REGISTRY.length);
  });

  it("sorts packet_types alphabetically by packet_type", () => {
    const snapshot = buildPacketRegistrySnapshot();
    for (let i = 1; i < snapshot.packet_types.length; i++) {
      assert.ok(
        snapshot.packet_types[i - 1].packet_type.localeCompare(snapshot.packet_types[i].packet_type) <= 0,
        `expected alphabetical order: ${snapshot.packet_types[i - 1].packet_type} <= ${snapshot.packet_types[i].packet_type}`,
      );
    }
  });

  it("includes takeover_contract field for entries that have it", () => {
    const snapshot = buildPacketRegistrySnapshot();
    const mergeConflict = snapshot.packet_types.find((e) => e.packet_type === "merge_conflict_packet");
    assert.ok(mergeConflict);
    assert.equal(mergeConflict.takeover_contract, "merge_conflict_recovery");
  });

  it("includes empty takeover_contract for entries without it", () => {
    const snapshot = buildPacketRegistrySnapshot();
    const reviewerCtx = snapshot.packet_types.find((e) => e.packet_type === "reviewer_context_packet");
    assert.ok(reviewerCtx);
    assert.equal(reviewerCtx.takeover_contract, "");
  });

  it("includes ephemeral_justification only for non-durable entries", () => {
    const snapshot = buildPacketRegistrySnapshot();
    for (const entry of snapshot.packet_types) {
      if (entry.durable === false) {
        assert.equal(typeof entry.ephemeral_justification, "string");
      } else {
        assert.equal(entry.ephemeral_justification, undefined);
      }
    }
  });

  it("maps all expected fields from registry entries", () => {
    const snapshot = buildPacketRegistrySnapshot();
    for (const entry of snapshot.packet_types) {
      assert.equal(typeof entry.packet_type, "string");
      assert.equal(typeof entry.family, "string");
      assert.equal(typeof entry.schema_version, "string");
      assert.equal(typeof entry.durable, "boolean");
      assert.equal(typeof entry.storage_class, "string");
      assert.equal(typeof entry.consumer, "string");
      assert.equal(typeof entry.validator, "string");
      assert.equal(typeof entry.takeover_contract, "string");
    }
  });
});
