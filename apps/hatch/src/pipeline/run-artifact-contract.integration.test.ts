import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RUN_ARTIFACT_CHECKPOINT_SCHEMA_VERSION,
  RUN_ARTIFACT_CONCLUSION_SCHEMA_VERSION,
  RUN_ARTIFACT_LIVE_SCHEMA_VERSION,
  RUN_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  RUN_CHECKPOINT_FILE,
  RUN_CONCLUSION_FILE,
  RUN_LIVE_FILE,
  RUN_MANIFEST_FILE,
  runArtifactPath,
  validateCanonicalArtifactSurfaces,
  writeRunArtifactContract,
} from "./run-artifact-contract.js";
import { configureRunStorageScope, createRunState, runDir, saveRunState } from "./run.js";

describe("run artifact contract", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    configureRunStorageScope({ runsDir: ".hatch/runs" });
    delete process.env["HATCH_FACTORY_ID"];
  });

  it("emits canonical manifest/live/checkpoint files and terminal conclusion", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-run-artifacts-"));
    cleanupDirs.push(root);
    const scopedRunsDir = join(root, "runs");
    configureRunStorageScope({ runsDir: scopedRunsDir });

    const runState = createRunState("run-contract-1", "graphs/demo.dot", { runsDir: scopedRunsDir });
    runState.context.factory_id = "mothership";
    runState.currentNode = "build";
    saveRunState(runState, { updatePid: false });

    const runDirectory = runDir(runState.runId);
    const manifestPath = runArtifactPath(runDirectory, RUN_MANIFEST_FILE);
    const livePath = runArtifactPath(runDirectory, RUN_LIVE_FILE);
    const checkpointPath = runArtifactPath(runDirectory, RUN_CHECKPOINT_FILE);
    const conclusionPath = runArtifactPath(runDirectory, RUN_CONCLUSION_FILE);

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(livePath)).toBe(true);
    expect(existsSync(checkpointPath)).toBe(true);
    expect(existsSync(conclusionPath)).toBe(false);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const live = JSON.parse(readFileSync(livePath, "utf8"));
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));

    expect(manifest.schemaVersion).toBe(RUN_ARTIFACT_MANIFEST_SCHEMA_VERSION);
    expect(live.schemaVersion).toBe(RUN_ARTIFACT_LIVE_SCHEMA_VERSION);
    expect(checkpoint.schemaVersion).toBe(RUN_ARTIFACT_CHECKPOINT_SCHEMA_VERSION);

    const byKey = new Map((manifest.artifacts || []).map((entry: any) => [entry.key, entry]));
    expect(byKey.get("run_manifest")?.file).toBe(RUN_MANIFEST_FILE);
    expect(byKey.get("run_live")?.file).toBe(RUN_LIVE_FILE);
    expect(byKey.get("run_checkpoint")?.file).toBe(RUN_CHECKPOINT_FILE);
    expect(byKey.get("run_conclusion")?.file).toBe(RUN_CONCLUSION_FILE);
    expect(String(byKey.get("run_manifest")?.owner || "").length).toBeGreaterThan(0);
    expect(String(byKey.get("run_state")?.owner || "").length).toBeGreaterThan(0);

    runState.status = "completed";
    runState.currentNode = "done";
    saveRunState(runState, { updatePid: false });

    expect(existsSync(conclusionPath)).toBe(true);
    const conclusion = JSON.parse(readFileSync(conclusionPath, "utf8"));
    expect(conclusion.schemaVersion).toBe(RUN_ARTIFACT_CONCLUSION_SCHEMA_VERSION);
    expect(conclusion.status).toBe("completed");
    expect(conclusion.artifacts.live).toBe(RUN_LIVE_FILE);
    expect(conclusion.manifest.schemaVersion).toBe(RUN_ARTIFACT_MANIFEST_SCHEMA_VERSION);
    expect(String(conclusion.manifest.checksumSha256 || "")).toMatch(/^sha256:/);
  });

  it("fails closed when required manifest surfaces are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-run-artifacts-invalid-"));
    cleanupDirs.push(root);

    const runState = createRunState("run-contract-invalid", "graphs/demo.dot", { runsDir: join(root, "runs") });
    runState.context.factory_id = "mothership";

    const missingRunId = structuredClone(runState);
    (missingRunId as any).runId = "";
    expect(() =>
      writeRunArtifactContract({
        state: missingRunId,
        runDirectory: join(root, "runs", "broken"),
      })
    ).toThrow(/run_artifact_contract_invalid:run_id_missing/);

    expect(() =>
      writeRunArtifactContract({
        state: runState,
        runDirectory: "",
      })
    ).toThrow(/run_artifact_contract_invalid:run_directory_missing/);

    expect(() =>
      validateCanonicalArtifactSurfaces([
        {
          key: "run_manifest",
          file: "",
          role: "canonical",
          owner: "owner",
          required: true,
          description: "",
        },
      ])
    ).toThrow(/run_artifact_contract_invalid:canonical_artifact_path_missing:run_manifest/);
  });
});
