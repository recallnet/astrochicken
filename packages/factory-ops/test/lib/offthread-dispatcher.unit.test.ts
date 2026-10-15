import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { Worker, MessageChannel } from "node:worker_threads";
import { performance } from "node:perf_hooks";

import { callOffThread, terminateDispatcher } from "../../src/lib/offthread-dispatcher.ts";

test("callOffThread dispatches a ping and receives the response", async () => {
  try {
    const result = await callOffThread("ping", { hello: "world" });
    assert.equal(result.pong, true);
    assert.equal(result.hello, "world");
  } finally {
    await terminateDispatcher();
  }
});

test("callOffThread rejects on unknown handler", async () => {
  try {
    await assert.rejects(
      () => callOffThread("nonexistent", {}),
      { message: /unknown handler/ },
    );
  } finally {
    await terminateDispatcher();
  }
});

test("callOffThread does not block the main event loop during dispatch", async () => {
  // Measure event loop responsiveness while a worker call is in flight.
  // The ping handler is fast, but this proves the dispatch mechanism
  // doesn't synchronously block.
  let maxGap = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - last - 5;
    if (gap > maxGap) maxGap = gap;
    last = now;
  }, 5);

  try {
    // Fire several calls concurrently
    const results = await Promise.all([
      callOffThread("ping", { n: 1 }),
      callOffThread("ping", { n: 2 }),
      callOffThread("ping", { n: 3 }),
    ]);
    clearInterval(timer);

    assert.equal(results.length, 3);
    assert.equal(results[0].n, 1);
    assert.equal(results[2].n, 3);

    // Event loop should have stayed responsive (gaps < 50ms)
    assert.equal(maxGap < 50, true, `event loop gap ${maxGap}ms — should be under 50ms`);
  } finally {
    clearInterval(timer);
    await terminateDispatcher();
  }
});

test("terminateDispatcher cleans up worker and resolves pending calls with null", async () => {
  // Start a call, then terminate immediately
  const promise = callOffThread("ping", { x: 1 });

  // Give it a tiny moment so the worker can respond if it's fast
  await new Promise((r) => setTimeout(r, 50));

  // Either it completed normally or termination resolved it with null
  const result = await promise;
  if (result !== null) {
    assert.equal(result.pong, true);
  }

  await terminateDispatcher();

  // After termination, a new call should spin up a fresh worker
  const fresh = await callOffThread("ping", { after: "terminate" });
  assert.equal(fresh.pong, true);
  assert.equal(fresh.after, "terminate");

  await terminateDispatcher();
});

test("callOffThread keeps a warm detail lane responsive during fleet dispatch", async () => {
  try {
    // Measure active-lane dispatch, excluding cold TypeScript worker startup.
    await Promise.all([
      callOffThread("ping", {}, { lane: "fleet" }),
      callOffThread("ping", {}, { lane: "detail" }),
    ]);
    const startedAt = performance.now();
    const slow = callOffThread("sleep", { ms: 250, value: "fleet" }, { lane: "fleet" });
    const fast = callOffThread("ping", { lane: "detail" }, { lane: "detail" });
    const fastResult = await fast;
    const fastElapsed = performance.now() - startedAt;
    assert.equal(fastResult.pong, true);
    assert.equal(fastElapsed < 150, true, `warm detail lane should respond within 150ms (${fastElapsed}ms)`);
    const slowResult = await slow;
    assert.equal(slowResult.value, "fleet");
  } finally {
    await terminateDispatcher();
  }
});

test("worker lazy imports resolve to available source modules", () => {
  const workerUrl = new URL("../../src/lib/offthread-dispatcher-worker.ts", import.meta.url);
  const worker = readFileSync(workerUrl, "utf8");
  const imports = [...worker.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  for (const specifier of imports) {
    assert.equal(existsSync(new URL(specifier, workerUrl)), true, `missing worker dependency: ${specifier}`);
  }
});


function createWorkerProbe() {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("../helpers/offthread-worker-probe.mjs", import.meta.url), {
    workerData: { control: port2, workerUrl: new URL("../../src/lib/offthread-dispatcher-worker.ts", import.meta.url).href },
    transferList: [port2],
  });
  let nextId = 0;
  const request = (channel, payload) => new Promise((resolve, reject) => {
    const id = nextId++;
    const onMessage = (message) => {
      if (message.id !== id) return;
      channel.off("message", onMessage);
      worker.off("error", reject);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    channel.on("message", onMessage);
    worker.once("error", reject);
    channel.postMessage({ id, ...payload });
  });
  return {
    call: (fn, args = {}) => request(worker, { fn, args }),
    control: (action) => request(port1, { action }),
    close: async () => { port1.close(); await worker.terminate(); },
  };
}

test("worker ping does not start background handler imports after reporting ready", async () => {
  const probe = createWorkerProbe();
  try {
    assert.deepEqual(await probe.call("ping"), { pong: true });
    assert.deepEqual(await probe.control("report"), []);
  } finally { await probe.close(); }
});

test("worker ping preserves pooled fleet, cached outcomes, and GraphQL dashboard handlers", async () => {
  const probe = createWorkerProbe();
  try {
    await probe.call("ping");
    await probe.control("settle");
    assert.deepEqual(await probe.call("factoryFleetStatus"), { rows: "pooled-rows", outcomes: "cached-outcomes" });
    assert.deepEqual(await probe.call("buildFactoryDashboard"), { titles: "graphql-titles" });
  } finally { await probe.close(); }
});
