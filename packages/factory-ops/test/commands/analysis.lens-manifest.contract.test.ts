import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLensManifest } from "../../src/lib/analysis/lens-manifest.ts";
import {
  createDailyLensCollectedFixture,
  createDailyLensExternalDatasetPaths,
  DAILY_LENS_REQUIRED_DATASET_IDS,
  DAILY_LENS_WINDOW_END,
  DAILY_LENS_WINDOW_START,
} from "../shared/helpers/daily-lens-manifest.ts";

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "analysis-lens-manifest-contract-"));
}

test("daily lens manifest contract materializes dataset files and keeps all referenced paths resolvable", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-contract");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisOutputPath = path.join(runtimeDir, "analysis-output.json");
  const externalDatasetPaths = createDailyLensExternalDatasetPaths(root);

  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify({ seeded: true }, null, 2)}\n`, "utf8");
  writeFileSync(analysisOutputPath, `${JSON.stringify({ status: "pending_agent_analysis" }, null, 2)}\n`, "utf8");

  mkdirSync(path.dirname(externalDatasetPaths.agentLearningsPath), { recursive: true });
  writeFileSync(externalDatasetPaths.agentLearningsPath, "# Agent Learnings\n", "utf8");
  writeFileSync(externalDatasetPaths.llmInventoryPath, `${JSON.stringify({ generated_at: "2026-03-16T01:00:00.000Z" }, null, 2)}\n`, "utf8");
  writeFileSync(externalDatasetPaths.goalDecompositionTimeoutsPath, `${JSON.stringify({ defaults: { soft_ms: 1000 } }, null, 2)}\n`, "utf8");

  try {
    const manifest = await buildLensManifest({
      collected: createDailyLensCollectedFixture({
        windowStart: DAILY_LENS_WINDOW_START,
        windowEnd: DAILY_LENS_WINDOW_END,
        includeExternalDatasetPaths: true,
        externalDatasetPaths,
      }),
      runtimeDir,
      date: "2026-03-16",
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      window: { start: DAILY_LENS_WINDOW_START, end: DAILY_LENS_WINDOW_END },
      bundlePath,
      analysisOutputPath,
      repoPath: "/path/to/astrochicken",
      runsDir: "/tmp/hatch-runs",
      issueLabels: ["daily-lens"],
    });

    const datasetsById = new Map((manifest.datasets || []).map((entry) => [entry.id, entry]));
    assert.deepEqual([...datasetsById.keys()], DAILY_LENS_REQUIRED_DATASET_IDS);

    const bundleBackedDatasets = new Set(["past_lens_outputs", "pending_suggestions"]);

    for (const datasetId of DAILY_LENS_REQUIRED_DATASET_IDS) {
      const entry = datasetsById.get(datasetId);
      assert.ok(entry, `expected dataset entry for ${datasetId}`);
      assert.ok(String(entry.file_path).length > 0, `dataset file path should be populated for ${datasetId}`);
      if (bundleBackedDatasets.has(datasetId)) {
        assert.equal(entry.file_path, bundlePath, `${datasetId} should resolve via bundle fallback path`);
      }
      assert.equal(existsSync(entry.file_path), true, `dataset file path should exist for ${datasetId}`);
      assert.ok(String(entry.path_in_bundle).startsWith("$."), `dataset path_in_bundle should be rooted for ${datasetId}`);
    }

    assert.equal(datasetsById.get("agent_learnings").file_path, externalDatasetPaths.agentLearningsPath);
    assert.equal(datasetsById.get("llm_inventory").file_path, externalDatasetPaths.llmInventoryPath);
    assert.equal(datasetsById.get("goal_decomposition_timeouts").file_path, externalDatasetPaths.goalDecompositionTimeoutsPath);
    assert.equal(datasetsById.get("langfuse").collector_health.status, "degraded");
    assert.deepEqual(datasetsById.get("managed_fleet").summary, {
      item_count: 1,
      active_factory_count: 1,
      total_runs: 2,
      total_commits: 3,
    });
    const fleetPayload = JSON.parse(readFileSync(datasetsById.get("managed_fleet").file_path, "utf8"));
    assert.equal(fleetPayload.factories[0].factory_id, "fixture-factory");
    assert.equal(manifest.summary.pending_suggestion_count, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("daily lens manifest contract fails closed when dataset path verification fails", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-missing-path");

  try {
    await assert.rejects(
      () => buildLensManifest({
        collected: createDailyLensCollectedFixture({
          windowStart: DAILY_LENS_WINDOW_START,
          windowEnd: DAILY_LENS_WINDOW_END,
        }),
        runtimeDir,
        runtimeFs: {
          mkdir: (...args) => fsPromises.mkdir(...args),
          writeFile: (...args) => fsPromises.writeFile(...args),
          access: async (filePath) => {
            if (String(filePath).endsWith(`${path.sep}datasets${path.sep}langfuse.json`)) {
              const error = new Error("ENOENT");
              error.code = "ENOENT";
              throw error;
            }
            return fsPromises.access(filePath);
          },
        },
        date: "2026-03-16",
        repo: "recallnet/astrochicken",
        factoryId: "mothership",
        window: { start: DAILY_LENS_WINDOW_START, end: DAILY_LENS_WINDOW_END },
        bundlePath: path.join(runtimeDir, "bundle.json"),
        analysisOutputPath: path.join(runtimeDir, "analysis-output.json"),
        repoPath: "/path/to/astrochicken",
        runsDir: "/tmp/hatch-runs",
        issueLabels: ["daily-lens"],
      }),
      /lens_bundle_manifest_invalid: dataset file missing dataset_id=langfuse .*message=ENOENT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("daily lens manifest contract rejects malformed provenance metadata", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-invalid-meta");

  try {
    await assert.rejects(
      () => buildLensManifest({
        collected: createDailyLensCollectedFixture({
          windowStart: DAILY_LENS_WINDOW_START,
          windowEnd: DAILY_LENS_WINDOW_END,
        }),
        runtimeDir,
        date: "2026-03-16",
        repo: "recallnet/astrochicken",
        factoryId: "mothership",
        window: { start: DAILY_LENS_WINDOW_START, end: DAILY_LENS_WINDOW_END },
        bundlePath: path.join(runtimeDir, "bundle.json"),
        analysisOutputPath: path.join(runtimeDir, "analysis-output.json"),
        repoPath: "",
        runsDir: "/tmp/hatch-runs",
        issueLabels: ["daily-lens"],
      }),
      /lens_bundle_manifest_invalid: repo_path is required/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
