import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectJudgeScenarioUsage,
  isScenarioStale,
  loadScenarioRegistry,
  normalizeScenarioRegistryPath,
  resolveScenarioUsage,
} from "../../src/lib/scenario-registry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix = "scenario-registry-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeScenarioFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

function scenarioFrontmatter({
  id = "test-scenario",
  domain = "merge",
  priority = "high",
  created = "2026-01-01",
  status = "active",
  scope = "astrochicken",
} = {}) {
  return [
    "---",
    `id: ${id}`,
    `domain: ${domain}`,
    `priority: ${priority}`,
    `created: ${created}`,
    `status: ${status}`,
    `scope: ${scope}`,
    "---",
    "",
    "Test scenario content.",
    "",
  ].join("\n");
}

function writeSelectionArtifact(root, relPath, selectedScenarios) {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify({ selected_scenarios: selectedScenarios }), "utf8");
  return full;
}

// ---------------------------------------------------------------------------
// loadScenarioRegistry
// ---------------------------------------------------------------------------

test("loadScenarioRegistry — returns empty rows when registryRoot does not exist", () => {
  const root = join(makeTmpDir(), "nonexistent");
  const result = loadScenarioRegistry({ registryRoot: root });

  assert.equal(result.scenario_count, 0);
  assert.deepStrictEqual(result.rows, []);
  assert.equal(result.registry_root, root);
});

test("loadScenarioRegistry — finds SCENARIO.md files recursively", () => {
  const root = makeTmpDir();
  try {
    writeScenarioFile(root, "merge/s1/SCENARIO.md", scenarioFrontmatter({ id: "s1" }));
    writeScenarioFile(root, "review/s2/SCENARIO.md", scenarioFrontmatter({ id: "s2", domain: "review" }));
    // Nested deeper
    writeScenarioFile(root, "deep/nested/s3/SCENARIO.md", scenarioFrontmatter({ id: "s3", domain: "deep" }));
    // Non-SCENARIO.md file should be ignored
    writeScenarioFile(root, "merge/s1/README.md", "# not a scenario");

    const result = loadScenarioRegistry({ registryRoot: root });

    assert.equal(result.scenario_count, 3);
    const ids = result.rows.map((r) => r.scenario_id);
    assert.ok(ids.includes("s1"));
    assert.ok(ids.includes("s2"));
    assert.ok(ids.includes("s3"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadScenarioRegistry — parses frontmatter fields", () => {
  const root = makeTmpDir();
  try {
    writeScenarioFile(
      root,
      "merge/my-scenario/SCENARIO.md",
      scenarioFrontmatter({
        id: "my-scenario",
        domain: "merge",
        priority: "critical",
        created: "2026-02-15",
        status: "active",
        scope: "astrochicken",
      }),
    );

    const result = loadScenarioRegistry({ registryRoot: root });
    assert.equal(result.scenario_count, 1);

    const row = result.rows[0];
    assert.equal(row.scenario_id, "my-scenario");
    assert.equal(row.domain, "merge");
    assert.equal(row.priority, "critical");
    assert.equal(row.created, "2026-02-15");
    assert.equal(row.status, "active");
    assert.equal(row.scope, "astrochicken");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadScenarioRegistry — falls back to path-inferred fields when frontmatter is missing", () => {
  const root = makeTmpDir();
  try {
    // scope/domain/id/SCENARIO.md — no frontmatter
    writeScenarioFile(root, "astrochicken/merge/inferred-scenario/SCENARIO.md", "No frontmatter here.");

    const result = loadScenarioRegistry({ registryRoot: root });
    assert.equal(result.scenario_count, 1);

    const row = result.rows[0];
    assert.equal(row.scenario_id, "inferred-scenario");
    assert.equal(row.domain, "merge");
    assert.equal(row.scope, "astrochicken");
    // No frontmatter means these are empty
    assert.equal(row.priority, "");
    assert.equal(row.created, "");
    assert.equal(row.status, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadScenarioRegistry — sorts rows by path", () => {
  const root = makeTmpDir();
  try {
    writeScenarioFile(root, "z-domain/z-scenario/SCENARIO.md", scenarioFrontmatter({ id: "z-scenario" }));
    writeScenarioFile(root, "a-domain/a-scenario/SCENARIO.md", scenarioFrontmatter({ id: "a-scenario" }));
    writeScenarioFile(root, "m-domain/m-scenario/SCENARIO.md", scenarioFrontmatter({ id: "m-scenario" }));

    const result = loadScenarioRegistry({ registryRoot: root });
    const paths = result.rows.map((r) => r.path);

    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(paths, sorted);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadScenarioRegistry — frontmatter overrides path-inferred fields", () => {
  const root = makeTmpDir();
  try {
    // Path says domain=review, but frontmatter says domain=merge
    writeScenarioFile(
      root,
      "scope1/review/path-id/SCENARIO.md",
      scenarioFrontmatter({ id: "frontmatter-id", domain: "merge", scope: "custom-scope" }),
    );

    const result = loadScenarioRegistry({ registryRoot: root });
    const row = result.rows[0];
    assert.equal(row.scenario_id, "frontmatter-id");
    assert.equal(row.domain, "merge");
    assert.equal(row.scope, "custom-scope");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// isScenarioStale
// ---------------------------------------------------------------------------

test("isScenarioStale — returns true when usageCount is 0", () => {
  assert.equal(
    isScenarioStale({ usageCount: 0, lastUsedEpochMs: Date.now(), staleDays: 90, nowEpochMs: Date.now() }),
    true,
  );
});

test("isScenarioStale — returns true when lastUsedEpochMs is 0", () => {
  assert.equal(
    isScenarioStale({ usageCount: 5, lastUsedEpochMs: 0, staleDays: 90, nowEpochMs: Date.now() }),
    true,
  );
});

test("isScenarioStale — returns true when age exceeds staleDays", () => {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const lastUsed = now - 91 * DAY_MS; // 91 days ago, stale at 90
  assert.equal(
    isScenarioStale({ usageCount: 3, lastUsedEpochMs: lastUsed, staleDays: 90, nowEpochMs: now }),
    true,
  );
});

test("isScenarioStale — returns false when age is within staleDays", () => {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const lastUsed = now - 10 * DAY_MS; // 10 days ago, well within 90
  assert.equal(
    isScenarioStale({ usageCount: 3, lastUsedEpochMs: lastUsed, staleDays: 90, nowEpochMs: now }),
    false,
  );
});

test("isScenarioStale — returns true for negative usageCount", () => {
  assert.equal(
    isScenarioStale({ usageCount: -1, lastUsedEpochMs: Date.now(), staleDays: 90, nowEpochMs: Date.now() }),
    true,
  );
});

test("isScenarioStale — returns true for non-finite lastUsedEpochMs (NaN)", () => {
  assert.equal(
    isScenarioStale({ usageCount: 5, lastUsedEpochMs: NaN, staleDays: 90, nowEpochMs: Date.now() }),
    true,
  );
});

test("isScenarioStale — returns true for non-finite lastUsedEpochMs (Infinity)", () => {
  assert.equal(
    isScenarioStale({ usageCount: 5, lastUsedEpochMs: Infinity, staleDays: 90, nowEpochMs: Date.now() }),
    true,
  );
});

test("isScenarioStale — uses default staleDays when invalid staleDays provided", () => {
  // Default staleDays is 90. With -1, parsePositiveInt falls back to 90.
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const lastUsed = now - 50 * DAY_MS; // 50 days — not stale at default 90
  assert.equal(
    isScenarioStale({ usageCount: 1, lastUsedEpochMs: lastUsed, staleDays: -1, nowEpochMs: now }),
    false,
  );
});

test("isScenarioStale — defaults work with no arguments", () => {
  // No args → usageCount defaults to 0 → stale
  assert.equal(isScenarioStale(), true);
});

test("isScenarioStale — boundary: exactly at staleDays is not stale", () => {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const lastUsed = now - 90 * DAY_MS; // exactly 90 days — not stale (> not >=)
  assert.equal(
    isScenarioStale({ usageCount: 1, lastUsedEpochMs: lastUsed, staleDays: 90, nowEpochMs: now }),
    false,
  );
});

// ---------------------------------------------------------------------------
// resolveScenarioUsage
// ---------------------------------------------------------------------------

test("resolveScenarioUsage — returns unobserved when no matches exist", () => {
  const result = resolveScenarioUsage({
    scenarioPath: "merge/no-match/SCENARIO.md",
    scenarioId: "no-match",
    usageByPath: new Map(),
    usageById: new Map(),
  });

  assert.equal(result.usage_count, 0);
  assert.equal(result.last_used_epoch_ms, 0);
  assert.equal(result.last_used, "");
  assert.equal(result.usage_source, "unobserved");
});

test("resolveScenarioUsage — matches by exact path", () => {
  const usageByPath = new Map([
    ["merge/s1/SCENARIO.md", { usage_count: 3, last_used_epoch_ms: 1000, last_used: "ts" }],
  ]);

  const result = resolveScenarioUsage({
    scenarioPath: "merge/s1/SCENARIO.md",
    scenarioId: "s1",
    usageByPath,
    usageById: new Map(),
  });

  assert.equal(result.usage_count, 3);
  assert.equal(result.last_used_epoch_ms, 1000);
  assert.equal(result.usage_source, "scenario_path");
});

test("resolveScenarioUsage — matches by path suffix", () => {
  // Usage recorded with a longer path, but scenario path is a suffix
  const usageByPath = new Map([
    ["factories/mothership/scenarios/astrochicken/merge/s1/SCENARIO.md", {
      usage_count: 2,
      last_used_epoch_ms: 2000,
      last_used: "ts",
    }],
  ]);

  const result = resolveScenarioUsage({
    scenarioPath: "merge/s1/SCENARIO.md",
    scenarioId: "s1",
    usageByPath,
    usageById: new Map(),
  });

  assert.equal(result.usage_count, 2);
  assert.equal(result.last_used_epoch_ms, 2000);
  assert.equal(result.usage_source, "scenario_path");
});

test("resolveScenarioUsage — falls back to id match when path does not match", () => {
  const usageById = new Map([
    ["s1", { usage_count: 7, last_used_epoch_ms: 5000, last_used: "ts" }],
  ]);

  const result = resolveScenarioUsage({
    scenarioPath: "totally/different/path/SCENARIO.md",
    scenarioId: "s1",
    usageByPath: new Map(),
    usageById,
  });

  assert.equal(result.usage_count, 7);
  assert.equal(result.last_used_epoch_ms, 5000);
  assert.equal(result.usage_source, "scenario_id");
});

test("resolveScenarioUsage — merges multiple path matches", () => {
  // Two usage entries whose paths suffix-match
  const usageByPath = new Map([
    ["prefix1/merge/s1/SCENARIO.md", {
      usage_count: 2,
      last_used_epoch_ms: 1000,
      last_used: "ts1",
    }],
    ["prefix2/merge/s1/SCENARIO.md", {
      usage_count: 3,
      last_used_epoch_ms: 5000,
      last_used: "ts2",
    }],
  ]);

  const result = resolveScenarioUsage({
    scenarioPath: "merge/s1/SCENARIO.md",
    scenarioId: "s1",
    usageByPath,
    usageById: new Map(),
  });

  assert.equal(result.usage_count, 5); // 2 + 3
  assert.equal(result.last_used_epoch_ms, 5000); // max
  assert.equal(result.usage_source, "scenario_path_suffix");
});

test("resolveScenarioUsage — path match takes priority over id match", () => {
  const usageByPath = new Map([
    ["merge/s1/SCENARIO.md", { usage_count: 1, last_used_epoch_ms: 100, last_used: "ts" }],
  ]);
  const usageById = new Map([
    ["s1", { usage_count: 99, last_used_epoch_ms: 9999, last_used: "ts" }],
  ]);

  const result = resolveScenarioUsage({
    scenarioPath: "merge/s1/SCENARIO.md",
    scenarioId: "s1",
    usageByPath,
    usageById,
  });

  // Path match should win
  assert.equal(result.usage_count, 1);
  assert.equal(result.usage_source, "scenario_path");
});

test("resolveScenarioUsage — defaults with no arguments", () => {
  const result = resolveScenarioUsage();
  assert.equal(result.usage_source, "unobserved");
  assert.equal(result.usage_count, 0);
});

// ---------------------------------------------------------------------------
// normalizeScenarioRegistryPath
// ---------------------------------------------------------------------------

test("normalizeScenarioRegistryPath — normalizes backslashes", () => {
  assert.equal(normalizeScenarioRegistryPath("merge\\s1\\SCENARIO.md"), "merge/s1/SCENARIO.md");
});

test("normalizeScenarioRegistryPath — strips leading ./", () => {
  assert.equal(normalizeScenarioRegistryPath("./merge/s1/SCENARIO.md"), "merge/s1/SCENARIO.md");
});

test("normalizeScenarioRegistryPath — handles empty string", () => {
  assert.equal(normalizeScenarioRegistryPath(""), "");
});

test("normalizeScenarioRegistryPath — handles undefined input", () => {
  assert.equal(normalizeScenarioRegistryPath(undefined), "");
});

test("normalizeScenarioRegistryPath — handles no arguments", () => {
  assert.equal(normalizeScenarioRegistryPath(), "");
});

test("normalizeScenarioRegistryPath — preserves already-normalized paths", () => {
  assert.equal(normalizeScenarioRegistryPath("merge/s1/SCENARIO.md"), "merge/s1/SCENARIO.md");
});

test("normalizeScenarioRegistryPath — strips whitespace", () => {
  assert.equal(normalizeScenarioRegistryPath("  merge/s1/SCENARIO.md  "), "merge/s1/SCENARIO.md");
});

test("normalizeScenarioRegistryPath — handles mixed backslashes and leading ./", () => {
  assert.equal(normalizeScenarioRegistryPath(".\\merge\\s1\\SCENARIO.md"), "merge/s1/SCENARIO.md");
});

// ---------------------------------------------------------------------------
// collectJudgeScenarioUsage
// ---------------------------------------------------------------------------

test("collectJudgeScenarioUsage — returns empty usage when runsRoot does not exist", () => {
  const root = join(makeTmpDir(), "nonexistent");
  const result = collectJudgeScenarioUsage({ runsRoot: root });

  assert.equal(result.runs_root, root);
  assert.equal(result.observed_run_count, 0);
  assert.equal(result.selection_artifact_count, 0);
  assert.equal(result.parsed_selection_artifact_count, 0);
  assert.equal(result.usage_by_path.size, 0);
  assert.equal(result.usage_by_id.size, 0);
});

test("collectJudgeScenarioUsage — collects scenario-selection JSON artifacts from run directories", () => {
  const root = makeTmpDir();
  try {
    // Create a run directory with a judge/scenario-selection artifact
    writeSelectionArtifact(
      root,
      "run-001/sessions/s1/judge/scenario-selection/result.json",
      [
        { scenario_id: "sc-1", scenario_path: "merge/sc-1/SCENARIO.md" },
        { scenario_id: "sc-2", scenario_path: "review/sc-2/SCENARIO.md" },
      ],
    );

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    assert.equal(result.observed_run_count, 1);
    assert.ok(result.selection_artifact_count >= 1);
    assert.ok(result.parsed_selection_artifact_count >= 1);
    assert.ok(result.usage_by_id.has("sc-1"));
    assert.ok(result.usage_by_id.has("sc-2"));
    assert.ok(result.usage_by_path.has("merge/sc-1/SCENARIO.md"));
    assert.ok(result.usage_by_path.has("review/sc-2/SCENARIO.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — respects lookback limit", () => {
  const root = makeTmpDir();
  try {
    // Create 3 run directories, lookback only 2
    for (const runName of ["run-001", "run-002", "run-003"]) {
      writeSelectionArtifact(
        root,
        `${runName}/sessions/s1/judge/scenario-selection/result.json`,
        [{ scenario_id: `${runName}-sc`, scenario_path: `merge/${runName}-sc/SCENARIO.md` }],
      );
    }

    const result = collectJudgeScenarioUsage({ runsRoot: root, lookbackRuns: 2 });

    assert.equal(result.lookback_runs, 2);
    assert.equal(result.observed_run_count, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — parses selected_scenarios from artifacts", () => {
  const root = makeTmpDir();
  try {
    writeSelectionArtifact(
      root,
      "run-001/sessions/s1/judge/scenario-selection/result.json",
      [
        { scenario_id: "test-scenario", scenario_path: "merge/test-scenario/SCENARIO.md" },
      ],
    );

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    const idUsage = result.usage_by_id.get("test-scenario");
    assert.ok(idUsage, "expected usage by id for test-scenario");
    assert.equal(idUsage.usage_count, 1);

    const pathUsage = result.usage_by_path.get("merge/test-scenario/SCENARIO.md");
    assert.ok(pathUsage, "expected usage by path");
    assert.equal(pathUsage.usage_count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — ignores malformed JSON artifacts", () => {
  const root = makeTmpDir();
  try {
    const artifactPath = join(root, "run-001/sessions/s1/judge/scenario-selection/bad.json");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(artifactPath, "NOT VALID JSON", "utf8");

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    assert.equal(result.parsed_selection_artifact_count, 0);
    assert.equal(result.usage_by_path.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — ignores artifacts without selected_scenarios array", () => {
  const root = makeTmpDir();
  try {
    const artifactPath = join(root, "run-001/sessions/s1/judge/scenario-selection/empty.json");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(artifactPath, JSON.stringify({ other_field: "value" }), "utf8");

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    assert.equal(result.parsed_selection_artifact_count, 0);
    assert.equal(result.usage_by_path.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — merges usage across multiple artifacts for same scenario", () => {
  const root = makeTmpDir();
  try {
    // Two run dirs, same scenario in each
    writeSelectionArtifact(
      root,
      "run-001/sessions/s1/judge/scenario-selection/result.json",
      [{ scenario_id: "shared-sc", scenario_path: "merge/shared-sc/SCENARIO.md" }],
    );
    writeSelectionArtifact(
      root,
      "run-002/sessions/s1/judge/scenario-selection/result.json",
      [{ scenario_id: "shared-sc", scenario_path: "merge/shared-sc/SCENARIO.md" }],
    );

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    const idUsage = result.usage_by_id.get("shared-sc");
    assert.ok(idUsage);
    assert.equal(idUsage.usage_count, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — ignores JSON files not in judge/scenario-selection path", () => {
  const root = makeTmpDir();
  try {
    // Artifact in wrong path — should be ignored
    const artifactPath = join(root, "run-001/sessions/s1/other-step/result.json");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({ selected_scenarios: [{ scenario_id: "ignored", scenario_path: "x/y/SCENARIO.md" }] }),
      "utf8",
    );

    const result = collectJudgeScenarioUsage({ runsRoot: root });

    assert.equal(result.parsed_selection_artifact_count, 0);
    assert.equal(result.usage_by_id.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectJudgeScenarioUsage — uses default lookbackRuns for invalid values", () => {
  const root = makeTmpDir();
  try {
    const result = collectJudgeScenarioUsage({ runsRoot: root, lookbackRuns: -5 });
    // Should fall back to DEFAULT_SCENARIO_LOOKBACK_RUNS (30)
    assert.equal(result.lookback_runs, 30);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
