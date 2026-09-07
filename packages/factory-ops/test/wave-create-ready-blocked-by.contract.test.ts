import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadyMarkers,
  findPriorWaveMarkerNumber,
} from "../src/commands/wave-create-ready.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildGhStubs() {
  let nextIssueNumber = 100;
  const issues = [];
  const syncCalls = [];

  function ghJsonFn(args) {
    const cmd = args[0];
    if (cmd === "issue" && args[1] === "list") {
      const stateIdx = args.indexOf("--state");
      const state = stateIdx >= 0 ? args[stateIdx + 1] : "open";
      return issues
        .filter((i) => state === "all" || i.state === state)
        .map((i) => ({
          number: i.number,
          title: i.title,
          url: `https://github.com/test/repo/issues/${i.number}`,
          milestone: { title: i.milestone },
          labels: i.labels.map((l) => ({ name: l })),
          state: i.state,
        }));
    }
    if (cmd === "api") return [];
    return [];
  }

  function ghFn(args) {
    if (args[0] === "issue" && args[1] === "create") {
      const titleIdx = args.indexOf("--title");
      const milestoneIdx = args.indexOf("--milestone");
      const labelIdx = args.indexOf("--label");
      const num = nextIssueNumber++;
      issues.push({
        number: num,
        title: titleIdx >= 0 ? args[titleIdx + 1] : "",
        milestone: milestoneIdx >= 0 ? args[milestoneIdx + 1] : "",
        labels: labelIdx >= 0 ? [args[labelIdx + 1]] : [],
        state: "open",
      });
      return { ok: true, stdout: `https://github.com/test/repo/issues/${num}\n` };
    }
    return { ok: true, stdout: "" };
  }

  function syncBlockedByFn({ repo, issueNumber, blockedByRaw }) {
    syncCalls.push({ repo, issueNumber, blockedByRaw });
    return { synced: true, added: 1, removed: 0 };
  }

  return { ghJsonFn, ghFn, syncBlockedByFn, issues, syncCalls };
}

// ─── findPriorWaveMarkerNumber ───────────────────────────────────────────────

test("findPriorWaveMarkerNumber: finds wave-1 marker when looking up wave-2", () => {
  const { ghJsonFn, issues } = buildGhStubs();
  issues.push({ number: 50, title: "Wave Ready: goal-99-wave-1", milestone: "goal-99-wave-1", labels: ["ready"], state: "open" });

  const result = findPriorWaveMarkerNumber("goal-99-wave-2", ghJsonFn, "test/repo");
  assert.equal(result, 50);
});

test("findPriorWaveMarkerNumber: returns 0 for wave-1 (no prior wave)", () => {
  const { ghJsonFn } = buildGhStubs();
  assert.equal(findPriorWaveMarkerNumber("goal-99-wave-1", ghJsonFn, "test/repo"), 0);
});

test("findPriorWaveMarkerNumber: returns 0 for malformed wave title", () => {
  const { ghJsonFn } = buildGhStubs();
  assert.equal(findPriorWaveMarkerNumber("not-a-wave", ghJsonFn, "test/repo"), 0);
  assert.equal(findPriorWaveMarkerNumber("", ghJsonFn, "test/repo"), 0);
  assert.equal(findPriorWaveMarkerNumber("goal-wave-2", ghJsonFn, "test/repo"), 0);
});

test("findPriorWaveMarkerNumber: returns 0 when gh API returns null/error", () => {
  const errorGhJson = () => null;
  assert.equal(findPriorWaveMarkerNumber("goal-99-wave-2", errorGhJson, "test/repo"), 0);

  const emptyGhJson = () => [];
  assert.equal(findPriorWaveMarkerNumber("goal-99-wave-2", emptyGhJson, "test/repo"), 0);
});

test("findPriorWaveMarkerNumber: ignores closed markers — only finds open", () => {
  const { ghJsonFn, issues } = buildGhStubs();
  issues.push({ number: 50, title: "Wave Ready: goal-99-wave-1", milestone: "goal-99-wave-1", labels: ["ready"], state: "closed" });

  // ghJsonFn filters by --state open, so closed markers are invisible
  const result = findPriorWaveMarkerNumber("goal-99-wave-2", ghJsonFn, "test/repo");
  assert.equal(result, 0, "closed prior wave marker should not be found");
});

test("findPriorWaveMarkerNumber: doesn't match partial title collisions", () => {
  const { ghJsonFn, issues } = buildGhStubs();
  // A marker with a similar-looking title that shouldn't match
  issues.push({ number: 60, title: "Wave Ready: goal-99-wave-10", milestone: "goal-99-wave-10", labels: ["ready"], state: "open" });

  // Looking for prior of wave-2 (i.e. wave-1) — wave-10 should not match
  const result = findPriorWaveMarkerNumber("goal-99-wave-2", ghJsonFn, "test/repo");
  assert.equal(result, 0);
});

// ─── createReadyMarkers: happy paths ─────────────────────────────────────────

test("createReadyMarkers: 3 fresh waves → 3 markers, wave-2 blocked-by wave-1, wave-3 blocked-by wave-2", () => {
  const { ghJsonFn, ghFn, syncBlockedByFn, issues, syncCalls } = buildGhStubs();

  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-1940-wave-1", "goal-1940-wave-2", "goal-1940-wave-3"],
    ghJsonFn, ghFn, syncBlockedByFn,
  });

  assert.equal(issues.length, 3);

  const chainCalls = syncCalls.filter((c) => JSON.parse(c.blockedByRaw).length > 0);
  assert.equal(chainCalls.length, 2);
  assert.equal(chainCalls[0].issueNumber, 101);
  assert.deepEqual(JSON.parse(chainCalls[0].blockedByRaw), [100]);
  assert.equal(chainCalls[1].issueNumber, 102);
  assert.deepEqual(JSON.parse(chainCalls[1].blockedByRaw), [101]);
});

test("createReadyMarkers: single wave-1 → no blocked-by", () => {
  const { ghJsonFn, ghFn, syncBlockedByFn, syncCalls } = buildGhStubs();

  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-42-wave-1"],
    ghJsonFn, ghFn, syncBlockedByFn,
  });

  const chainCalls = syncCalls.filter((c) => JSON.parse(c.blockedByRaw).length > 0);
  assert.equal(chainCalls.length, 0);
});

// ─── createReadyMarkers: cross-tick scenarios (the production bug) ───────────

test("cross-tick: wave-1 exists from tick N, wave-2/3 dispatched on tick N+1 → wave-2 blocked-by wave-1", () => {
  const { ghJsonFn, ghFn, syncBlockedByFn, issues, syncCalls } = buildGhStubs();

  // Tick N: created wave-1
  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-1940-wave-1"],
    ghJsonFn, ghFn, syncBlockedByFn,
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].number, 100); // wave-1 is issue #100

  // Tick N+1: only wave-2 and wave-3
  const tick2SyncCalls = [];
  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-1940-wave-2", "goal-1940-wave-3"],
    ghJsonFn, ghFn,
    syncBlockedByFn: (args) => { tick2SyncCalls.push(args); return { synced: true, added: 1, removed: 0 }; },
  });

  // wave-2 (#101) must be blocked by wave-1 (#100) even though wave-1 was from a different call
  const wave2Chain = tick2SyncCalls.filter((c) => c.issueNumber === 101 && JSON.parse(c.blockedByRaw).length > 0);
  assert.equal(wave2Chain.length, 1, "wave-2 must be blocked by wave-1 across ticks");
  assert.deepEqual(JSON.parse(wave2Chain[0].blockedByRaw), [100]);

  // wave-3 (#102) blocked by wave-2 (#101)
  const wave3Chain = tick2SyncCalls.filter((c) => c.issueNumber === 102 && JSON.parse(c.blockedByRaw).length > 0);
  assert.equal(wave3Chain.length, 1, "wave-3 must be blocked by wave-2");
  assert.deepEqual(JSON.parse(wave3Chain[0].blockedByRaw), [101]);
});

test("cross-tick: each wave dispatched on its own tick → each gets blocked-by its predecessor", () => {
  const { ghJsonFn, ghFn, issues } = buildGhStubs();

  const allSyncCalls = [];
  const trackingSync = (args) => { allSyncCalls.push(args); return { synced: true, added: 1, removed: 0 }; };

  // Tick 1: wave-1 only
  createReadyMarkers({ repo: "test/repo", waves: ["goal-5-wave-1"], ghJsonFn, ghFn, syncBlockedByFn: trackingSync });
  // Tick 2: wave-2 only
  createReadyMarkers({ repo: "test/repo", waves: ["goal-5-wave-2"], ghJsonFn, ghFn, syncBlockedByFn: trackingSync });
  // Tick 3: wave-3 only
  createReadyMarkers({ repo: "test/repo", waves: ["goal-5-wave-3"], ghJsonFn, ghFn, syncBlockedByFn: trackingSync });

  assert.equal(issues.length, 3);

  const chainCalls = allSyncCalls.filter((c) => JSON.parse(c.blockedByRaw).length > 0);
  assert.equal(chainCalls.length, 2, "2 blocked-by calls: wave-2→wave-1, wave-3→wave-2");

  // wave-2 (#101) blocked by wave-1 (#100)
  assert.equal(chainCalls[0].issueNumber, 101);
  assert.deepEqual(JSON.parse(chainCalls[0].blockedByRaw), [100]);

  // wave-3 (#102) blocked by wave-2 (#101)
  assert.equal(chainCalls[1].issueNumber, 102);
  assert.deepEqual(JSON.parse(chainCalls[1].blockedByRaw), [101]);
});

// ─── Failure paths ───────────────────────────────────────────────────────────

test("syncBlockedBy failure: chain continues even when sync fails for one wave", () => {
  const { ghJsonFn, ghFn, issues } = buildGhStubs();

  let callCount = 0;
  const failingSync = (args) => {
    callCount++;
    if (callCount === 1) return { synced: false, added: 0, removed: 0 }; // fail wave-2's sync
    return { synced: true, added: 1, removed: 0 };
  };

  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-10-wave-1", "goal-10-wave-2", "goal-10-wave-3"],
    ghJsonFn, ghFn,
    syncBlockedByFn: failingSync,
  });

  // All 3 markers still created regardless of sync failure
  assert.equal(issues.length, 3);
  // syncBlockedBy was called 2 times (wave-2 and wave-3), even though wave-2's failed
  assert.equal(callCount, 2);
});

test("gh API returns empty array: prior wave not found → wave-2 gets no blocked-by", () => {
  const { ghFn, syncCalls } = buildGhStubs();

  // ghJsonFn always returns empty — simulates API returning nothing
  const emptyGhJson = () => [];

  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-50-wave-2", "goal-50-wave-3"],
    ghJsonFn: emptyGhJson, ghFn,
    syncBlockedByFn: (args) => { syncCalls.push(args); return { synced: true, added: 1, removed: 0 }; },
  });

  // No markers were created (ghFn creates, but ghJsonFn returns empty so createWaveReadyMarker
  // never matches existing and tries gh issue create — which does work via ghFn)
  // But the prior wave lookup found nothing → wave-2 has no blocked-by seed
  // wave-3 is still blocked by wave-2 (same batch)
  const chainCalls = syncCalls.filter((c) => JSON.parse(c.blockedByRaw).length > 0);
  // wave-2 has no prior (API returned nothing), wave-3 blocked by wave-2
  assert.equal(chainCalls.length, 1, "only wave-3→wave-2 chain, wave-2 has no prior");
});

test("gh issue create fails: marker with no issue number doesn't break chain", () => {
  const { ghJsonFn, issues } = buildGhStubs();
  const syncCalls = [];

  let createCallCount = 0;
  const failingGhFn = (args) => {
    if (args[0] === "issue" && args[1] === "create") {
      createCallCount++;
      if (createCallCount === 2) return { ok: false, stdout: "" }; // wave-2 create fails
      const num = 100 + createCallCount;
      issues.push({
        number: num,
        title: args[args.indexOf("--title") + 1],
        milestone: args[args.indexOf("--milestone") + 1],
        labels: ["ready"],
        state: "open",
      });
      return { ok: true, stdout: `https://github.com/test/repo/issues/${num}\n` };
    }
    return { ok: true, stdout: "" };
  };

  createReadyMarkers({
    repo: "test/repo",
    waves: ["goal-20-wave-1", "goal-20-wave-2", "goal-20-wave-3"],
    ghJsonFn,
    ghFn: failingGhFn,
    syncBlockedByFn: (args) => { syncCalls.push(args); return { synced: true, added: 1, removed: 0 }; },
  });

  // wave-1 created (#101), wave-2 failed (no number), wave-3 created (#103)
  // wave-2 would have been blocked by wave-1 but since it failed to create, markerNum=0
  // wave-3 should still chain to the last successful marker (wave-1 #101)
  const chainCalls = syncCalls.filter((c) => JSON.parse(c.blockedByRaw).length > 0);
  assert.ok(chainCalls.length >= 1, "at least wave-3 should chain to last good marker");
});

test("empty waves array: no-op, no crashes", () => {
  const { ghJsonFn, ghFn, syncBlockedByFn, syncCalls } = buildGhStubs();

  const results = createReadyMarkers({
    repo: "test/repo",
    waves: [],
    ghJsonFn, ghFn, syncBlockedByFn,
  });

  assert.deepEqual(results, []);
  assert.equal(syncCalls.length, 0);
});
