import assert from "node:assert/strict";
import test from "node:test";

import {
  createCachedBuildRecentHostActivity,
} from "../../src/lib/factory-fleet-projection-support.ts";

const EMPTY_ACTIVITY = {
  count: 0,
  latest_summary: "",
  latest_status: "",
  latest_graph: "",
  latest_issue: null,
  latest_updated_at: "",
  latest_updated_ms: 0,
};

test("createCachedBuildRecentHostActivity skips rescan when dir mtime unchanged", () => {
  let buildCount = 0;
  const fakeBuild = () => {
    buildCount++;
    return EMPTY_ACTIVITY;
  };

  const cached = createCachedBuildRecentHostActivity({
    statSyncFn: () => ({ mtimeMs: 1000 }),
    existsSyncFn: () => true,
    buildFn: fakeBuild,
  });

  const opts = { runsDir: "/tmp/runs", now: Date.now(), lookbackHours: 24 };

  const r1 = cached(opts);
  const r2 = cached(opts);

  assert.equal(buildCount, 1, "should build only once when mtime unchanged");
  assert.deepStrictEqual(r1, r2);
});

test("createCachedBuildRecentHostActivity rescans when dir mtime changes", () => {
  let buildCount = 0;
  let currentMtime = 1000;
  const fakeBuild = () => {
    buildCount++;
    return { ...EMPTY_ACTIVITY, count: buildCount };
  };

  const cached = createCachedBuildRecentHostActivity({
    statSyncFn: () => ({ mtimeMs: currentMtime }),
    existsSyncFn: () => true,
    buildFn: fakeBuild,
  });

  const opts = { runsDir: "/tmp/runs", now: Date.now(), lookbackHours: 24 };

  cached(opts);
  currentMtime = 2000; // mtime changed
  cached(opts);

  assert.equal(buildCount, 2, "should rebuild when mtime changes");
});

test("createCachedBuildRecentHostActivity caches per runsDir", () => {
  let buildCount = 0;
  const fakeBuild = () => {
    buildCount++;
    return EMPTY_ACTIVITY;
  };

  const cached = createCachedBuildRecentHostActivity({
    statSyncFn: () => ({ mtimeMs: 1000 }),
    existsSyncFn: () => true,
    buildFn: fakeBuild,
  });

  const baseOpts = { now: Date.now(), lookbackHours: 24 };

  cached({ ...baseOpts, runsDir: "/tmp/runs-a" });
  cached({ ...baseOpts, runsDir: "/tmp/runs-b" });
  cached({ ...baseOpts, runsDir: "/tmp/runs-a" }); // cached

  assert.equal(buildCount, 2, "2 builds: one for each unique runsDir");
});

test("createCachedBuildRecentHostActivity falls through when dir does not exist", () => {
  let buildCount = 0;
  const fakeBuild = () => {
    buildCount++;
    return EMPTY_ACTIVITY;
  };

  const cached = createCachedBuildRecentHostActivity({
    statSyncFn: () => ({ mtimeMs: 1000 }),
    existsSyncFn: () => false,
    buildFn: fakeBuild,
  });

  cached({ runsDir: "/tmp/no-exist", now: Date.now(), lookbackHours: 24 });
  cached({ runsDir: "/tmp/no-exist", now: Date.now(), lookbackHours: 24 });

  assert.equal(buildCount, 2, "should not cache when dir does not exist");
});
