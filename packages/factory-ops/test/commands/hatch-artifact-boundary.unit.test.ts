import assert from "node:assert/strict";
import test from "node:test";

import { analyzeArtifactLeaks } from "../../../../scripts/check-hatch-artifact-boundary.ts";

test("analyzeArtifactLeaks detects state.json at repo root", () => {
  const result = analyzeArtifactLeaks({ files: ["state.json"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "run_state_file_at_repo_root");
});

test("analyzeArtifactLeaks detects metadata.json at repo root", () => {
  const result = analyzeArtifactLeaks({ files: ["metadata.json"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "run_state_file_at_repo_root");
});

test("analyzeArtifactLeaks detects DOT node name at repo root", () => {
  const result = analyzeArtifactLeaks({ files: ["archive_synthesis_failed"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "dot_node_name_at_repo_root");
});

test("analyzeArtifactLeaks detects short DOT node names", () => {
  const result = analyzeArtifactLeaks({ files: ["done"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "dot_node_name_at_repo_root");
});

test("analyzeArtifactLeaks detects issues/ directory at repo root", () => {
  const result = analyzeArtifactLeaks({ files: ["issues/1846.md"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "factory_artifact_directory_at_repo_root");
});

test("analyzeArtifactLeaks detects stray hatch checkpoint files", () => {
  const result = analyzeArtifactLeaks({ files: [".hatch-checkpoint-abc123"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "stray_hatch_checkpoint_or_trace");
});

test("analyzeArtifactLeaks detects stray hatch trace files", () => {
  const result = analyzeArtifactLeaks({ files: [".hatch-trace-def456"] });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].reason, "stray_hatch_checkpoint_or_trace");
});

test("analyzeArtifactLeaks allows legitimate nested paths", () => {
  const result = analyzeArtifactLeaks({
    files: [
      "packages/factory-ops/src/foo.mjs",
      "scripts/check-something.mjs",
      "apps/hatch/src/state.json",
    ],
  });
  assert.equal(result.violations.length, 0);
  assert.equal(result.checked, 3);
});

test("analyzeArtifactLeaks allows allowlisted root files", () => {
  const result = analyzeArtifactLeaks({ files: ["Makefile", "Dockerfile", "turbo"] });
  assert.equal(result.violations.length, 0);
});

test("analyzeArtifactLeaks ignores single-char names", () => {
  const result = analyzeArtifactLeaks({ files: ["a"] });
  assert.equal(result.violations.length, 0);
});

test("analyzeArtifactLeaks ignores names with extensions", () => {
  const result = analyzeArtifactLeaks({ files: ["done.md", "state.ts"] });
  assert.equal(result.violations.length, 0);
});

test("analyzeArtifactLeaks reports multiple violations", () => {
  const result = analyzeArtifactLeaks({
    files: ["state.json", "done", "issues/42.md", ".hatch-trace-xyz"],
  });
  assert.equal(result.checked, 4);
  assert.equal(result.violations.length, 4);
});

test("analyzeArtifactLeaks returns zero violations for empty input", () => {
  const result = analyzeArtifactLeaks({ files: [] });
  assert.equal(result.checked, 0);
  assert.equal(result.violations.length, 0);
});
