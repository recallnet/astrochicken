import assert from "node:assert/strict";
import test from "node:test";

import { validateScenarioPayload } from "../../src/commands/scenario-validate-payload.ts";

const validPayload = {
  scenario_domain: "factory",
  scenario_slug: "protected-cleanup",
  scenario_md: `---
id: protected-cleanup
domain: factory
priority: high
created: 2026-03-11
---

Canonical cleanup must never delete protected repository roots.
When protection cannot be proven, cleanup aborts instead of guessing.
`,
};

test("validateScenarioPayload accepts minimal holdout-truth scenario payload", () => {
  const out = validateScenarioPayload(JSON.stringify(validPayload));
  assert.equal(out.ok, true);
  assert.equal(out.scenario_slug, "protected-cleanup");
  assert.match(out.payload, /protected-cleanup/);
});

test("validateScenarioPayload rejects frontmatter id mismatches with repair guidance", () => {
  const out = validateScenarioPayload(JSON.stringify({
    ...validPayload,
    scenario_md: validPayload.scenario_md.replace("id: protected-cleanup", "id: wrong-id"),
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /id must match scenario_slug/);
  assert.match(out.retry_prompt, /scenario_slug/);
});

test("validateScenarioPayload rejects legacy sectioned scenario markdown", () => {
  const out = validateScenarioPayload(JSON.stringify({
    ...validPayload,
    scenario_md: `---
id: protected-cleanup
domain: factory
priority: high
created: 2026-03-11
---

## Context
Old format
`,
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /must not include markdown headings/);
});
