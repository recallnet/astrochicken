import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateScenarioScope } from "../../src/commands/scenario-validate-scope.ts";

test("write_scenarios scope node must not reference ambient skill files", () => {
  const dot = readFileSync("factories/mothership/graphs/write_scenarios.dot", "utf8");
  assert.doesNotMatch(dot, /~\/\.claude\/skills\/scenario-scoper\/SKILL\.md/i,
    "scope node must not depend on ambient ~/.claude/skills/scenario-scoper/SKILL.md");
});

test("scenario scope validation accepts sparse high-leverage recommendations", () => {
  const out = validateScenarioScope(JSON.stringify({
    recommended: [{
      title: "Protect cleanup invariants",
      priority: "high",
      story: "Cleanup logic must avoid deleting protected roots.",
      what_makes_this_hard: "Recovery code touches mixed disposable and durable paths.",
      key_assertions: ["protected roots are never removed"],
      edge_cases: ["orphan-like paths that are still canonical"],
      registry_path: "registry/astrochicken/factory/protected-cleanup/SCENARIO.md"
    }],
    declined: [{ name: "tiny edge case", reason: "Not high leverage." }],
    coverage_notes: "Single holdout scenario is sufficient."
  }));

  assert.equal(out.ok, true);
  assert.equal(out.recommended.length, 1);
  assert.equal(out.recommended[0].scenario_domain, "factory");
  assert.equal(out.recommended[0].scenario_slug, "protected-cleanup");
});

test("scenario scope validation fails closed above recommendation ceiling", () => {
  const template = {
    title: "x",
    priority: "medium",
    story: "story",
    what_makes_this_hard: "hard",
    key_assertions: ["a"],
    edge_cases: ["b"],
    registry_path: "registry/astrochicken/core/x/SCENARIO.md"
  };

  const out = validateScenarioScope(JSON.stringify({
    recommended: [
      template,
      { ...template, registry_path: "registry/astrochicken/core/y/SCENARIO.md" },
      { ...template, registry_path: "registry/astrochicken/core/z/SCENARIO.md" }
    ],
    declined: [],
    coverage_notes: ""
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /at most 2 scenarios/i);
  assert.match(out.retry_prompt, /Return JSON only/i);
});
