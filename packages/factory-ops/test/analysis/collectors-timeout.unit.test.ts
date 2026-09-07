import assert from "node:assert/strict";
import test from "node:test";

import { withTimeout, COLLECTOR_TIMEOUT_MS } from "../../src/lib/analysis/collectors.ts";

test("COLLECTOR_TIMEOUT_MS is bounded", () => {
  assert.ok(COLLECTOR_TIMEOUT_MS > 0, "must be positive");
  assert.ok(COLLECTOR_TIMEOUT_MS <= 300_000, "must be ≤ 5 minutes");
});

test("withTimeout resolves normally when promise completes before deadline", async () => {
  const result = await withTimeout(Promise.resolve({ data: 42 }), "fast_collector", 500);
  assert.deepEqual(result, { data: 42 });
});

test("withTimeout returns degraded envelope when promise never resolves", async () => {
  const neverResolves = new Promise(() => {});
  const result = await withTimeout(neverResolves, "stuck_collector", 100);

  assert.equal(result.source, "stuck_collector");
  assert.equal(result._timed_out, true);
  assert.ok(Array.isArray(result.missing_data));
  assert.ok(result.missing_data[0].detail.includes("timed out"));
});

test("withTimeout propagates rejections from the underlying promise", async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error("boom")), "failing_collector", 500),
    { message: "boom" },
  );
});

test("withTimeout clears timer on fast resolution (no leaked timers)", async () => {
  const start = Date.now();
  await withTimeout(Promise.resolve("ok"), "quick", 60_000);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `should resolve instantly, not wait for timeout; took ${elapsed}ms`);
});
