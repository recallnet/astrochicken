import assert from "node:assert/strict";
import test from "node:test";

import { validateScenarioScope } from "../../src/commands/scenario-validate-scope.ts";

test("validateScenarioScope accepts valid sparse recommended scenarios", () => {
  const out = validateScenarioScope(JSON.stringify({
    recommended: [{
      title: "Protect canonical cleanup",
      priority: "high",
      story: "Cleanup code must not delete protected worktrees.",
      what_makes_this_hard: "Recovery code often mixes disposable and protected paths.",
      key_assertions: ["cleanup refuses protected roots"],
      edge_cases: ["canonical checkout exists but looks orphaned"],
      registry_path: "registry/astrochicken/factory/protected-cleanup/SCENARIO.md",
    }],
    declined: [{ name: "tiny edge case", reason: "Too narrow." }],
    coverage_notes: "One high-leverage scenario is enough.",
  }));

  assert.equal(out.ok, true);
  assert.equal(out.recommended[0].scenario_domain, "factory");
  assert.equal(out.recommended[0].scenario_slug, "protected-cleanup");
});

test("validateScenarioScope rejects unresolved or malformed registry paths with retry instructions", () => {
  const out = validateScenarioScope(JSON.stringify({
    recommended: [{
      title: "Bad path",
      priority: "high",
      story: "Story",
      what_makes_this_hard: "Hard",
      key_assertions: ["x"],
      edge_cases: ["y"],
      registry_path: "registry/astrochicken/not/a/real/path.md",
    }],
    declined: [],
    coverage_notes: "",
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /registry_path/);
  assert.match(out.retry_prompt, /registry\/astrochicken/);
});

test("validateScenarioScope rejects more than two recommendations", () => {
  const scenario = {
    title: "x",
    priority: "medium",
    story: "story",
    what_makes_this_hard: "hard",
    key_assertions: ["a"],
    edge_cases: ["b"],
    registry_path: "registry/astrochicken/core/x/SCENARIO.md",
  };
  const out = validateScenarioScope(JSON.stringify({
    recommended: [scenario, { ...scenario, registry_path: "registry/astrochicken/core/y/SCENARIO.md" }, { ...scenario, registry_path: "registry/astrochicken/core/z/SCENARIO.md" }],
    declined: [],
    coverage_notes: "",
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /at most 2/);
});
