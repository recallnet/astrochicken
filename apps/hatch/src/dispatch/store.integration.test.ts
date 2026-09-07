import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runDispatchLoop } from "./loop.js";
import {
  DISPATCH_QUEUE_FILE,
  DISPATCH_STORE_DIR,
  dispatchQueueSnapshotPath,
  dispatchRelativePath,
  dispatchStorePaths,
  ensureDispatchStore,
  nextDispatchTickId,
  saveDispatchRunRecord,
  saveDispatchTickRecord,
} from "./store.js";

describe("dispatch store/runtime", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("creates deterministic dispatch store paths and persists run/tick records", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "hatch-dispatch-store-"));
    cleanupDirs.push(rootDir);

    const paths = dispatchStorePaths(rootDir);
    expect(paths.storeDir).toBe(join(rootDir, DISPATCH_STORE_DIR));
    expect(paths.queueSnapshotsDir).toBe(join(rootDir, DISPATCH_STORE_DIR, "queue-snapshots"));
    expect(paths.ticksDir).toBe(join(rootDir, DISPATCH_STORE_DIR, "ticks"));
    expect(paths.runsDir).toBe(join(rootDir, DISPATCH_STORE_DIR, "runs"));

    const ensured = ensureDispatchStore(rootDir);
    expect(ensured).toEqual(paths);

    const tickId = nextDispatchTickId(rootDir);
    expect(tickId).toBe("tick-000001");
    const snapshotPath = dispatchQueueSnapshotPath(rootDir, tickId);
    expect(dispatchRelativePath(rootDir, snapshotPath)).toBe(`.hatch/dispatch/queue-snapshots/${tickId}.json`);
    expect(dispatchRelativePath(rootDir, join(rootDir, DISPATCH_STORE_DIR, DISPATCH_QUEUE_FILE))).toBe(".hatch/dispatch/queue.json");

    saveDispatchTickRecord(rootDir, {
      tick_id: tickId,
      status: "completed",
      started_at: "2026-03-10T00:00:00.000Z",
      completed_at: "2026-03-10T00:00:05.000Z",
      queue_source: ".hatch/dispatch/queue.json",
      queue_snapshot: ".hatch/dispatch/queue-snapshots/tick-000001.json",
      max_per_tick: 2,
      selected: [],
      run_ids: [],
    });
    saveDispatchRunRecord(rootDir, {
      run_id: "run-1",
      tick_id: tickId,
      graph: "/tmp/graph.dot",
      status: "running",
      command: "hatch run /tmp/graph.dot --run-id run-1",
      created_at: "2026-03-10T00:00:00.000Z",
    });

    expect(JSON.parse(readFileSync(join(paths.ticksDir, `${tickId}.json`), "utf8")).status).toBe("completed");
    expect(JSON.parse(readFileSync(join(paths.runsDir, "run-1.json"), "utf8")).command).toContain("run-1");

    mkdirSync(paths.ticksDir, { recursive: true });
    writeFileSync(join(paths.ticksDir, "tick-000007.json"), "{}");
    expect(nextDispatchTickId(rootDir)).toBe("tick-000008");
  });

  it("runDispatchLoop honors runOnce and abort semantics", async () => {
    const tick = vi.fn(async () => {});

    await runDispatchLoop({
      rootDir: "/tmp/factory-root",
      runOnce: true,
      intervalMs: 1,
      maxPerTick: 3,
    }, tick);

    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith(expect.objectContaining({
      rootDir: "/tmp/factory-root",
      maxPerTick: 3,
    }));

    const controller = new AbortController();
    controller.abort();
    await runDispatchLoop({
      rootDir: "/tmp/factory-root",
      signal: controller.signal,
      intervalMs: 1,
    }, tick);

    expect(tick).toHaveBeenCalledTimes(1);
  });
});
