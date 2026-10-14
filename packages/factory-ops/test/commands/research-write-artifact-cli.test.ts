import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("research write-artifact CLI writes artifact and metrics with exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "research-write-artifact-cli-"));
  try {
    const artifactPath = join(root, "research", "hyp-2", "synthesis.md");
    const metricsPath = join(root, "research", "hyp-2", "metrics", "synthesis.json");

    const run = spawnOpsCli([
      "research",
      "write-artifact",
      "--path",
      artifactPath,
      "--content",
      "artifact body",
      "--metrics-path",
      metricsPath,
      "--metrics-content",
      '{"status":"pass"}'
    ]);

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "{}");
    assert.equal(out.ok, true);
    assert.ok(out.artifact_bytes > 0);
    assert.ok(out.metrics_bytes > 0);
    assert.equal(readFileSync(artifactPath, "utf8"), "artifact body");
    assert.equal(readFileSync(metricsPath, "utf8"), '{"status":"pass"}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research write-artifact CLI returns exit 1 for empty content", () => {
  const run = spawnOpsCli([
      "research",
      "write-artifact",
      "--path",
      "research/hyp-2/synthesis.md",
      "--content",
      "   "
    ]);

  assert.equal(run.status, 1);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.ok, false);
  assert.equal(out.error, "empty_content");
});

test("research write-artifact CLI requires repo root for relative paths", () => {
  const run = spawnOpsCli([
      "research",
      "write-artifact",
      "--path",
      "research/hyp-2/synthesis.md",
      "--content",
      "artifact body"
    ]);

  assert.equal(run.status, 1);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.ok, false);
  assert.equal(out.error, "relative_path_requires_repo_root");
});

test("research write-artifact CLI returns exit 1 for metrics path without metrics content", () => {
  const run = spawnOpsCli([
      "research",
      "write-artifact",
      "--path",
      "research/hyp-2/synthesis.md",
      "--content",
      "artifact body",
      "--metrics-path",
      "research/hyp-2/metrics/synthesis.json",
      "--metrics-content",
      ""
    ]);

  assert.equal(run.status, 1);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.ok, false);
  assert.equal(out.error, "metrics_content_required");
});
