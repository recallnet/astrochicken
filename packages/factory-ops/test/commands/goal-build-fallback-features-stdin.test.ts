import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";


import test from "node:test";

test("goal build-fallback-features accepts stdin payload transport", () => {
  const goalIssue = {
    number: 321,
    title: "Goal: stdin payload fallback",
    body: "Ensure fallback works for O'Hare and quoted \"payload\" bodies",
  };

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-number",
      "321"
    ], {
      input: JSON.stringify(goalIssue)
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const parsed = JSON.parse(run.stdout || "[]");
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
});
