import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLensManifest, materializeDatasetFile } from "../../src/lib/analysis/lens-manifest.ts";

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "analysis-lens-bundle-contract-"));
}

function minimalCollected(windowStart, windowEnd) {
  return {
    base: {
      langfuse: { source: "langfuse", window: { start: windowStart, end: windowEnd }, traces: [], missing_data: [], meta: {} },
      github: { source: "github_state", window: { start: windowStart, end: windowEnd }, issues: [], pull_requests: [], missing_data: [], meta: {} },
      git: { source: "git_history", window: { start: windowStart, end: windowEnd }, commits: [], missing_data: [], meta: {} },
      hatch_runs: { source: "runs_artifacts", window: { start: windowStart, end: windowEnd }, runs: [], missing_data: [], meta: {} },
      supervisor: { source: "supervisor_status", window: { start: windowStart, end: windowEnd }, runs: [], ticks: [], missing_data: [], meta: {} },
    },
    pending_suggestions: [],
    past_lens_outputs: [],
  };
}

test("buildLensManifest rejects missing required top-level fields", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-1");
  const windowStart = "2026-03-15T14:45:00.000Z";
  const windowEnd = "2026-03-16T14:45:00.000Z";

  try {
    await assert.rejects(
      () => buildLensManifest({
        collected: minimalCollected(windowStart, windowEnd),
        runtimeDir,
        date: "2026-03-16",
        repo: "recallnet/astrochicken",
        factoryId: "mothership",
        window: { start: windowStart, end: windowEnd },
        bundlePath: "",
        analysisOutputPath: path.join(runtimeDir, "analysis-output.json"),
        repoPath: ".",
        runsDir: ".hatch/runs",
        issueLabels: ["daily-lens"],
      }),
      /lens_bundle_manifest_invalid: bundle_path is required/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializeDatasetFile fails when runtime fs does not persist dataset file", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-2");

  try {
    await assert.rejects(
      () => materializeDatasetFile({
        runtimeFs: {
          mkdir: async () => {},
          writeFile: async () => {},
          readFile: async () => {
            const error = new Error("ENOENT");
            error.code = "ENOENT";
            throw error;
          },
        },
        runtimeDir,
        datasetId: "langfuse",
        datasetPayload: { traces: [] },
      }),
      /lens_bundle_manifest_invalid: dataset file missing dataset_id=langfuse .*message=ENOENT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
