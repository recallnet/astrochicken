import assert from "node:assert/strict";
import test from "node:test";

import { ensureScenarioStructure } from "../../src/commands/scenario-ensure-structure.ts";

test("ensureScenarioStructure normalizes required headings and checkboxes", () => {
  const raw = JSON.stringify({
    scenario_domain: "pipeline",
    scenario_slug: "x",
    scenario_md: "---\nid: x\ntitle: t\nversion: 1\ntags: [a]\npriority: high\nstatus: active\ncreated: 2026-01-01\nlast_reviewed: 2026-01-01\nauthors: [a]\n---\n\n# Context\ntext\n# Preconditions\ntext\n# Trigger\ntext\n",
  });

  const out = ensureScenarioStructure(raw);
  assert.match(out.scenario_md, /^## Context$/m);
  assert.match(out.scenario_md, /^## Preconditions$/m);
  assert.match(out.scenario_md, /^## Trigger$/m);
  assert.match(out.scenario_md, /^## Expected Behavior$/m);
  assert.match(out.scenario_md, /^## Assertions$/m);
  assert.match(out.scenario_md, /^## Edge Cases$/m);
  assert.match(out.scenario_md, /^- \[ \]/m);
});

test("ensureScenarioStructure injects missing frontmatter fields", () => {
  const raw = JSON.stringify({
    scenario_domain: "pipeline",
    scenario_slug: "my-test-scenario",
    scenario_md: "---\nid: my-test-scenario\npriority: high\n---\n\n## Context\ntext\n## Preconditions\ntext\n## Trigger\ntext\n## Expected Behavior\ntext\n## Assertions\n- [ ] check\n## Edge Cases\nnone\n",
  });

  const out = ensureScenarioStructure(raw);
  assert.match(out.scenario_md, /^id: my-test-scenario$/m);
  assert.match(out.scenario_md, /^title:/m);
  assert.match(out.scenario_md, /^version: 1$/m);
  assert.match(out.scenario_md, /^tags: \[]/m);
  assert.match(out.scenario_md, /^priority: high$/m);
  assert.match(out.scenario_md, /^status: active$/m);
  assert.match(out.scenario_md, /^created: \d{4}-\d{2}-\d{2}$/m);
  assert.match(out.scenario_md, /^last_reviewed: \d{4}-\d{2}-\d{2}$/m);
  assert.match(out.scenario_md, /^authors: \[scenario-agent]$/m);
});

test("ensureScenarioStructure adds full frontmatter when none exists", () => {
  const raw = JSON.stringify({
    scenario_domain: "factory",
    scenario_slug: "bare-scenario",
    scenario_md: "## Context\nsome text\n",
  });

  const out = ensureScenarioStructure(raw);
  assert.match(out.scenario_md, /^---\n/);
  assert.match(out.scenario_md, /^id: bare-scenario$/m);
  assert.match(out.scenario_md, /^version: 1$/m);
  assert.match(out.scenario_md, /^status: active$/m);
  assert.match(out.scenario_md, /^authors: \[scenario-agent]$/m);
  assert.match(out.scenario_md, /^## Context$/m);
});
