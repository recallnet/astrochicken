import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeResearchArtifact } from "../../src/commands/research-write-artifact.ts";

test("writeResearchArtifact writes artifact and metrics atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "research-write-artifact-"));
  try {
    const artifactPath = join(root, "research", "hyp-1", "stage.md");
    const metricsPath = join(root, "research", "hyp-1", "metrics", "stage.json");

    const out = writeResearchArtifact({
      path: artifactPath,
      content: "# Stage output\nnon-empty",
      metricsPath,
      metricsContent: '{"status":"pass"}',
    });

    assert.equal(out.ok, true);
    assert.equal(out.error, "");
    assert.equal(out.artifact_path, artifactPath);
    assert.equal(out.metrics_path, metricsPath);
    assert.ok(out.artifact_bytes > 0);
    assert.ok(out.metrics_bytes > 0);
    assert.equal(readFileSync(artifactPath, "utf8"), "# Stage output\nnon-empty");
    assert.equal(readFileSync(metricsPath, "utf8"), '{"status":"pass"}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeResearchArtifact rejects empty content", () => {
  const out = writeResearchArtifact({
    path: "research/hyp-1/stage.md",
    content: "   ",
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "empty_content");
});

test("writeResearchArtifact rejects missing path", () => {
  const out = writeResearchArtifact({
    path: "",
    content: "non-empty",
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_path");
});

test("writeResearchArtifact rejects metrics path without metrics content", () => {
  const out = writeResearchArtifact({
    path: "research/hyp-1/stage.md",
    content: "non-empty",
    metricsPath: "research/hyp-1/metrics/stage.json",
    metricsContent: "   ",
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "metrics_content_required");
});

test("writeResearchArtifact rejects relative paths without explicit repo root", () => {
  const out = writeResearchArtifact({
    path: "research/hyp-1/stage.md",
    content: "non-empty",
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "relative_path_requires_repo_root");
});
