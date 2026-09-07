import assert from "node:assert/strict";
import test from "node:test";

import { splitMergeResults, buildWaveMergeResults } from "../../src/commands/wave-merge-results.ts";

// ─── buildWaveMergeResults ───────────────────────────────────────────────────

test("buildWaveMergeResults marks all candidates as merged when mergeStatus is merged", () => {
  const candidates = JSON.stringify([
    { issue_number: "1", branch: "wave/goal-1-wave-1" },
    { issue_number: "2", branch: "wave/goal-1-wave-1" },
  ]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
    mergeNotes: "clean",
    mergeResolver: "deterministic",
    pathTaken: "merge",
  });
  assert.equal(out.merged_count, 2);
  assert.equal(out.failed_count, 0);
  assert.equal(out.merged_results[0].merge_status, "merged");
  assert.equal(out.merged_results[1].merge_status, "merged");
  assert.equal(out.merged_results[0].merge_notes, "clean");
  assert.equal(out.merged_results[0].path_taken, "merge");
  assert.equal(out.merged_results[0]["hatch.merge.resolver"], "deterministic");
  assert.equal(out.merged_results[0].issue_number, "1");
  assert.equal(out.merged_results[0].branch, "wave/goal-1-wave-1");
});

test("buildWaveMergeResults marks all candidates as failed when mergeStatus is failed", () => {
  const candidates = JSON.stringify([
    { issue_number: "1", branch: "wave/goal-1-wave-1" },
    { issue_number: "2", branch: "wave/goal-1-wave-1" },
  ]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "failed",
    mergeNotes: "conflict",
    mergeResolver: "llm",
    pathTaken: "rebase",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 2);
  assert.equal(out.merge_failures[0].merge_status, "failed");
  assert.equal(out.merge_failures[0].merge_notes, "conflict");
  assert.equal(out.merge_failures[0]["hatch.merge.resolver"], "llm");
  assert.equal(out.merge_failures[0].path_taken, "rebase");
});

test("buildWaveMergeResults handles already_merged status as success", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "wave/x" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "already_merged",
  });
  assert.equal(out.merged_count, 1);
  assert.equal(out.failed_count, 0);
  assert.equal(out.merged_results[0].merge_status, "already_merged");
});

test("buildWaveMergeResults emits canonical merge_completed events for merged candidates", () => {
  const emitted = [];
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: JSON.stringify([
      { issue_number: "1536", branch: "wave/goal-1" },
      { issue_number: "1537", branch: "wave/goal-1" },
    ]),
    mergeStatus: "merged",
    mergeNotes: "clean",
    mergeResolver: "deterministic",
    pathTaken: "merge",
    factoryId: "example-trading",
    runId: "wave-run-1",
    emitDomainEventFn: (event) => emitted.push(event),
  });

  assert.equal(out.canonical_events.length, 2);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].event_family, "factory.merge.completed");
  assert.equal(emitted[0].payload.issue_number, "1536");
  assert.equal(emitted[0].payload.merge_status, "merged");
});

test("buildWaveMergeResults handles empty candidates array", () => {
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: "[]",
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
  assert.deepEqual(out.merged_results, []);
  assert.deepEqual(out.merge_failures, []);
});

test("buildWaveMergeResults returns defaults with no arguments", () => {
  const out = buildWaveMergeResults();
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
  assert.deepEqual(out.merged_results, []);
  assert.deepEqual(out.merge_failures, []);
});

test("buildWaveMergeResults returns defaults with empty object", () => {
  const out = buildWaveMergeResults({});
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("buildWaveMergeResults defaults mergeResolver to unknown", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
  });
  assert.equal(out.merged_results[0]["hatch.merge.resolver"], "unknown");
});

test("buildWaveMergeResults defaults pathTaken to merge", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
  });
  assert.equal(out.merged_results[0].path_taken, "merge");
});

test("buildWaveMergeResults skips null items in candidates array", () => {
  const candidates = JSON.stringify([
    null,
    { issue_number: "1", branch: "b" },
    null,
  ]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 1);
  assert.equal(out.merged_results[0].issue_number, "1");
});

test("buildWaveMergeResults handles empty mergeStatus as failure", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "",
  });
  // empty status is not "merged" or "already_merged", so goes to failed
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 1);
  assert.equal(out.merge_failures[0].merge_status, "");
});

// --- pushStatus fallback: LLM conflict resolution path pushes to main
// but goal_merge_status is never set, so mergeStatus arrives empty.
// pushStatus="pushed" must be treated as a successful merge. ---

test("buildWaveMergeResults treats pushStatus=pushed as merged when mergeStatus is empty", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "goal/1396" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "",
    pushStatus: "pushed",
    mergeResolver: "llm",
  });
  assert.equal(out.merged_count, 1, "pushStatus=pushed should count as merged");
  assert.equal(out.failed_count, 0);
  assert.equal(out.merged_results[0].merge_status, "pushed");
  assert.equal(out.merged_results[0]["hatch.merge.resolver"], "llm");
});

test("buildWaveMergeResults ignores pushStatus when mergeStatus is already set", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
    pushStatus: "pushed",
  });
  assert.equal(out.merged_count, 1);
  assert.equal(out.merged_results[0].merge_status, "merged");
});

test("buildWaveMergeResults does not treat pushStatus=failed as merged", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "",
    pushStatus: "failed",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 1);
});

test("buildWaveMergeResults does not treat empty pushStatus as merged", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "",
    pushStatus: "",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 1);
});

test("buildWaveMergeResults handles invalid JSON in mergeCandidatesRaw", () => {
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: "not json",
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("buildWaveMergeResults handles null mergeCandidatesRaw", () => {
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: null,
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 0);
});

test("buildWaveMergeResults trims whitespace from mergeStatus", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "  merged  ",
  });
  assert.equal(out.merged_count, 1);
  assert.equal(out.merged_results[0].merge_status, "merged");
});

test("buildWaveMergeResults trims whitespace from mergeNotes", () => {
  const candidates = JSON.stringify([{ issue_number: "1", branch: "b" }]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
    mergeNotes: "  clean merge  ",
  });
  assert.equal(out.merged_results[0].merge_notes, "clean merge");
});

test("buildWaveMergeResults handles missing issue_number and branch in candidate", () => {
  const candidates = JSON.stringify([{}]);
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 1);
  assert.equal(out.merged_results[0].issue_number, "");
  assert.equal(out.merged_results[0].branch, "");
});

test("buildWaveMergeResults non-array parsed JSON treated as empty", () => {
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: JSON.stringify({ not: "array" }),
    mergeStatus: "merged",
  });
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("buildWaveMergeResults many candidates all merged", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    issue_number: String(i + 1),
    branch: "wave/shared",
  }));
  const out = buildWaveMergeResults({
    mergeCandidatesRaw: JSON.stringify(candidates),
    mergeStatus: "merged",
    mergeResolver: "deterministic",
  });
  assert.equal(out.merged_count, 10);
  assert.equal(out.failed_count, 0);
  for (const r of out.merged_results) {
    assert.equal(r.merge_status, "merged");
    assert.equal(r["hatch.merge.resolver"], "deterministic");
  }
});

// ─── splitMergeResults ───────────────────────────────────────────────────────

test("splitMergeResults separates merged and failed items", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "merged" },
    { issue_number: "2", merge_status: "already_merged" },
    { issue_number: "3", merge_status: "failed" },
  ]));
  assert.equal(out.merged_count, 2);
  assert.equal(out.failed_count, 1);
  assert.deepEqual(out.merged_results.map((i) => i.issue_number), ["1", "2"]);
  assert.deepEqual(out.merge_failures.map((i) => i.issue_number), ["3"]);
});

test("splitMergeResults handles empty array", () => {
  const out = splitMergeResults("[]");
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
  assert.deepEqual(out.merged_results, []);
  assert.deepEqual(out.merge_failures, []);
});

test("splitMergeResults returns defaults with no arguments", () => {
  const out = splitMergeResults();
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults returns defaults with empty string", () => {
  const out = splitMergeResults("");
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults returns defaults with null", () => {
  const out = splitMergeResults(null);
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults handles invalid JSON gracefully", () => {
  const out = splitMergeResults("not json");
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults handles JSON-encoded string entries", () => {
  const out = splitMergeResults(JSON.stringify([
    JSON.stringify({ issue_number: "1", merge_status: "merged" }),
    JSON.stringify({ issue_number: "2", merge_status: "failed" }),
  ]));
  assert.equal(out.merged_count, 1);
  assert.equal(out.failed_count, 1);
});

test("splitMergeResults skips null entries", () => {
  const out = splitMergeResults(JSON.stringify([
    null,
    { issue_number: "1", merge_status: "merged" },
  ]));
  assert.equal(out.merged_count, 1);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults skips non-object entries", () => {
  const out = splitMergeResults(JSON.stringify([
    42,
    "plain string that is not valid JSON",
    true,
    { issue_number: "1", merge_status: "merged" },
  ]));
  assert.equal(out.merged_count, 1);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults treats empty merge_status as failure", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "" },
  ]));
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 1);
});

test("splitMergeResults treats missing merge_status as failure", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1" },
  ]));
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 1);
});

test("splitMergeResults all merged", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "merged" },
    { issue_number: "2", merge_status: "already_merged" },
    { issue_number: "3", merge_status: "merged" },
  ]));
  assert.equal(out.merged_count, 3);
  assert.equal(out.failed_count, 0);
});

test("splitMergeResults all failed", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "failed" },
    { issue_number: "2", merge_status: "conflict" },
    { issue_number: "3", merge_status: "error" },
  ]));
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 3);
});

test("splitMergeResults preserves all fields from original items", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "merged", branch: "wave/b", extra_field: "hello" },
  ]));
  assert.equal(out.merged_results[0].branch, "wave/b");
  assert.equal(out.merged_results[0].extra_field, "hello");
});

test("splitMergeResults trims whitespace from merge_status", () => {
  const out = splitMergeResults(JSON.stringify([
    { issue_number: "1", merge_status: "  merged  " },
  ]));
  assert.equal(out.merged_count, 1);
});

test("splitMergeResults non-array JSON treated as empty", () => {
  const out = splitMergeResults(JSON.stringify({ not: "array" }));
  assert.equal(out.merged_count, 0);
  assert.equal(out.failed_count, 0);
});
