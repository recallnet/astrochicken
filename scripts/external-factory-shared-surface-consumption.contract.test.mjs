import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(scriptsDir, "..");
const syncScriptPath = path.join("scripts", "sync-shared-factory-surfaces.mjs");
const hatchDistIndex = path.join(monorepoRoot, "apps", "hatch", "dist", "index.js");

function runSync(args) {
  return spawnSync("node", [syncScriptPath, ...args], {
    cwd: monorepoRoot,
    encoding: "utf8",
  });
}

describe("external shared surface consumption contract", () => {
  let tempDir = "";

  before(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "shared-surface-consumption-"));

    assert.equal(
      path.resolve(tempDir).startsWith(path.resolve(monorepoRoot)),
      false,
      `temp dir must be outside monorepo root: tempDir=${tempDir} monorepoRoot=${monorepoRoot}`,
    );
  });

  after(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("syncs external runtime surfaces, detects drift, and self-heals", async () => {
    const initialSync = runSync(["--external-root", tempDir, "--factory-id", "example-trading"]);
    assert.equal(initialSync.status, 0, initialSync.stderr || initialSync.stdout);

    const supervisorSkillPath = path.join(tempDir, "skills", "_runtime", "supervisor_review", "SKILL.md");
    const narratorSkillPath = path.join(tempDir, "skills", "_runtime", "release_narrator", "SKILL.md");

    assert.equal(existsSync(supervisorSkillPath), true, `expected synced path: ${supervisorSkillPath}`);
    assert.equal(existsSync(narratorSkillPath), false, `unexpected synced path: ${narratorSkillPath}`);

    const graphsRoot = path.join(tempDir, "graphs");
    mkdirSync(graphsRoot, { recursive: true });
    const supervisorGraphPath = path.join(graphsRoot, "factory_supervisor_tick.dot");
    writeFileSync(
      supervisorGraphPath,
      `digraph factory_supervisor_tick {
  start [type="noop" label="Start"];
}
`,
      "utf8",
    );

    const scenariosRoot = path.join(tempDir, "scenarios", "external");
    mkdirSync(scenariosRoot, { recursive: true });
    writeFileSync(path.join(scenariosRoot, ".keep"), "", "utf8");

    const factoryConfigPath = path.join(tempDir, "factory.config.json");
    writeFileSync(
      factoryConfigPath,
      `${JSON.stringify({
        schema: "hatch.factory.config.v1",
        factory_id: "example-trading",
        factory_root: ".",
        target_repo: "example-org/example-trading",
        control_plane_repo: "recallnet/astrochicken",
        dispatch: {
          graph: "graphs/factory_supervisor_tick.dot",
        },
        skills: {
          supervisor: "skills/_runtime/supervisor_review/SKILL.md",
        },
        scenarios: {
          root: "scenarios/external",
        },
        pipeline: {
          supervisor_tick: "graphs/factory_supervisor_tick.dot",
        },
        runs_dir: ".hatch/example-trading/runs",
        trust_domain: "example-trading.local",
        trust: {
          domain: "example-trading.local",
          roles: [
            "example-trading.local.tool",
          ],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    assert.equal(existsSync(hatchDistIndex), true, `missing built runtime: ${hatchDistIndex}; run npm run build first`);
    const { runFactoryConformanceHarness } = await import(pathToFileURL(hatchDistIndex).href);

    assert.equal(typeof runFactoryConformanceHarness, "function", "runFactoryConformanceHarness export is missing");

    const conformance = await runFactoryConformanceHarness({
      factoryRoot: tempDir,
      repoRoot: tempDir,
      phases: ["config_schema", "skill_loading"],
    });

    assert.equal(
      conformance.ok,
      true,
      JSON.stringify(
        {
          failed_phase: conformance.failed_phase,
          first_failure: conformance.first_failure,
        },
        null,
        2,
      ),
    );

    const driftSource = readFileSync(supervisorSkillPath, "utf8");
    writeFileSync(supervisorSkillPath, `${driftSource}\n<!-- drift-test-mutation -->\n`, "utf8");

    const driftCheck = runSync(["--check", "--external-root", tempDir, "--factory-id", "example-trading"]);
    assert.notEqual(driftCheck.status, 0, "drift check should fail for mutated supervisor runtime skill");
    assert.match(driftCheck.stderr, /shared_surface_drift surface=runtime_skill:supervisor_review/);

    const resync = runSync(["--external-root", tempDir, "--factory-id", "example-trading"]);
    assert.equal(resync.status, 0, resync.stderr || resync.stdout);

    const cleanCheck = runSync(["--check", "--external-root", tempDir, "--factory-id", "example-trading"]);
    assert.equal(cleanCheck.status, 0, cleanCheck.stderr || cleanCheck.stdout);
  });
});
