import test from "node:test";
import assert from "node:assert/strict";
import { enumerateWaveSlots } from "../src/commands/wave-enumerate-slots.ts";

test("enumerateWaveSlots returns array of slot objects", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "2" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots, [{ slot: "0" }, { slot: "1" }]);
});

test("enumerateWaveSlots returns 3 slots for maxConcurrent=3", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "3" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 3);
  assert.equal(slots[2].slot, "2");
});

test("enumerateWaveSlots defaults to 2", () => {
  const result = enumerateWaveSlots({});
  assert.equal(JSON.parse(result).length, 2);
});

test("enumerateWaveSlots clamps to minimum 1", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "0" });
  assert.equal(JSON.parse(result).length, 1);
});

test("enumerateWaveSlots handles non-numeric input", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "abc" });
  assert.equal(JSON.parse(result).length, 2); // falls back to default
});

test("enumerateWaveSlots returns zero when no ready waves are available", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "2", readyCount: "0", inFlightCount: "0" });
  assert.equal(JSON.parse(result).length, 0);
});

test("enumerateWaveSlots limits by available ready minus in-flight", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "4", readyCount: "3", inFlightCount: "1" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots, [{ slot: "0" }, { slot: "1" }]);
});

test("enumerateWaveSlots includes newly selected waves in slot count", () => {
  // ready_count=3 (existing markers) + selected_count=1 (newly created) = 4 available
  const result = enumerateWaveSlots({ maxConcurrent: "8", readyCount: "3", inFlightCount: "0", selectedCount: "1" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 4, "should create 4 slots: 3 existing + 1 newly selected");
});

test("enumerateWaveSlots with selected_count still respects maxConcurrent cap", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "2", readyCount: "3", inFlightCount: "0", selectedCount: "2" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 2, "should cap at maxConcurrent even with selected_count");
});

test("enumerateWaveSlots with selected_count subtracts in-flight", () => {
  // 3 ready + 2 selected - 1 in-flight = 4 available, capped at maxConcurrent=8
  const result = enumerateWaveSlots({ maxConcurrent: "8", readyCount: "3", inFlightCount: "1", selectedCount: "2" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 4);
});

test("enumerateWaveSlots defaults selected_count to 0 when missing", () => {
  const result = enumerateWaveSlots({ maxConcurrent: "8", readyCount: "3", inFlightCount: "0" });
  const slots = JSON.parse(result);
  assert.equal(slots.length, 3, "without selectedCount, should use ready_count only");
});
