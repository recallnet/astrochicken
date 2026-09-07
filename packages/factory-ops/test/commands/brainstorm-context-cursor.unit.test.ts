import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BRAINSTORM_CURSOR_SCHEMA,
  BRAINSTORM_CONTEXT_CURSOR_SCHEMA,
  resolveBrainstormCursorPath,
  resolveBrainstormContextCursorPath,
  sha256Text,
  writeBrainstormContextCursor,
  readBrainstormContextCursor,
} from "../../src/commands/brainstorm-cursor.ts";

test("resolveBrainstormContextCursorPath returns deterministic factory path", () => {
  const path = resolveBrainstormContextCursorPath({ factoryId: "mothership", rootDir: "/tmp/root" });
  assert.equal(path, "/tmp/root/.hatch/factories/mothership/brainstorm-cursor.json");
});

test("resolveBrainstormCursorPath is exported and deterministic", () => {
  const path = resolveBrainstormCursorPath({ factoryId: "mothership", rootDir: "/tmp/root" });
  assert.equal(path, "/tmp/root/.hatch/factories/mothership/brainstorm-cursor.json");
});

test("BRAINSTORM_CURSOR_SCHEMA aliases context schema", () => {
  assert.equal(BRAINSTORM_CURSOR_SCHEMA, "brainstorm-cursor/v1");
  assert.equal(BRAINSTORM_CONTEXT_CURSOR_SCHEMA, BRAINSTORM_CURSOR_SCHEMA);
});

test("sha256Text is deterministic and non-empty", () => {
  const digestA = sha256Text("intent snapshot");
  const digestB = sha256Text("intent snapshot");
  const digestC = sha256Text("different");
  assert.equal(digestA, digestB);
  assert.notEqual(digestA, digestC);
  assert.equal(digestA.length, 64);
});

test("writeBrainstormContextCursor persists schema payload atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-cursor-"));
  const result = writeBrainstormContextCursor({
    factoryId: "mothership",
    rootDir: root,
    cursor: {
      last_brainstorm_issue_number: "2019",
      last_seed_prompt: "highest ROI goal given current state",
      last_intent_stack_sha256: sha256Text("intent"),
      last_shipped_goals_sha256: sha256Text("shipped"),
      last_scenario_holdouts_sha256: sha256Text("holdouts"),
      intent_stack_snapshot: "{\"intent\":true}",
      shipped_goals_snapshot: "[]",
      scenario_holdouts_snapshot: "[]",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.cursor.schema, BRAINSTORM_CONTEXT_CURSOR_SCHEMA);
  assert.equal(existsSync(result.cursor_path), true);
  assert.equal(existsSync(`${result.cursor_path}.tmp`), false);

  const onDisk = JSON.parse(readFileSync(result.cursor_path, "utf8"));
  assert.equal(onDisk.schema, BRAINSTORM_CONTEXT_CURSOR_SCHEMA);
  assert.equal(onDisk.factory_id, "mothership");
  assert.equal(onDisk.last_brainstorm_issue_number, "2019");
});

test("readBrainstormContextCursor round-trips written payload", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-cursor-"));
  writeBrainstormContextCursor({
    factoryId: "mothership",
    rootDir: root,
    cursor: {
      last_brainstorm_issue_number: "2020",
      last_seed_prompt: "seed",
      last_intent_stack_sha256: sha256Text("intent"),
      last_shipped_goals_sha256: sha256Text("shipped"),
      last_scenario_holdouts_sha256: sha256Text("holdouts"),
      intent_stack_snapshot: "{\"intent\":true}",
      shipped_goals_snapshot: "[]",
      scenario_holdouts_snapshot: "[]",
    },
  });

  const cursor = readBrainstormContextCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor.schema, BRAINSTORM_CONTEXT_CURSOR_SCHEMA);
  assert.equal(cursor.last_brainstorm_issue_number, "2020");
  assert.equal(cursor.last_seed_prompt, "seed");
});
