import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAndPersistJudgeContextContract } from "../../src/commands/judge-context-contract.ts";

function writeScenario(registryRoot, relPath, { id, domain, scope = "judge", priority = "high" }) {
  const scenarioDir = join(registryRoot, relPath);
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(
    join(scenarioDir, "SCENARIO.md"),
    `---\nid: ${id}\ndomain: ${domain}\nscope: ${scope}\npriority: ${priority}\ncreated: 2026-03-15\n---\n\n${id} truth line one.\n${id} truth line two.\n`,
    "utf8",
  );
}

test("information wall contract: builder context excludes scenario truth while judge context includes selected scenarios", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-information-wall-"));
  const registry = join(root, "registry");
  const evidencePath = join(root, "evidence.json");

  writeScenario(registry, "astrochicken/post-merge/core", {
    id: "astrochicken-post-merge-core",
    domain: "post-merge",
    priority: "high",
  });
  writeScenario(registry, "astrochicken/post-merge/safety", {
    id: "astrochicken-post-merge-safety",
    domain: "post-merge",
    priority: "medium",
  });

  writeFileSync(evidencePath, `${JSON.stringify({ ok: true }, null, 2)}\n`, "utf8");

  const builderContext = {
    issue_number: "2159",
    issue_title: "Implement curated scenario registry with judge holdout context",
    issue_body: "Builder receives issue scope and implementation contract only.",
  };

  const built = buildAndPersistJudgeContextContract({
    judgeKind: "goal_execution_post_merge",
    judgeContextRaw: JSON.stringify(builderContext),
    scenarioSelector: "astrochicken",
    scenarioContext: "post-merge",
    scope: "judge",
    scenarioRegistryRoot: registry,
    objectiveId: "post_merge_alignment",
    judgeRubric: "alignment.default",
    judgeEvidencePath: evidencePath,
    judgeEvidenceSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    subjectId: "goal-2155",
    goalNumber: "2155",
    ghRepo: "recallnet/astrochicken",
    judgeContextScopeIdentity: "goal_execute",
    worktreeDir: root,
  });

  assert.equal(built.judge_context_valid, "true");

  const judgeContext = JSON.parse(readFileSync(built.judge_context_path, "utf8"));
  const selection = JSON.parse(readFileSync(built.judge_scenario_selection_path, "utf8"));

  const builderRaw = JSON.stringify(builderContext);
  assert.doesNotMatch(builderRaw, /astrochicken-post-merge-core|astrochicken-post-merge-safety|truth line|SCENARIO\.md|judge_scenario_selection_path/);

  assert.equal(Array.isArray(judgeContext.scenario_paths), true);
  assert.equal(judgeContext.scenario_paths.length > 0, true);
  assert.equal(Array.isArray(judgeContext.scenario_basis?.selected_scenarios), true);
  assert.equal(judgeContext.scenario_basis.selected_scenarios.length > 0, true);

  assert.equal(Array.isArray(selection.selected_scenarios), true);
  assert.equal(selection.selected_scenarios.length > 0, true);

  const selected = selection.selected_scenarios[0] || {};
  assert.match(String(selected.scenario_id || ""), /astrochicken-post-merge/);
  assert.match(String(selected.truth || ""), /truth line/);
});
