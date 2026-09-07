import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMergeFailureComments, categorizeMergeFailure } from "../src/commands/wave-handle-merge-failures.ts";
import { commentMergeFailures } from "../src/commands/wave-handle-merge-failures.ts";

test("buildMergeFailureComments builds actionable comments", () => {
  const out = buildMergeFailureComments([
    { issue_number: 10, merge_status: "failed", notes: "conflict" },
    { merge_status: "failed" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, "10");
  assert.match(out[0].body, /merge_status: failed/);
  assert.match(out[0].body, /merge_failure_category: merge_conflict/);
  assert.match(out[0].body, /Resume policy/);
});

test("buildMergeFailureComments consumes merge_notes from wave merge results payloads", () => {
  const out = buildMergeFailureComments([
    {
      issue_number: 14,
      merge_status: "failed",
      merge_notes: "local changes would be overwritten by merge",
    },
  ]);

  assert.equal(out.length, 1);
  assert.equal(out[0].category, "dirty_worktree");
  assert.match(out[0].body, /merge_failure_category: dirty_worktree/);
  assert.doesNotMatch(out[0].body, /No merge diagnostics captured\./);
  assert.match(out[0].body, /local changes would be overwritten by merge/i);
});

test("categorizeMergeFailure classifies deterministic categories", () => {
  assert.equal(categorizeMergeFailure({ mergeStatus: "error", notes: "local changes would be overwritten by merge" }), "dirty_worktree");
  assert.equal(categorizeMergeFailure({ mergeStatus: "conflict", notes: "" }), "merge_conflict");
  assert.equal(categorizeMergeFailure({ mergeStatus: "error", notes: "not something we can merge" }), "missing_branch_or_ref");
});

test("commentMergeFailures creates follow-up issues with merge-followup label", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-followup-label-"));
  const binDir = join(root, "bin");
  const logPath = join(root, "gh.log");
  const originalPath = process.env.PATH;
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(binDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1 $2" == "issue list" ]]; then
  printf '[]\\n'
  exit 0
fi
if [[ "$1 $2" == "issue comment" ]]; then
  exit 0
fi
if [[ "$1 $2 $3" == "label create merge-followup" ]]; then
  exit 0
fi
if [[ "$1 $2" == "label create" ]]; then
  exit 0
fi
if [[ "$1 $2" == "issue create" ]]; then
  printf 'https://github.com/recallnet/astrochicken/issues/9999\\n'
  exit 0
fi
exit 1
`, "utf8");
  chmodSync(join(binDir, "gh"), 0o755);

  process.env.PATH = `${binDir}:${originalPath || ""}`;
  try {
    const out = commentMergeFailures({
      repo: "recallnet/astrochicken",
      mergeFailuresRaw: JSON.stringify([{ issue_number: 1616, merge_status: "failed", notes: "opaque merge failure" }]),
      runId: "run-1",
      pipeline: "wave_execute",
      milestoneTitle: "goal-1523-wave-3",
      readyIssueNumber: "1644",
    });

    assert.equal(out.followup_count, 1);
    const log = readFileSync(logPath, "utf8");
    assert.match(log, /label create merge-followup --repo recallnet\/astrochicken/);
    assert.match(log, /issue create --repo recallnet\/astrochicken --title Merge Conveyor Follow-up: generic_merge_failure[\s\S]*--label merge-followup/);
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});
