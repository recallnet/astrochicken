import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { splitWaveImplResults, splitWaveImplResultsFromSources, checkMergeCandidates } from "../../src/commands/wave-split-results.ts";

// ─── splitWaveImplResults ────────────────────────────────────────────────────

test("splitWaveImplResults separates merge candidates from review failures", () => {
  const raw = JSON.stringify([
    JSON.stringify({ issue_number: "191", review_failed: "false", branch: "wave/191" }),
    JSON.stringify({ issue_number: "194", review_failed: "true", branch: "wave/194" }),
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.review_failures.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "191");
  assert.equal(out.review_failures[0].issue_number, "194");
});

test("splitWaveImplResults handles object entries (not double-encoded)", () => {
  const raw = JSON.stringify([
    { issue_number: "10", review_failed: "false" },
    { issue_number: "20", review_failed: "true" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.review_failures.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "10");
  assert.equal(out.review_failures[0].issue_number, "20");
});

test("splitWaveImplResults excludes already-merged items from merge candidates", () => {
  const raw = JSON.stringify([
    JSON.stringify({ issue_number: "191", review_failed: "false", merged: "true" }),
    JSON.stringify({ issue_number: "192", review_failed: "false" }),
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "192");
});

test("splitWaveImplResults excludes merged=true boolean items", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: false, merged: true },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
  assert.equal(out.review_failures.length, 0);
});

test("splitWaveImplResults excludes merged=1 items", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "false", merged: "1" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
});

test("splitWaveImplResults excludes merged=yes items", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "false", merged: "yes" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
});

test("splitWaveImplResults excludes done_elsewhere disposition", () => {
  const raw = JSON.stringify([
    JSON.stringify({ issue_number: "1", review_failed: "false", disposition: "done_elsewhere" }),
    JSON.stringify({ issue_number: "2", review_failed: "false" }),
  ]);
  const out = splitWaveImplResults(raw);
  assert.deepEqual(out.merge_candidates.map((i) => i.issue_number), ["2"]);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults excludes infra_failure disposition", () => {
  const raw = JSON.stringify([
    JSON.stringify({ issue_number: "1", review_failed: "false", disposition: "infra_failure" }),
    JSON.stringify({ issue_number: "2", review_failed: "false" }),
  ]);
  const out = splitWaveImplResults(raw);
  assert.deepEqual(out.merge_candidates.map((i) => i.issue_number), ["2"]);
});

test("splitWaveImplResults disposition check is case-insensitive", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "false", disposition: "DONE_ELSEWHERE" },
    { issue_number: "2", review_failed: "false", disposition: "Infra_Failure" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
  assert.equal(out.review_failures.length, 0);
});

test("splitWaveImplResults handles review_failed boolean true", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: true },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
  assert.equal(out.review_failures.length, 1);
});

test("splitWaveImplResults handles review_failed=1", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "1" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.review_failures.length, 1);
});

test("splitWaveImplResults handles review_failed=yes", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "yes" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.review_failures.length, 1);
});

test("splitWaveImplResults handles review_failed=YES (case insensitive)", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "YES" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.review_failures.length, 1);
});

test("splitWaveImplResults returns empty arrays for empty input", () => {
  const out = splitWaveImplResults("[]");
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults returns empty arrays for empty string", () => {
  const out = splitWaveImplResults("");
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults returns empty arrays for null", () => {
  const out = splitWaveImplResults(null);
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults returns empty arrays for undefined", () => {
  const out = splitWaveImplResults(undefined);
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults handles invalid JSON gracefully", () => {
  const out = splitWaveImplResults("not json at all");
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults skips null entries in array", () => {
  const raw = JSON.stringify([
    null,
    { issue_number: "1", review_failed: "false" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
});

test("splitWaveImplResults skips non-object string entries that are not valid JSON", () => {
  const raw = JSON.stringify([
    "not a json string",
    { issue_number: "1", review_failed: "false" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
});

test("splitWaveImplResults skips numeric entries", () => {
  const raw = JSON.stringify([42, { issue_number: "1", review_failed: "false" }]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 1);
});

test("splitWaveImplResults handles non-array JSON as empty", () => {
  const out = splitWaveImplResults(JSON.stringify({ not: "array" }));
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResults mixed: pass, fail, merged, infra_failure, done_elsewhere", () => {
  const raw = JSON.stringify([
    JSON.stringify({ issue_number: "1", review_failed: "false" }),
    JSON.stringify({ issue_number: "2", review_failed: "true", review_notes: "bad" }),
    JSON.stringify({ issue_number: "3", review_failed: "false", merged: "true" }),
    JSON.stringify({ issue_number: "4", review_failed: "false", disposition: "infra_failure" }),
    JSON.stringify({ issue_number: "5", review_failed: "false", disposition: "done_elsewhere" }),
  ]);
  const out = splitWaveImplResults(raw);
  assert.deepEqual(out.merge_candidates.map((i) => i.issue_number), ["1"]);
  assert.deepEqual(out.review_failures.map((i) => i.issue_number), ["2"]);
});

test("splitWaveImplResults all pass review", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "false" },
    { issue_number: "2", review_failed: "false" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 2);
  assert.equal(out.review_failures.length, 0);
});

test("splitWaveImplResults all fail review", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "true" },
    { issue_number: "2", review_failed: "true" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates.length, 0);
  assert.equal(out.review_failures.length, 2);
});

test("splitWaveImplResults preserves all fields on merge candidates", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "false", branch: "wave/b", worktree_dir: "/tmp/w", extra: "data" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.merge_candidates[0].branch, "wave/b");
  assert.equal(out.merge_candidates[0].worktree_dir, "/tmp/w");
  assert.equal(out.merge_candidates[0].extra, "data");
});

test("splitWaveImplResults preserves all fields on review failures", () => {
  const raw = JSON.stringify([
    { issue_number: "1", review_failed: "true", review_notes: "fix it", branch: "wave/b" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.equal(out.review_failures[0].review_notes, "fix it");
  assert.equal(out.review_failures[0].branch, "wave/b");
});

test("splitWaveImplResults deduplicates repeated issue entries by latest issue_number", () => {
  const raw = JSON.stringify([
    { issue_number: "2381", review_failed: "false", branch: "wave/old", issue_title: "Old title" },
    { issue_number: "2381", review_failed: "true", branch: "wave/new", issue_title: "New title", review_notes: "latest failure" },
    { issue_number: "2382", review_failed: "false", branch: "wave/2382" },
  ]);
  const out = splitWaveImplResults(raw);
  assert.deepEqual(out.merge_candidates.map((item) => item.issue_number), ["2382"]);
  assert.deepEqual(out.review_failures.map((item) => item.issue_number), ["2381"]);
  assert.equal(out.review_failures[0].branch, "wave/new");
  assert.equal(out.review_failures[0].issue_title, "New title");
});

// ─── checkMergeCandidates ────────────────────────────────────────────────────

test("checkMergeCandidates returns true when candidates exist", () => {
  const out = checkMergeCandidates(JSON.stringify([
    { issue_number: "1", branch: "wave/goal-1-wave-1" },
    { issue_number: "2", branch: "wave/goal-1-wave-1" },
  ]));
  assert.equal(out.has_merge_candidates, "true");
  assert.equal(out.merge_candidate_count, "2");
});

test("checkMergeCandidates returns false for empty array", () => {
  const out = checkMergeCandidates("[]");
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

test("checkMergeCandidates handles invalid JSON gracefully", () => {
  const out = checkMergeCandidates("not json");
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

test("checkMergeCandidates returns defaults with no arguments", () => {
  const out = checkMergeCandidates();
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

test("checkMergeCandidates returns defaults with empty string", () => {
  const out = checkMergeCandidates("");
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

test("checkMergeCandidates returns defaults with null", () => {
  const out = checkMergeCandidates(null);
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

test("checkMergeCandidates filters out null/falsy entries", () => {
  const out = checkMergeCandidates(JSON.stringify([
    null,
    { issue_number: "1" },
    null,
    false,
    0,
    "",
  ]));
  assert.equal(out.has_merge_candidates, "true");
  assert.equal(out.merge_candidate_count, "1");
});

test("checkMergeCandidates single candidate", () => {
  const out = checkMergeCandidates(JSON.stringify([{ issue_number: "99" }]));
  assert.equal(out.has_merge_candidates, "true");
  assert.equal(out.merge_candidate_count, "1");
});

test("checkMergeCandidates non-array JSON treated as empty", () => {
  const out = checkMergeCandidates(JSON.stringify({ not: "array" }));
  assert.equal(out.has_merge_candidates, "false");
  assert.equal(out.merge_candidate_count, "0");
});

// ─── splitWaveImplResultsFromSources ─────────────────────────────────────────

test("splitWaveImplResultsFromSources prefers run-state impl_results", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-split-"));
  const runId = "run-state-test";
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      context: {
        impl_results: JSON.stringify([
          JSON.stringify({ issue_number: "195", review_failed: "false" }),
        ]),
      },
    }),
  );

  const out = splitWaveImplResultsFromSources({
    runId,
    runsDir: root,
    stdinRaw: JSON.stringify([JSON.stringify({ issue_number: "x", review_failed: "true" })]),
  });

  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.review_failures.length, 0);
  assert.equal(out.merge_candidates[0].issue_number, "195");
});

test("splitWaveImplResultsFromSources falls back to stdinRaw when no run state", () => {
  const payload = JSON.stringify([
    JSON.stringify({ issue_number: "300", review_failed: "false" }),
  ]);
  const out = splitWaveImplResultsFromSources({
    runId: "",
    stdinRaw: payload,
  });
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "300");
});

test("splitWaveImplResultsFromSources falls back to fallbackRaw when no stdin", () => {
  const payload = JSON.stringify([
    JSON.stringify({ issue_number: "400", review_failed: "true" }),
  ]);
  const out = splitWaveImplResultsFromSources({
    runId: "",
    stdinRaw: "",
    fallbackRaw: payload,
  });
  assert.equal(out.review_failures.length, 1);
  assert.equal(out.review_failures[0].issue_number, "400");
});

test("splitWaveImplResultsFromSources returns empty when all sources empty", () => {
  const out = splitWaveImplResultsFromSources({
    runId: "",
    stdinRaw: "",
    fallbackRaw: "",
  });
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResultsFromSources returns empty with no arguments", () => {
  const out = splitWaveImplResultsFromSources();
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResultsFromSources returns empty with empty object", () => {
  const out = splitWaveImplResultsFromSources({});
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResultsFromSources handles missing state.json gracefully", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-split-missing-"));
  const out = splitWaveImplResultsFromSources({
    runId: "nonexistent",
    runsDir: root,
    stdinRaw: JSON.stringify([{ issue_number: "1", review_failed: "false" }]),
  });
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "1");
});

test("splitWaveImplResultsFromSources handles malformed state.json gracefully", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-split-malformed-"));
  const runId = "malformed-run";
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), "not json");

  const out = splitWaveImplResultsFromSources({
    runId,
    runsDir: root,
    stdinRaw: JSON.stringify([{ issue_number: "5", review_failed: "false" }]),
  });
  // Falls back to stdin since state.json parse fails -> empty string from readImplResultsFromState
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "5");
});

test("splitWaveImplResultsFromSources handles state.json with no impl_results", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-split-no-impl-"));
  const runId = "no-impl-run";
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ context: {} }));

  const payload = JSON.stringify([{ issue_number: "7", review_failed: "false" }]);
  const out = splitWaveImplResultsFromSources({
    runId,
    runsDir: root,
    stdinRaw: payload,
  });
  // impl_results is empty string, falls back to stdin
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "7");
});

test("splitWaveImplResultsFromSources stdinRaw takes priority over fallbackRaw", () => {
  const stdinPayload = JSON.stringify([{ issue_number: "from-stdin", review_failed: "false" }]);
  const fallbackPayload = JSON.stringify([{ issue_number: "from-fallback", review_failed: "false" }]);
  const out = splitWaveImplResultsFromSources({
    stdinRaw: stdinPayload,
    fallbackRaw: fallbackPayload,
  });
  assert.equal(out.merge_candidates.length, 1);
  assert.equal(out.merge_candidates[0].issue_number, "from-stdin");
});

test("splitWaveImplResultsFromSources handles null values", () => {
  const out = splitWaveImplResultsFromSources({
    runId: null,
    stdinRaw: null,
    fallbackRaw: null,
  });
  assert.deepEqual(out.merge_candidates, []);
  assert.deepEqual(out.review_failures, []);
});

test("splitWaveImplResultsFromSources trims whitespace from sources", () => {
  const payload = JSON.stringify([{ issue_number: "1", review_failed: "false" }]);
  const out = splitWaveImplResultsFromSources({
    stdinRaw: `  ${payload}  `,
  });
  assert.equal(out.merge_candidates.length, 1);
});
