import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateWaveTerminalDemo } from "../../src/commands/wave-demo-terminal.ts";

test("generateWaveTerminalDemo writes deterministic artifact under run artifacts directory", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-demo-terminal-"));
  const out = generateWaveTerminalDemo({
    runId: "run-demo-123",
    runsDir: root,
    repo: "recallnet/astrochicken",
    milestoneTitle: "goal-1855-wave-1",
    readyIssueNumber: "#2553",
    mergedResultsRaw: JSON.stringify([
      { issue_number: 2553, branch: "wave/goal-1855/2553", merge_status: "merged" },
      { issue_number: "2554", branch: "wave/goal-1855/2554", merge_status: "merged" },
    ]),
    issueTitlesRaw: JSON.stringify({
      "2553": "Implement terminal wave demo generation",
      "2554": "Publish wave demo artifact",
    }),
    mergeStdout: "git merge wave/goal-1855/2553\nMerge made by the 'ort' strategy.",
    mergeStderr: "",
    generatedAt: "2026-03-24T19:30:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.demo_generation_status, "generated");
  assert.equal(out.demo_generation_error, "");
  assert.equal(out.demo_strategy, "terminal");
  assert.equal(out.merged_count, 2);
  assert.ok(out.demo_artifact_path.endsWith("/run-demo-123/artifacts/wave-demo-terminal.md"));
  assert.ok(out.demo_artifact_bytes > 0);
  assert.equal(existsSync(out.demo_artifact_path), true);

  const content = readFileSync(out.demo_artifact_path, "utf8");
  assert.match(content, /# Wave Terminal Demo/);
  assert.match(content, /- repo: recallnet\/astrochicken/);
  assert.match(content, /- run_id: run-demo-123/);
  assert.match(content, /- milestone: goal-1855-wave-1/);
  assert.match(content, /- ready_issue: #2553/);
  assert.match(content, /## Merged Issues/);
  assert.match(content, /#2553 — Implement terminal wave demo generation/);
  assert.match(content, /#2554 — Publish wave demo artifact/);
  assert.match(content, /## Merge Stdout/);
  assert.match(content, /Merge made by the 'ort' strategy\./);
  assert.match(content, /## Merge Stderr/);
  assert.match(content, /\(empty\)/);
});

test("generateWaveTerminalDemo fails closed on missing runId", () => {
  const out = generateWaveTerminalDemo({
    runId: "",
    mergedResultsRaw: "[]",
  });

  assert.equal(out.ok, false);
  assert.equal(out.demo_generation_status, "failed");
  assert.equal(out.demo_generation_error, "missing_run_id");
  assert.equal(out.demo_artifact_path, "");
  assert.equal(out.demo_artifact_bytes, 0);
});

test("generateWaveTerminalDemo returns failed contract when artifact write throws", () => {
  const out = generateWaveTerminalDemo({
    runId: "run-demo-err",
    runsDir: "/tmp/does-not-matter",
    mergedResultsRaw: "[]",
  }, {
    mkdirSyncFn: () => {},
    writeFileSyncFn: () => {
      throw new Error("disk_full");
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.demo_generation_status, "failed");
  assert.match(out.demo_generation_error, /^demo_artifact_write_failed:/);
  assert.ok(out.demo_artifact_path.endsWith("/run-demo-err/artifacts/wave-demo-terminal.md"));
  assert.equal(out.demo_artifact_bytes, 0);
  assert.equal(out.demo_strategy, "terminal");
});
