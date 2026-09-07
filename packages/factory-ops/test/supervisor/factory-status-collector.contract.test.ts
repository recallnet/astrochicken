import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectFactoryStatus } from "../../src/lib/factory-status-collector.ts";

function writeRunContract({ runsDir, runId, status, updatedAt, pipelineFile }) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  writeFileSync(join(runDir, "run-manifest.json"), JSON.stringify({
    schemaVersion: "hatch.run_artifact_manifest.v1",
    runId,
    factoryId: "mothership",
    pipelineFile,
    runDirectory: runDir,
    generatedAt: updatedAt,
    contextKeys: ["factory_id"],
    discoveryOwner: "apps/hatch/src/pipeline/run-artifact-contract.ts",
    artifacts: [
      { key: "run_manifest", file: "run-manifest.json", role: "canonical", owner: "contract", required: true, description: "" },
      { key: "run_live", file: "run-live.json", role: "canonical", owner: "contract", required: true, description: "" },
      { key: "run_checkpoint", file: "run-checkpoint.json", role: "canonical", owner: "contract", required: true, description: "" },
      { key: "run_conclusion", file: "run-conclusion.json", role: "canonical", owner: "contract", required: false, description: "" },
      { key: "run_state", file: "state.json", role: "compatibility", owner: "run.ts", required: true, description: "" },
      { key: "run_metadata", file: "metadata.json", role: "compatibility", owner: "run.ts", required: false, description: "" },
      { key: "run_alignment_summary", file: "alignment-summary.json", role: "compatibility", owner: "alignment", required: false, description: "" },
    ],
  }, null, 2));

  writeFileSync(join(runDir, "run-live.json"), JSON.stringify({
    schemaVersion: "hatch.run_live.v1",
    runId,
    status,
    currentNode: status === "completed" ? "done" : "build",
    startedAt: "2026-03-18T20:00:00.000Z",
    updatedAt,
    nodeStartedAt: "2026-03-18T20:00:01.000Z",
    contextKeys: ["factory_id"],
    activeChildren: { count: 0, sampleIds: [] },
    recordCount: 0,
    lastOutputPreview: "",
    alignmentSummary: {
      file: "alignment-summary.json",
      exists: false,
      status: "",
      terminalAt: "",
    },
  }, null, 2));

  writeFileSync(join(runDir, "run-checkpoint.json"), JSON.stringify({
    schemaVersion: "hatch.run_checkpoint.v1",
    runId,
  }, null, 2));
}

test("collectFactoryStatus reads outcomes + artifact paths from run-manifest contract", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-status-collector-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunContract({
    runsDir,
    runId: "run-terminal",
    status: "completed",
    updatedAt: "2026-03-18T20:11:00.000Z",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
  });
  writeRunContract({
    runsDir,
    runId: "run-live",
    status: "running",
    updatedAt: "2026-03-18T20:12:00.000Z",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
  });

  const status = collectFactoryStatus({
    factoryId: "mothership",
    targetRepo: "recallnet/astrochicken",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir,
    rootDir: root,
  });

  assert.equal(Array.isArray(status.last_outcomes), true);
  assert.equal(status.last_outcomes.length, 1);
  assert.equal(status.last_outcomes[0].run_id, "run-terminal");
  assert.match(String(status.last_outcomes[0].summary || ""), /completed/);
  assert.match(String(status.last_outcomes[0].summary || ""), /wave_execute\.dot/);

  assert.equal(Array.isArray(status.run_artifacts), true);
  assert.equal(status.run_artifacts.length, 2);
  const latest = status.run_artifacts[0];
  assert.equal(latest.run_id, "run-live");
  assert.match(String(latest.summary || ""), /manifest=.*run-manifest\.json/);
  assert.match(String(latest.summary || ""), /live=.*run-live\.json/);
  assert.equal(latest.paths.run_dir, join(runsDir, "run-live"));
  assert.equal(latest.paths.manifest, join(runsDir, "run-live", "run-manifest.json"));
  assert.equal(latest.paths.checkpoint, join(runsDir, "run-live", "run-checkpoint.json"));
});
