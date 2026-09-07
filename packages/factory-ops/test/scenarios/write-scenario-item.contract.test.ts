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

Cleanup must refuse protected roots.
If protection checks fail, cleanup aborts.
`,
};

test("scenario payload validation accepts minimal payloads", () => {
  const out = validateScenarioPayload(JSON.stringify(validPayload));
  assert.equal(out.ok, true);
  assert.equal(out.scenario_domain, "factory");
  assert.equal(out.scenario_slug, "protected-cleanup");
  assert.match(out.payload, /protected-cleanup/);
});

test("scenario payload validation fails closed on frontmatter id mismatch", () => {
  const out = validateScenarioPayload(JSON.stringify({
    ...validPayload,
    scenario_md: validPayload.scenario_md.replace("id: protected-cleanup", "id: wrong-id"),
  }));

  assert.equal(out.ok, false);
  assert.match(out.error, /id must match scenario_slug/i);
  assert.match(out.retry_prompt, /scenario_slug/i);
});
