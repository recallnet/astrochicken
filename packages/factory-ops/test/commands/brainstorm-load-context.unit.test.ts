import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readBrainstormCursor, writeBrainstormCursor } from "../../src/commands/brainstorm-cursor.ts";
import { loadBrainstormContext } from "../../src/commands/brainstorm-load-context.ts";

test("loadBrainstormContext uses default seed for empty body", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-load-"));
  const out = loadBrainstormContext({
    factoryId: "mothership",
    rootDir: root,
    brainstormIssueNumber: "2019",
    brainstormIssueBody: "   ",
    intentStackRaw: '{"intent_stack_summary":"intent summary"}',
    shippedGoalsSinceLastRaw: "[]",
    scenarioHoldoutsRaw: "[]",
    openBacklogSummary: "open backlog",
  });

  assert.equal(out.seed_prompt_source, "default_seed");
  assert.equal(out.seed_prompt, "highest ROI goal given current state");
  assert.equal(out.intent_stack_summary, "intent summary");
  assert.equal(out.cursor_path.endsWith("/brainstorm-cursor.json"), true);
  assert.equal(existsSync(out.cursor_path), false);
  assert.equal(existsSync(`${out.cursor_path}.tmp`), false);
  assert.equal(out.next_cursor.last_brainstorm_issue_number, "2019");
  assert.equal(out.next_cursor.last_seed_prompt, "highest ROI goal given current state");
});

test("loadBrainstormContext uses issue body as seed when present", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-load-"));
  const out = loadBrainstormContext({
    factoryId: "mothership",
    rootDir: root,
    brainstormIssueNumber: "2020",
    brainstormIssueBody: "investigate release throughput",
    intentStackRaw: "{}",
    shippedGoalsSinceLastRaw: "[]",
    scenarioHoldoutsRaw: "[]",
    openBacklogSummary: "backlog",
  });

  assert.equal(out.seed_prompt_source, "issue_body");
  assert.equal(out.seed_prompt, "investigate release throughput");
});

test("loadBrainstormContext computes delta fields against cursor snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-load-"));
  writeBrainstormCursor({
    factoryId: "mothership",
    rootDir: root,
    cursor: {
      last_brainstorm_issue_number: "1",
      last_seed_prompt: "seed one",
      last_intent_stack_sha256: "x",
      last_shipped_goals_sha256: "y",
      last_scenario_holdouts_sha256: "z",
      intent_stack_snapshot: '{"a":1}',
      shipped_goals_snapshot: '[1]',
      scenario_holdouts_snapshot: '["h1"]',
    },
  });

  const out = loadBrainstormContext({
    factoryId: "mothership",
    rootDir: root,
    brainstormIssueNumber: "2",
    brainstormIssueBody: "seed two",
    intentStackRaw: '{"a":2}',
    shippedGoalsSinceLastRaw: '[1,2]',
    scenarioHoldoutsRaw: '["h1"]',
    openBacklogSummary: "second",
  });

  assert.equal(out.intent_stack_delta.changed, "true");
  assert.equal(out.shipped_goals_delta.changed, "true");
  assert.equal(out.scenario_holdouts_delta.changed, "false");

  assert.equal(out.next_cursor.last_brainstorm_issue_number, "2");
  assert.equal(out.next_cursor.last_seed_prompt, "seed two");
});

test("loadBrainstormContext fails closed when issue number missing", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-load-"));
  assert.throws(() => {
    loadBrainstormContext({
      factoryId: "mothership",
      rootDir: root,
      brainstormIssueNumber: "",
    });
  }, /missing_brainstorm_issue_number/);
});

test("read cursor returns null for corrupt JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-load-"));
  const dir = join(root, ".hatch", "factories", "mothership");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "brainstorm-cursor.json");
  writeFileSync(path, "not-json", "utf8");
  const cursor = readBrainstormCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor, null);
  assert.equal(readFileSync(path, "utf8"), "not-json");
});
