import assert from "node:assert/strict";
import test from "node:test";

import { publishWaveDemoArtifact } from "../../src/commands/wave-demo-publish.ts";

test("publishWaveDemoArtifact returns artifact_url and demo_artifact_url on success", () => {
  const calls = [];
  const out = publishWaveDemoArtifact({
    repo: "recallnet/astrochicken",
    runId: "run-demo-123",
    pipeline: "wave_execute",
    milestoneTitle: "goal-1855-wave-1",
    readyIssueNumber: "2553",
    demoArtifactContent: "# Wave Terminal Demo\n\n- #2553 merged",
    demoStrategy: "terminal",
  }, {
    emitSupervisorArtifactFn: (payload) => {
      calls.push(payload);
      return { ok: true, issue_url: "https://github.com/recallnet/astrochicken/issues/9001", error: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.demo_publish_status, "published");
  assert.equal(out.demo_publish_error, "");
  assert.equal(out.artifact_url, "https://github.com/recallnet/astrochicken/issues/9001");
  assert.equal(out.demo_artifact_url, out.artifact_url);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].artifactType, "wave-demo-terminal");
  assert.equal(calls[0].goalIngest, true);
});

test("publishWaveDemoArtifact returns non-fatal failure contract when publish fails", () => {
  const out = publishWaveDemoArtifact({
    repo: "recallnet/astrochicken",
    demoArtifactContent: "# Wave Terminal Demo\n\n- #2553 merged",
  }, {
    emitSupervisorArtifactFn: () => ({ ok: false, issue_url: "", error: "gh_rate_limited" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.demo_publish_status, "failed");
  assert.equal(out.artifact_url, "");
  assert.equal(out.demo_artifact_url, "");
  assert.equal(out.demo_publish_error, "gh_rate_limited");
});

test("publishWaveDemoArtifact emits dedupe-stable summary and evidence fields", () => {
  const calls = [];
  publishWaveDemoArtifact({
    repo: "recallnet/astrochicken",
    milestoneTitle: "goal-1855-wave-1",
    readyIssueNumber: "#2553",
    demoArtifactPath: "/tmp/wave-demo-terminal.md",
    demoArtifactContent: "# Wave Terminal Demo\n\n## Merged Issues\n- #2553 merged\n- #2554 merged",
    demoStrategy: "terminal",
  }, {
    emitSupervisorArtifactFn: (payload) => {
      calls.push(payload);
      return { ok: true, issue_url: "https://github.com/recallnet/astrochicken/issues/9002", error: "" };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].summary, /Wave demo \(terminal\) for goal-1855-wave-1 #2553/);
  const evidence = JSON.parse(calls[0].evidence);
  assert.equal(evidence.schema_version, "wave_demo_publish.v1");
  assert.equal(evidence.demo_strategy, "terminal");
  assert.equal(evidence.milestone_title, "goal-1855-wave-1");
  assert.equal(evidence.ready_issue_number, "2553");
  assert.deepEqual(evidence.merged_issue_numbers, ["2553", "2554"]);
  assert.equal(evidence.demo_artifact_name, "wave-demo-terminal.md");
});
