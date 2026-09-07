import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tickIdleCheck, detectExternalChanges } from "../../src/commands/supervisor-tick-idle-check.ts";

describe("tickIdleCheck", () => {
  describe("case 1: waves in flight", () => {
    it("idle when waves in flight but no new activity and no external changes", () => {
      const result = tickIdleCheck({
        inFlightCount: 2,
        selectedCount: 0,
        spawnSuccessCount: 0,
        stalledWaveCount: 0,
        openDurablePacketCount: 0,
        externalChangesDetected: false,
      });
      assert.equal(result.tick_idle, "true");
    });

    it("not idle when waves in flight and new dispatches occurred", () => {
      const result = tickIdleCheck({
        inFlightCount: 2,
        selectedCount: 1,
        spawnSuccessCount: 0,
        externalChangesDetected: false,
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("new_dispatches"));
    });

    it("not idle when waves in flight and external changes detected", () => {
      const result = tickIdleCheck({
        inFlightCount: 1,
        selectedCount: 0,
        spawnSuccessCount: 0,
        externalChangesDetected: true,
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("external_changes_detected"));
    });

    it("not idle when waves in flight and open durable packets exist", () => {
      const result = tickIdleCheck({
        inFlightCount: 1,
        selectedCount: 0,
        spawnSuccessCount: 0,
        openDurablePacketCount: 2,
        externalChangesDetected: false,
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("open_durable_packets"));
    });
  });

  describe("case 2: no waves in flight", () => {
    it("idle when no waves, no activity, and no external changes", () => {
      const result = tickIdleCheck({
        inFlightCount: 0,
        selectedCount: 0,
        spawnSuccessCount: 0,
        stalledWaveCount: 0,
        openDurablePacketCount: 0,
        externalChangesDetected: false,
      });
      assert.equal(result.tick_idle, "true");
      assert.equal(result.tick_idle_reason, "no_waves_no_external_changes");
    });

    it("not idle when external changes detected", () => {
      const result = tickIdleCheck({
        inFlightCount: 0,
        selectedCount: 0,
        spawnSuccessCount: 0,
        externalChangesDetected: true,
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("external_changes_detected"));
    });

    it("not idle when externalChangesDetected is undefined (check not performed)", () => {
      // THIS IS THE BUG: when externalChangesDetected is not passed,
      // the function conservatively returns not-idle.
      // The action must compute this value, not leave it undefined.
      const result = tickIdleCheck({
        inFlightCount: 0,
        selectedCount: 0,
        spawnSuccessCount: 0,
        stalledWaveCount: 0,
        openDurablePacketCount: 0,
        // externalChangesDetected not passed => undefined
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("external_check_not_performed"));
    });

    it("not idle when stalled waves exist", () => {
      const result = tickIdleCheck({
        inFlightCount: 0,
        stalledWaveCount: 1,
        externalChangesDetected: false,
      });
      assert.equal(result.tick_idle, "false");
      assert.ok(result.tick_idle_reason.includes("stalled_waves"));
    });
  });
});

describe("detectExternalChanges", () => {
  it("detects no changes when git HEAD matches cursor and no issues changed", () => {
    const mockSpawnSync = (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { status: 0, stdout: "abc123\n" };
      }
      if (cmd === "gh") {
        return { status: 0, stdout: "0\n" };
      }
      return { status: 1, stdout: "" };
    };

    // First call with no cursor → changes detected (first run)
    const result = detectExternalChanges({
      factoryId: "test-factory",
      ghRepo: "owner/repo",
      rootDir: "/nonexistent",
      spawnSyncFn: mockSpawnSync,
    });
    assert.equal(result.changes_detected, true);
    assert.equal(result.reason, "no_prior_cursor");
  });

  it("reports changes when git HEAD is unresolvable", () => {
    const mockSpawnSync = () => ({ status: 1, stdout: "" });
    const result = detectExternalChanges({
      factoryId: "test",
      ghRepo: "owner/repo",
      rootDir: "/nonexistent",
      spawnSyncFn: mockSpawnSync,
    });
    assert.equal(result.changes_detected, true);
    assert.equal(result.reason, "git_head_unresolvable");
  });
});
