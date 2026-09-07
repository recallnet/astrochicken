import assert from "node:assert/strict";
import test from "node:test";

import {
  createCachedCollectFactoryOutcomes,
} from "../../src/commands/factory-outcomes.ts";

function fakeSpawnSync() {
  return { status: 0, stdout: "" };
}

test("createCachedCollectFactoryOutcomes returns cached result within TTL", () => {
  let callCount = 0;
  const cached = createCachedCollectFactoryOutcomes({ ttlMs: 60_000 });

  const opts = {
    repo: "org/repo",
    repoPath: "/tmp/fake",
    lookbackHours: 24,
    nowMs: 1000000,
    spawnSyncFn: () => {
      callCount++;
      return { status: 0, stdout: "" };
    },
  };

  const result1 = cached(opts);
  const result2 = cached(opts);

  assert.equal(callCount, 2, "spawnSync called for first invocation (2 git commands)");
  assert.deepStrictEqual(result1, result2, "second call returns same result");
});

test("createCachedCollectFactoryOutcomes re-fetches after TTL expires", () => {
  let callCount = 0;
  const cached = createCachedCollectFactoryOutcomes({ ttlMs: 100 });

  const baseNow = Date.now();
  const makeOpts = (cacheNow) => ({
    repo: "org/repo",
    repoPath: "/tmp/fake",
    lookbackHours: 24,
    nowMs: baseNow,
    _cacheNowMs: cacheNow,
    spawnSyncFn: () => {
      callCount++;
      return { status: 0, stdout: "" };
    },
  });

  cached(makeOpts(baseNow));
  const countAfterFirst = callCount;

  // Simulate time passing beyond TTL
  cached(makeOpts(baseNow + 200));
  assert.ok(callCount > countAfterFirst, "should re-fetch after TTL expires");
});

test("createCachedCollectFactoryOutcomes caches per repo key", () => {
  let callCount = 0;
  const cached = createCachedCollectFactoryOutcomes({ ttlMs: 60_000 });

  const makeOpts = (repo) => ({
    repo,
    repoPath: "/tmp/fake",
    lookbackHours: 24,
    nowMs: 1000,
    spawnSyncFn: () => {
      callCount++;
      return { status: 0, stdout: "" };
    },
  });

  cached(makeOpts("org/repo-a"));
  cached(makeOpts("org/repo-b"));
  cached(makeOpts("org/repo-a")); // should be cached

  // 2 calls for repo-a (first), 2 for repo-b (first), 0 for repo-a (cached)
  assert.equal(callCount, 4, "2 git spawns per unique repo, repo-a second call cached");
});
