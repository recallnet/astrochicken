import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runFactoryConformanceHarness } from "hatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACME_SUPPORT_DIR = path.join(REPO_ROOT, "examples", "external-factories", "acme-support");
const EXTERNAL_RUNS_DIR = "../.hatch/acme-support/runs";

describe("external-factory smoke contract", () => {
  it("passes config_schema with factoryRoot=acme-support dir and repoRoot=acme-support dir (no monorepo root)", async () => {
    const result = await runFactoryConformanceHarness({
      factoryRoot: ACME_SUPPORT_DIR,
      repoRoot: ACME_SUPPORT_DIR,
      runsDir: EXTERNAL_RUNS_DIR,
      phases: ["config_schema"],
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.failed_phase, "");
  });

  it("passes skill_loading with repoRoot set to acme-support dir (not monorepo root)", async () => {
    const result = await runFactoryConformanceHarness({
      factoryRoot: ACME_SUPPORT_DIR,
      repoRoot: ACME_SUPPORT_DIR,
      runsDir: EXTERNAL_RUNS_DIR,
      phases: ["config_schema", "skill_loading"],
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.failed_phase, "");
  });

  it("passes scenario_root with repoRoot set to acme-support dir (not monorepo root)", async () => {
    const result = await runFactoryConformanceHarness({
      factoryRoot: ACME_SUPPORT_DIR,
      repoRoot: ACME_SUPPORT_DIR,
      runsDir: EXTERNAL_RUNS_DIR,
      phases: ["config_schema", "scenario_root"],
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.failed_phase, "");
  });

  it("passes run_dir_isolation with repoRoot set to acme-support dir (not monorepo root)", async () => {
    const result = await runFactoryConformanceHarness({
      factoryRoot: ACME_SUPPORT_DIR,
      repoRoot: ACME_SUPPORT_DIR,
      runsDir: EXTERNAL_RUNS_DIR,
      phases: ["config_schema", "run_dir_isolation"],
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.failed_phase, "");
  });
});
