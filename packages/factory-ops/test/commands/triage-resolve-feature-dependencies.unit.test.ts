import assert from "node:assert/strict";
import test from "node:test";

import { resolveFeatureDependencies } from "../../src/commands/triage-resolve-feature-dependencies.ts";

function buildMap(features) {
  return JSON.stringify(features.map((f, i) => ({
    issue_number: f.issueNumber,
    issue_url: `https://github.com/acme/repo/issues/${f.issueNumber}`,
    feature: {
      id: f.id,
      name: f.name || `Feature ${f.id}`,
      dependencies: f.dependencies || [],
    },
  })));
}

function createSyncSpy() {
  const calls = [];
  const fn = (opts) => {
    calls.push(opts);
    return { synced: true, added: 1, removed: 0 };
  };
  return { fn, calls };
}

test("resolveFeatureDependencies does nothing when no features have dependencies", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: [] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
  });

  assert.equal(result.resolved, 0);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.unresolved_refs, []);
  assert.equal(spy.calls.length, 0);
});

test("resolveFeatureDependencies resolves simple F-2 depends on F-1 chain", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: ["F-1"] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
  });

  assert.equal(result.resolved, 1);
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].issue_number, 11);
  assert.equal(result.dependencies[0].feature_id, "F-2");
  assert.deepEqual(result.dependencies[0].blocked_by, [10]);

  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].repo, "acme/repo");
  assert.equal(spy.calls[0].issueNumber, 11);
  assert.equal(spy.calls[0].blockedByRaw, JSON.stringify([10]));
});

test("resolveFeatureDependencies resolves multi-dependency (F-3 depends on F-1 and F-2)", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: ["F-1"] },
      { id: "F-3", issueNumber: 12, dependencies: ["F-1", "F-2"] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
  });

  assert.equal(result.resolved, 2);

  const f3Dep = result.dependencies.find((d) => d.feature_id === "F-3");
  assert.ok(f3Dep);
  assert.deepEqual(f3Dep.blocked_by, [10, 11]);

  const f3Call = spy.calls.find((c) => c.issueNumber === 12);
  assert.ok(f3Call);
  assert.equal(f3Call.blockedByRaw, JSON.stringify([10, 11]));
});

test("resolveFeatureDependencies tracks dangling dependency references", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: ["F-99"] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
  });

  assert.equal(result.resolved, 0);
  assert.equal(spy.calls.length, 0);
  assert.deepEqual(result.unresolved_refs, [{
    issue_number: 11,
    feature_id: "F-2",
    dependency_id: "F-99",
  }]);
});

test("resolveFeatureDependencies throws when failOnUnresolvedRefs=true", () => {
  const spy = createSyncSpy();
  assert.throws(() => resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: ["F-missing"] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
    failOnUnresolvedRefs: true,
  }), /unresolved_feature_dependency:F-2->F-missing/);
  assert.equal(spy.calls.length, 0, "must fail before blockedBy mutations");
});

test("resolveFeatureDependencies supports dry-run resolution without sync", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: buildMap([
      { id: "F-1", issueNumber: 10, dependencies: [] },
      { id: "F-2", issueNumber: 11, dependencies: ["F-1"] },
    ]),
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
    applySync: false,
  });

  assert.equal(result.resolved, 1);
  assert.deepEqual(result.dependencies, [{
    issue_number: 11,
    feature_id: "F-2",
    blocked_by: [10],
  }]);
  assert.equal(spy.calls.length, 0);
});

test("resolveFeatureDependencies handles empty feature_issue_map", () => {
  const spy = createSyncSpy();
  const result = resolveFeatureDependencies({
    featureIssueMapRaw: "[]",
    repo: "acme/repo",
    syncBlockedByFn: spy.fn,
  });

  assert.equal(result.resolved, 0);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.unresolved_refs, []);
  assert.equal(spy.calls.length, 0);
});
