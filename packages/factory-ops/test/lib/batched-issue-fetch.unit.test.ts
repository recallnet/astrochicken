import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAllOpenIssues,
  filterByLabel,
  filterBySearch,
  filterUnlabeled,
} from "../../src/lib/batched-issue-fetch.ts";

function makeIssue({ number, title = "", labels = [], body = "", milestone = null, createdAt = "", url = "", comments = 0 } = {}) {
  return {
    number,
    title: title || `Issue #${number}`,
    body,
    labels: labels.map((name) => ({ name })),
    milestone: milestone ? { title: milestone } : null,
    createdAt: createdAt || "2026-03-15T00:00:00Z",
    url: url || `https://github.com/test/repo/issues/${number}`,
    comments,
  };
}

const FIXTURES = [
  makeIssue({ number: 1, labels: ["feature"], title: "Add login" }),
  makeIssue({ number: 2, labels: ["goal", "ready"], title: "Goal: Auth" }),
  makeIssue({ number: 3, labels: ["bug"], title: "Login broken" }),
  makeIssue({ number: 4, labels: ["quarantined", "feature"], title: "Quarantined feature" }),
  makeIssue({ number: 5, labels: ["human"], title: "Need API key" }),
  makeIssue({ number: 6, labels: ["merge-followup"], title: "Merge followup #100" }),
  makeIssue({ number: 7, labels: [], title: "Unlabeled issue" }),
  makeIssue({ number: 8, labels: ["feature"], title: "Wave Ready: batch 1" }),
  makeIssue({ number: 9, labels: ["goal"], title: "Goal: Payments" }),
  makeIssue({ number: 10, labels: ["bug", "needs-triage"], title: "Flaky test" }),
];

test("fetchAllOpenIssues calls ghJsonFn once and returns all issues", () => {
  let callCount = 0;
  const ghJsonFn = (args) => {
    callCount++;
    assert.ok(args.includes("--limit"));
    assert.ok(args.includes("--state"));
    return FIXTURES;
  };

  const result = fetchAllOpenIssues({ repo: "test/repo", ghJsonFn });
  assert.equal(callCount, 1, "should make exactly one GH API call");
  assert.equal(result.length, FIXTURES.length);
});

test("fetchAllOpenIssues returns empty array on missing repo", () => {
  const result = fetchAllOpenIssues({ repo: "" });
  assert.deepEqual(result, []);
});

test("fetchAllOpenIssues returns empty array on ghJsonFn failure", () => {
  const ghJsonFn = () => null;
  const result = fetchAllOpenIssues({ repo: "test/repo", ghJsonFn });
  assert.deepEqual(result, []);
});

test("filterByLabel returns issues matching a single label", () => {
  const features = filterByLabel(FIXTURES, "feature");
  assert.deepEqual(features.map((i) => i.number), [1, 4, 8]);
});

test("filterByLabel returns issues matching multiple labels (AND)", () => {
  const quarantinedFeatures = filterByLabel(FIXTURES, ["quarantined", "feature"]);
  assert.deepEqual(quarantinedFeatures.map((i) => i.number), [4]);
});

test("filterByLabel returns empty for non-existent label", () => {
  assert.deepEqual(filterByLabel(FIXTURES, "nonexistent"), []);
});

test("filterBySearch matches title substring case-insensitively", () => {
  const waveReady = filterBySearch(FIXTURES, "Wave Ready:");
  assert.deepEqual(waveReady.map((i) => i.number), [8]);
});

test("filterBySearch returns empty when no match", () => {
  assert.deepEqual(filterBySearch(FIXTURES, "ZZZZZ"), []);
});

test("filterUnlabeled returns issues with no labels", () => {
  const unlabeled = filterUnlabeled(FIXTURES);
  assert.deepEqual(unlabeled.map((i) => i.number), [7]);
});

test("filterUnlabeled excludes issues with any labels", () => {
  const unlabeled = filterUnlabeled(FIXTURES);
  assert.equal(unlabeled.length, 1);
  assert.equal(unlabeled[0].number, 7);
});

// Integration-style: verify that one fetch + filters replaces 8 readGhList calls
test("one fetch replaces 8 readGhList calls", () => {
  let callCount = 0;
  const ghJsonFn = () => { callCount++; return FIXTURES; };

  const all = fetchAllOpenIssues({ repo: "test/repo", ghJsonFn });

  const features = filterByLabel(all, "feature");
  const goals = filterByLabel(all, "goal");
  const waveReady = filterBySearch(all, "Wave Ready:");
  const quarantined = filterByLabel(all, "quarantined");
  const bugs = filterByLabel(all, "bug");
  const human = filterByLabel(all, "human");
  const mergeFollowups = filterByLabel(all, "merge-followup");
  const unlabeled = filterUnlabeled(all);

  assert.equal(callCount, 1, "only 1 API call total");

  assert.deepEqual(features.map((i) => i.number), [1, 4, 8]);
  assert.deepEqual(goals.map((i) => i.number), [2, 9]);
  assert.deepEqual(waveReady.map((i) => i.number), [8]);
  assert.deepEqual(quarantined.map((i) => i.number), [4]);
  assert.deepEqual(bugs.map((i) => i.number), [3, 10]);
  assert.deepEqual(human.map((i) => i.number), [5]);
  assert.deepEqual(mergeFollowups.map((i) => i.number), [6]);
  assert.deepEqual(unlabeled.map((i) => i.number), [7]);
});
