import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatScenarioCurateTable, scenarioCurate } from "../../src/commands/scenario-curate.ts";

function writeScenario(registryRoot, domain, id, priority = "medium") {
  const filePath = join(registryRoot, domain, id, "SCENARIO.md");
  mkdirSync(join(registryRoot, domain, id), { recursive: true });
  writeFileSync(
    filePath,
    `---\nid: ${id}\ndomain: ${domain}\npriority: ${priority}\ncreated: 2026-03-16\nstatus: active\nauthors: [scenario-ops]\n---\n\nTruth for ${id}.\n`,
    "utf8",
  );
}

function writeSelectionArtifact({ runsRoot, runId, fileName = "selection.json", selectedScenarios = [], mtimeMs }) {
  const selectionDir = join(runsRoot, runId, ".hatch", "judge", "scenario-selection");
  mkdirSync(selectionDir, { recursive: true });
  const selectionPath = join(selectionDir, fileName);
  writeFileSync(
    selectionPath,
    `${JSON.stringify({ selected_scenarios: selectedScenarios }, null, 2)}\n`,
    "utf8",
  );
  if (Number.isFinite(mtimeMs)) {
    const when = new Date(mtimeMs);
    utimesSync(selectionPath, when, when);
  }
  return selectionPath;
}

test("scenarioCurate reports usage counts, last_used timestamps, and stale candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-curate-"));
  const registry = join(root, "registry");
  const runsRoot = join(root, "runs");

  writeScenario(registry, "post-merge", "astrochicken-post-merge-core", "high");
  writeScenario(registry, "post-merge", "astrochicken-post-merge-safety", "medium");

  const now = Date.now();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  writeSelectionArtifact({
    runsRoot,
    runId: "run-001",
    selectedScenarios: [{ scenario_id: "astrochicken-post-merge-core", scenario_path: "post-merge/astrochicken-post-merge-core/SCENARIO.md" }],
    mtimeMs: now - tenDaysMs,
  });

  writeSelectionArtifact({
    runsRoot,
    runId: "run-002",
    selectedScenarios: [{ scenario_id: "astrochicken-post-merge-core", scenario_path: "post-merge/astrochicken-post-merge-core/SCENARIO.md" }],
    mtimeMs: now,
  });

  const out = scenarioCurate({
    registryRoot: registry,
    runsRoot,
    lookbackRuns: "30",
    staleDays: "5",
  });

  assert.equal(out.ok, true);
  assert.equal(out.scenario_count, "2");
  assert.equal(out.observed_run_count, "2");
  assert.equal(out.rows.length, 2);

  const core = out.rows.find((row) => row.scenario_id === "astrochicken-post-merge-core");
  const safety = out.rows.find((row) => row.scenario_id === "astrochicken-post-merge-safety");

  assert.ok(core);
  assert.equal(core.usage_count, "2");
  assert.notEqual(core.last_used, "never");
  assert.equal(core.stale, "false");

  assert.ok(safety);
  assert.equal(safety.usage_count, "0");
  assert.equal(safety.last_used, "never");
  assert.equal(safety.stale, "true");
  assert.deepEqual(out.stale_candidates, ["astrochicken-post-merge-safety"]);
});

test("scenarioCurate fails closed when registry exceeds hard ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-curate-"));
  const registry = join(root, "registry");
  const runsRoot = join(root, "runs");

  for (let index = 1; index <= 31; index += 1) {
    const id = `scenario-${String(index).padStart(2, "0")}`;
    writeScenario(registry, "post-merge", id, "low");
  }

  const out = scenarioCurate({
    registryRoot: registry,
    runsRoot,
    lookbackRuns: "5",
    staleDays: "90",
  });

  assert.equal(out.ok, false);
  assert.match(out.error, /exceeds configured ceiling/);
  assert.equal(out.scenario_count, "31");
  assert.equal(out.scenario_count_ceiling, "30");
});

test("formatScenarioCurateTable renders report with headers and notes", () => {
  const rendered = formatScenarioCurateTable({
    registry_root: "/tmp/scenarios",
    runs_root: "/tmp/runs",
    lookback_runs: "30",
    stale_days: "90",
    scenario_count: "2",
    scenario_count_ceiling: "30",
    stale_count: "1",
    observed_run_count: "5",
    rows: [{
      scenario_id: "astrochicken-post-merge-core",
      domain: "post-merge",
      priority: "high",
      usage_count: "3",
      last_used: "2026-03-16T01:02:03.000Z",
      stale: "false",
      path: "post-merge/astrochicken-post-merge-core/SCENARIO.md",
    }],
    notes: ["manual curation"],
  });

  assert.match(rendered, /Scenario curation report/);
  assert.match(rendered, /scenario_id\tdomain\tpriority\tusage\tlast_used\tstale\tpath/);
  assert.match(rendered, /astrochicken-post-merge-core/);
  assert.match(rendered, /notes:\n- manual curation/);
});
