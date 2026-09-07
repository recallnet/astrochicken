import assert from "node:assert/strict";
import test from "node:test";

import { rowAttention, summarizeWarning } from "../../src/cli/fleet-tui/format.ts";

// ── summarizeWarning ────────────────────────────────────────────────

test("summarizeWarning translates manifest_fetch_failed to human text", () => {
  assert.equal(summarizeWarning("manifest_fetch_failed"), "release targeting degraded");
});

test("summarizeWarning translates context_resolution_failed", () => {
  assert.equal(summarizeWarning("context_resolution_failed"), "context resolution degraded");
});

test("summarizeWarning returns empty string for empty input", () => {
  assert.equal(summarizeWarning(""), "");
  assert.equal(summarizeWarning(), "");
});

// ── rowAttention ────────────────────────────────────────────────────

test("rowAttention surfaces gate_reason when release targeting is configured", () => {
  const row = {
    gate_reason: "manifest_fetch_failed",
    rollout_status: "blocked",
    warnings: [],
  };
  assert.equal(rowAttention(row), "release targeting degraded");
});

test("rowAttention suppresses gate_reason when rollout_status is unknown (release targeting not configured)", () => {
  const row = {
    gate_reason: "manifest_fetch_failed",
    rollout_status: "unknown",
    warnings: [],
  };
  // When release targeting is not configured, manifest_fetch_failed is expected
  // and should not be surfaced as operator attention
  assert.equal(rowAttention(row), "");
});

test("rowAttention suppresses gate_reason when rollout_status is absent", () => {
  const row = {
    gate_reason: "manifest_fetch_failed",
    warnings: [],
  };
  assert.equal(rowAttention(row), "");
});

test("rowAttention still surfaces blocked_reason regardless of rollout_status", () => {
  const row = {
    blocked_reason: "operator quarantine",
    gate_reason: "manifest_fetch_failed",
    rollout_status: "unknown",
    warnings: [],
  };
  assert.equal(rowAttention(row), "operator quarantine");
});

test("rowAttention surfaces warnings even when gate_reason is suppressed", () => {
  const row = {
    gate_reason: "manifest_fetch_failed",
    rollout_status: "unknown",
    warnings: ["runs_dir_missing:/tmp/foo"],
  };
  assert.equal(rowAttention(row), "runs dir missing");
});

test("rowAttention returns empty for a healthy factory with no issues", () => {
  const row = {
    blocked_reason: "",
    managed_state: { reason: "" },
    control_plane_blocker: "",
    gate_reason: "",
    rollout_status: "unknown",
    warnings: [],
  };
  assert.equal(rowAttention(row), "");
});
