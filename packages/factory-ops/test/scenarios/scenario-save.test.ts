import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveScenario } from "../../src/commands/scenario-save.ts";

test("saveScenario writes SCENARIO.md to registry path", () => {
  const tmp = mkdtempSync(join(tmpdir(), "scenario-save-"));
  try {
    const payload = JSON.stringify({
      scenario_domain: "core",
      scenario_slug: "test-slug",
      scenario_md: "---\nid: test-slug\ndomain: core\npriority: high\ncreated: 2026-03-11\n---\n\nCore scenario truth line.\n",
    });
    const out = saveScenario({ payload, registryRoot: tmp });
    assert.equal(out.ok, true);
    assert.ok(out.path.endsWith("core/test-slug/SCENARIO.md"));
    const content = readFileSync(out.path, "utf8");
    assert.ok(content.includes("Core scenario truth line."));
    assert.ok(content.includes("domain: core"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saveScenario returns error for missing domain", () => {
  const out = saveScenario({ payload: JSON.stringify({ scenario_slug: "s", scenario_md: "x" }), registryRoot: "/tmp/scenarios" });
  assert.equal(out.ok, false);
  assert.ok(out.error.includes("scenario_domain"));
});

test("saveScenario returns error for empty scenario_md", () => {
  const out = saveScenario({ payload: JSON.stringify({ scenario_domain: "d", scenario_slug: "s", scenario_md: "" }), registryRoot: "/tmp/scenarios" });
  assert.equal(out.ok, false);
  assert.ok(out.error.includes("non-empty"));
});

test("saveScenario returns error for structurally invalid scenario payload", () => {
  const out = saveScenario({
    payload: JSON.stringify({
      scenario_domain: "factory",
      scenario_slug: "broken-scenario",
      scenario_md: "## Context\nmissing frontmatter\n",
    }),
    registryRoot: "/tmp/scenarios",
  });
  assert.equal(out.ok, false);
  assert.ok(out.error.includes("frontmatter"));
});

test("saveScenario returns error when registryRoot is omitted", () => {
  const out = saveScenario({
    payload: JSON.stringify({
      scenario_domain: "factory",
      scenario_slug: "scenario-root-required",
      scenario_md: "---\nid: scenario-root-required\ndomain: factory\npriority: high\ncreated: 2026-03-11\n---\n\nTruth line.\n",
    }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "registryRoot is required");
});
