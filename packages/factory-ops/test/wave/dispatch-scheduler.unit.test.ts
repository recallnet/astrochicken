import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { computeIssueSchedule } from "../../src/commands/dispatch-scheduler.ts";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const runFixture = (name) => {
  const input = loadJson(`./fixtures/dispatch-scheduler/${name}.input.json`);
  const expected = loadJson(`./fixtures/dispatch-scheduler/${name}.expected.json`);
  const out = computeIssueSchedule(input);
  assert.deepEqual(out, expected);
};

test("computeIssueSchedule selects only explicitly ready issues", () => {
  runFixture("ready-only");
});

test("computeIssueSchedule orders deterministically by ready_at, then number", () => {
  runFixture("order");
});

test("computeIssueSchedule enforces per-factory slots and requeues deterministically", () => {
  runFixture("slots");
});

test("computeIssueSchedule skips open blockers and annotates blocks", () => {
  runFixture("blocking");
});

test("computeIssueSchedule blocks when blocker state is missing but snapshot provides open state", () => {
  runFixture("blocker-state-missing");
});

test("computeIssueSchedule treats missing relationship data as eligible with notes", () => {
  runFixture("relationships-missing");
});
