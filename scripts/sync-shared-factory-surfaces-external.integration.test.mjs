import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const syncScriptPath = join(repoRoot, "scripts", "sync-shared-factory-surfaces.mjs");
const checkScriptPath = join(repoRoot, "scripts", "check-shared-surface-external-layout.mjs");

function withTempExternalRoot(run) {
  const tempRoot = mkdtempSync(join(tmpdir(), "shared-surfaces-external-"));
  try {
    run(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function renderExternal(tempRoot) {
  return spawnSync("node", [syncScriptPath, "--factory-id", "example-trading", "--external-root", tempRoot], {
    encoding: "utf8",
    cwd: repoRoot,
  });
}

function supervisorSkillPath(tempRoot) {
  return join(tempRoot, "skills", "_runtime", "supervisor_review", "SKILL.md");
}

test("external sync does not render shared graph files when manifest is empty", () => {
  withTempExternalRoot((tempRoot) => {
    const run = renderExternal(tempRoot);
    assert.equal(run.status, 0, run.stderr);

    const graphsDir = join(tempRoot, "graphs");
    if (!existsSync(graphsDir)) {
      return;
    }

    const graphNames = readdirSync(graphsDir).filter((entry) => entry.endsWith(".dot")).sort();
    assert.deepEqual(graphNames, []);
  });
});

test("external sync copies only supervisor runtime skill", () => {
  withTempExternalRoot((tempRoot) => {
    const run = renderExternal(tempRoot);
    assert.equal(run.status, 0, run.stderr);

    const supervisorSkill = readFileSync(supervisorSkillPath(tempRoot), "utf8");
    const narratorSkillPath = join(tempRoot, "skills", "_runtime", "release_narrator", "SKILL.md");

    assert.ok(supervisorSkill.trim().length > 0);
    assert.equal(existsSync(narratorSkillPath), false);
  });
});

test("external sync emits roles.stylesheet.override.example", () => {
  withTempExternalRoot((tempRoot) => {
    const run = renderExternal(tempRoot);
    assert.equal(run.status, 0, run.stderr);

    const overlay = readFileSync(join(tempRoot, "roles.stylesheet.override.example"), "utf8");
    assert.match(overlay, /llm_model/);
    assert.match(overlay, /llm_provider/);
  });
});

test("external --check detects supervisor runtime skill drift and sync repairs it", () => {
  withTempExternalRoot((tempRoot) => {
    const firstRun = renderExternal(tempRoot);
    assert.equal(firstRun.status, 0, firstRun.stderr);

    const driftedPath = supervisorSkillPath(tempRoot);
    const original = readFileSync(driftedPath, "utf8");
    writeFileSync(driftedPath, `${original}\n<!-- drift -->\n`);

    const checkRun = spawnSync(
      "node",
      [syncScriptPath, "--factory-id", "example-trading", "--external-root", tempRoot, "--check"],
      { encoding: "utf8", cwd: repoRoot },
    );
    assert.equal(checkRun.status, 1);
    assert.match(checkRun.stderr, /shared_surface_drift surface=runtime_skill:supervisor_review file=/);

    const repairRun = renderExternal(tempRoot);
    assert.equal(repairRun.status, 0, repairRun.stderr);

    const repaired = readFileSync(driftedPath, "utf8");
    assert.equal(repaired, original);
  });
});

test("external layout check passes for fresh render", () => {
  withTempExternalRoot((tempRoot) => {
    const renderRun = renderExternal(tempRoot);
    assert.equal(renderRun.status, 0, renderRun.stderr);

    const checkRun = spawnSync(
      "node",
      [checkScriptPath, "--external-root", tempRoot, "--factory-id", "example-trading"],
      { encoding: "utf8", cwd: repoRoot },
    );

    assert.equal(checkRun.status, 0, checkRun.stderr);
  });
});

test("external layout check fails when supervisor runtime skill is missing", () => {
  withTempExternalRoot((tempRoot) => {
    const renderRun = renderExternal(tempRoot);
    assert.equal(renderRun.status, 0, renderRun.stderr);

    unlinkSync(supervisorSkillPath(tempRoot));

    const checkRun = spawnSync(
      "node",
      [checkScriptPath, "--external-root", tempRoot, "--factory-id", "example-trading"],
      { encoding: "utf8", cwd: repoRoot },
    );

    assert.equal(checkRun.status, 1);
    assert.match(checkRun.stderr, /missing_runtime_skill skill=supervisor_review/);
  });
});
