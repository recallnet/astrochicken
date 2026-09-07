import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePublishedManifest,
  latestTelemetryRecord,
  reconcilePromotedChannelPins,
  reconcileRolledBackChannelPins,
  buildReconciledControllerState,
} from "../../src/commands/release-rollout-controller-state.ts";

// ---------------------------------------------------------------------------
// normalizePublishedManifest
// ---------------------------------------------------------------------------
describe("normalizePublishedManifest", () => {
  it("returns all fields trimmed from a full object", () => {
    const result = normalizePublishedManifest({
      release_id: "  r1 ",
      release_tag: " v1.0.0 ",
      release_sha: " abc123 ",
      asset_id: " a1 ",
      asset_url: " https://example.com ",
      manifest_path: " /path/to/manifest ",
      published_at: " 2026-01-01T00:00:00Z ",
    });
    assert.deepStrictEqual(result, {
      release_id: "r1",
      release_tag: "v1.0.0",
      release_sha: "abc123",
      asset_id: "a1",
      asset_url: "https://example.com",
      manifest_path: "/path/to/manifest",
      published_at: "2026-01-01T00:00:00Z",
    });
  });

  it("returns all empty strings for null input", () => {
    const result = normalizePublishedManifest(null);
    for (const value of Object.values(result)) {
      assert.equal(value, "");
    }
  });

  it("returns all empty strings for undefined input", () => {
    const result = normalizePublishedManifest(undefined);
    for (const value of Object.values(result)) {
      assert.equal(value, "");
    }
  });

  it("returns all empty strings for non-object input", () => {
    const result = normalizePublishedManifest("not-an-object");
    for (const value of Object.values(result)) {
      assert.equal(value, "");
    }
  });

  it("returns all empty strings when called with no arguments", () => {
    const result = normalizePublishedManifest();
    for (const value of Object.values(result)) {
      assert.equal(value, "");
    }
  });

  it("keeps present fields and defaults missing fields to empty string", () => {
    const result = normalizePublishedManifest({
      release_id: "r2",
      asset_url: "https://cdn.example.com/asset",
    });
    assert.equal(result.release_id, "r2");
    assert.equal(result.asset_url, "https://cdn.example.com/asset");
    assert.equal(result.release_tag, "");
    assert.equal(result.release_sha, "");
    assert.equal(result.asset_id, "");
    assert.equal(result.manifest_path, "");
    assert.equal(result.published_at, "");
  });
});

// ---------------------------------------------------------------------------
// latestTelemetryRecord
// ---------------------------------------------------------------------------
describe("latestTelemetryRecord", () => {
  it("calls renderEventFn with the last event from controller.events", () => {
    const events = [{ action: "first" }, { action: "second" }, { action: "third" }];
    let captured;
    const renderEventFn = (e) => { captured = e; return "rendered"; };
    const result = latestTelemetryRecord({ controller: { events }, renderEventFn });
    assert.equal(result, "rendered");
    assert.deepStrictEqual(captured, { action: "third" });
  });

  it("returns empty string when events array is empty", () => {
    const result = latestTelemetryRecord({
      controller: { events: [] },
      renderEventFn: () => "should-not-be-called",
    });
    assert.equal(result, "");
  });

  it("returns empty string when renderEventFn is not provided", () => {
    const result = latestTelemetryRecord({
      controller: { events: [{ action: "e1" }] },
    });
    assert.equal(result, "");
  });

  it("returns empty string when controller is null", () => {
    const result = latestTelemetryRecord({
      controller: null,
      renderEventFn: () => "x",
    });
    assert.equal(result, "");
  });

  it("returns empty string when called with no arguments", () => {
    const result = latestTelemetryRecord();
    assert.equal(result, "");
  });

  it("returns empty string when controller.events is not an array", () => {
    const result = latestTelemetryRecord({
      controller: { events: "not-array" },
      renderEventFn: () => "x",
    });
    assert.equal(result, "");
  });
});

// ---------------------------------------------------------------------------
// reconcilePromotedChannelPins
// ---------------------------------------------------------------------------
describe("reconcilePromotedChannelPins", () => {
  it("throws when writeReleaseManifestFileFn is missing", () => {
    assert.throws(
      () => reconcilePromotedChannelPins({ candidateManifest: {} }),
      { message: "missing_write_release_manifest_file_fn" },
    );
  });

  it("calls writeReleaseManifestFileFn twice with canary and general paths", () => {
    const calls = [];
    const writeFn = (path, manifest) => calls.push({ path, manifest });
    const manifest = { release_id: "r1" };

    const result = reconcilePromotedChannelPins({
      candidateManifest: manifest,
      canaryManifestPath: " /canary.json ",
      generalManifestPath: " /general.json ",
      writeReleaseManifestFileFn: writeFn,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, " /canary.json ");
    assert.deepStrictEqual(calls[0].manifest, manifest);
    assert.equal(calls[1].path, " /general.json ");
    assert.deepStrictEqual(calls[1].manifest, manifest);

    // returned paths are trimmed
    assert.equal(result.canary_manifest_path, "/canary.json");
    assert.equal(result.general_manifest_path, "/general.json");
  });

  it("returns trimmed paths", () => {
    const result = reconcilePromotedChannelPins({
      canaryManifestPath: "  canary  ",
      generalManifestPath: "  general  ",
      writeReleaseManifestFileFn: () => {},
    });
    assert.equal(result.canary_manifest_path, "canary");
    assert.equal(result.general_manifest_path, "general");
  });
});

// ---------------------------------------------------------------------------
// reconcileRolledBackChannelPins
// ---------------------------------------------------------------------------
describe("reconcileRolledBackChannelPins", () => {
  it("throws when restoreChannelPinFn is missing", () => {
    assert.throws(
      () => reconcileRolledBackChannelPins({}),
      { message: "missing_restore_channel_pin_fn" },
    );
  });

  it("calls restoreChannelPinFn twice with correct args", () => {
    const calls = [];
    const restoreFn = (args) => calls.push(args);

    const result = reconcileRolledBackChannelPins({
      releasesDir: "/releases",
      canaryManifestPath: " /canary.json ",
      generalManifestPath: " /general.json ",
      previousCanaryReleaseId: "prev-canary",
      previousGeneralReleaseId: "prev-general",
      restoreChannelPinFn: restoreFn,
    });

    assert.equal(calls.length, 2);

    // first call: canary
    assert.deepStrictEqual(calls[0], {
      channelManifestPath: " /canary.json ",
      previousReleaseId: "prev-canary",
      releasesDir: "/releases",
    });

    // second call: general
    assert.deepStrictEqual(calls[1], {
      channelManifestPath: " /general.json ",
      previousReleaseId: "prev-general",
      releasesDir: "/releases",
    });

    // returned paths are trimmed
    assert.equal(result.canary_manifest_path, "/canary.json");
    assert.equal(result.general_manifest_path, "/general.json");
  });

  it("uses default releasesDir when not provided", () => {
    const calls = [];
    reconcileRolledBackChannelPins({
      canaryManifestPath: "/c.json",
      generalManifestPath: "/g.json",
      previousCanaryReleaseId: "c1",
      previousGeneralReleaseId: "g1",
      restoreChannelPinFn: (args) => calls.push(args),
    });
    assert.equal(calls[0].releasesDir, ".hatch/releases");
    assert.equal(calls[1].releasesDir, ".hatch/releases");
  });
});

// ---------------------------------------------------------------------------
// buildReconciledControllerState
// ---------------------------------------------------------------------------
describe("buildReconciledControllerState", () => {
  it("throws when writeControllerStateFn is missing", () => {
    assert.throws(
      () => buildReconciledControllerState({}),
      { message: "missing_write_controller_state_fn" },
    );
  });

  it("passes merged controller state to writeControllerStateFn", () => {
    let captured;
    const writeFn = (manifest, state) => {
      captured = { manifest, state };
      return { written: true };
    };

    const manifest = { id: "m1" };
    const controller = {
      channel: "stable",
      pinned_release_id: "r5",
      previous_canary_release_id: "r3",
      previous_general_release_id: "r4",
      canary_factory_ids: ["f1", "f2"],
      canary_max_factories: 3,
      candidate_manifest_path: "/candidate.json",
      canary_manifest_path: "/canary.json",
      general_manifest_path: "/general.json",
      health: { ok: true },
      publish: { asset_id: "a1" },
      events: [{ action: "promote" }],
      extra_field: "should-be-spread",
    };

    const result = buildReconciledControllerState({
      manifest,
      controller,
      status: "active",
      stage: "canary",
      resumeBlocked: true,
      rollbackReason: "health-check-failed",
      lease: { holder: "h1" },
      updatedAt: "2026-03-23T00:00:00Z",
      writeControllerStateFn: writeFn,
    });

    assert.deepStrictEqual(result, { written: true });
    assert.deepStrictEqual(captured.manifest, manifest);

    const s = captured.state;
    assert.equal(s.status, "active");
    assert.equal(s.stage, "canary");
    assert.equal(s.resume_blocked, true);
    assert.equal(s.rollback_reason, "health-check-failed");
    assert.equal(s.channel, "stable");
    assert.equal(s.pinned_release_id, "r5");
    assert.equal(s.previous_canary_release_id, "r3");
    assert.equal(s.previous_general_release_id, "r4");
    assert.deepStrictEqual(s.canary_factory_ids, ["f1", "f2"]);
    assert.equal(s.canary_max_factories, 3);
    assert.equal(s.candidate_manifest_path, "/candidate.json");
    assert.equal(s.canary_manifest_path, "/canary.json");
    assert.equal(s.general_manifest_path, "/general.json");
    assert.deepStrictEqual(s.health, { ok: true });
    assert.deepStrictEqual(s.publish, { asset_id: "a1" });
    assert.deepStrictEqual(s.events, [{ action: "promote" }]);
    assert.deepStrictEqual(s.lease, { holder: "h1" });
    assert.equal(s.updated_at, "2026-03-23T00:00:00Z");
  });

  it("preserves extra controller fields via spread", () => {
    let captured;
    const writeFn = (_m, state) => { captured = state; };

    buildReconciledControllerState({
      controller: { custom_field: "preserved", channel: "beta" },
      writeControllerStateFn: writeFn,
    });

    assert.equal(captured.custom_field, "preserved");
    assert.equal(captured.channel, "beta");
  });

  it("uses default values when options are minimal", () => {
    let captured;
    const writeFn = (manifest, state) => { captured = { manifest, state }; };

    buildReconciledControllerState({ writeControllerStateFn: writeFn });

    assert.deepStrictEqual(captured.manifest, {});
    assert.equal(captured.state.status, "");
    assert.equal(captured.state.stage, "");
    assert.equal(captured.state.resume_blocked, false);
    assert.equal(captured.state.rollback_reason, "");
    assert.deepStrictEqual(captured.state.lease, {});
    assert.equal(captured.state.updated_at, "");
  });
});
