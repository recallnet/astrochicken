import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  BRAINSTORM_CURSOR_SCHEMA,
  BRAINSTORM_CONTEXT_CURSOR_SCHEMA,
  resolveBrainstormCursorPath,
  resolveBrainstormContextCursorPath,
  sha256Text,
  readBrainstormCursor,
  readBrainstormContextCursor,
  writeBrainstormCursor,
  writeBrainstormContextCursor,
} from "../../src/commands/brainstorm-cursor.ts";

describe("resolveBrainstormCursorPath", () => {
  it("defaults to .hatch/factories/default/brainstorm-cursor.json", () => {
    const p = resolveBrainstormCursorPath();
    assert.equal(p, join(".", ".hatch", "factories", "default", "brainstorm-cursor.json"));
  });

  it("uses provided factoryId", () => {
    const p = resolveBrainstormCursorPath({ factoryId: "acme" });
    assert.equal(p, join(".", ".hatch", "factories", "acme", "brainstorm-cursor.json"));
  });

  it("uses provided rootDir", () => {
    const p = resolveBrainstormCursorPath({ rootDir: "/tmp/myroot" });
    assert.equal(p, join("/tmp/myroot", ".hatch", "factories", "default", "brainstorm-cursor.json"));
  });

  it("combines rootDir and factoryId", () => {
    const p = resolveBrainstormCursorPath({ rootDir: "/r", factoryId: "x" });
    assert.equal(p, join("/r", ".hatch", "factories", "x", "brainstorm-cursor.json"));
  });

  it("falls back to default for empty factoryId", () => {
    const p = resolveBrainstormCursorPath({ factoryId: "" });
    assert.ok(p.includes("default"));
  });
});

describe("sha256Text", () => {
  it("returns a 64-char hex string", () => {
    const h = sha256Text("hello");
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    assert.equal(sha256Text("test"), sha256Text("test"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(sha256Text("a"), sha256Text("b"));
  });

  it("hashes empty string", () => {
    const h = sha256Text("");
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

describe("BRAINSTORM_CURSOR_SCHEMA", () => {
  it("equals brainstorm-cursor/v1", () => {
    assert.equal(BRAINSTORM_CURSOR_SCHEMA, "brainstorm-cursor/v1");
  });
});

describe("readBrainstormCursor", () => {
  let testDir;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "brainstorm-cursor-read-"));
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null when file is missing", () => {
    assert.equal(readBrainstormCursor({ rootDir: testDir, factoryId: "missing" }), null);
  });

  it("returns null for invalid JSON", () => {
    const p = resolveBrainstormCursorPath({ rootDir: testDir, factoryId: "badjson" });
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "not json at all", "utf8");
    assert.equal(readBrainstormCursor({ rootDir: testDir, factoryId: "badjson" }), null);
  });

  it("returns null for wrong schema", () => {
    const p = resolveBrainstormCursorPath({ rootDir: testDir, factoryId: "wrongschema" });
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ schema: "wrong/v0" }), "utf8");
    assert.equal(readBrainstormCursor({ rootDir: testDir, factoryId: "wrongschema" }), null);
  });

  it("reads a valid cursor file", () => {
    const fid = "valid";
    const p = resolveBrainstormCursorPath({ rootDir: testDir, factoryId: fid });
    mkdirSync(dirname(p), { recursive: true });
    const data = {
      schema: BRAINSTORM_CURSOR_SCHEMA,
      factory_id: fid,
      last_brainstorm_issue_number: "42",
      last_seed_prompt: "prompt",
      last_intent_stack_sha256: "abc",
      last_shipped_goals_sha256: "def",
      last_scenario_holdouts_sha256: "ghi",
      intent_stack_snapshot: "snap1",
      shipped_goals_snapshot: "snap2",
      scenario_holdouts_snapshot: "snap3",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(p, JSON.stringify(data), "utf8");

    const cursor = readBrainstormCursor({ rootDir: testDir, factoryId: fid });
    assert.notEqual(cursor, null);
    assert.equal(cursor.schema, BRAINSTORM_CURSOR_SCHEMA);
    assert.equal(cursor.factory_id, fid);
    assert.equal(cursor.last_brainstorm_issue_number, "42");
    assert.equal(cursor.last_seed_prompt, "prompt");
    assert.equal(cursor.intent_stack_snapshot, "snap1");
  });
});

describe("writeBrainstormCursor", () => {
  let testDir;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "brainstorm-cursor-write-"));
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates parent directories and writes valid JSON", () => {
    const result = writeBrainstormCursor({
      rootDir: testDir,
      factoryId: "newdir",
      cursor: { last_brainstorm_issue_number: "7" },
    });
    assert.equal(result.ok, true);
    assert.ok(result.cursor_path);
    assert.equal(result.cursor.schema, BRAINSTORM_CURSOR_SCHEMA);
    assert.equal(result.cursor.factory_id, "newdir");
    assert.equal(result.cursor.last_brainstorm_issue_number, "7");

    // Verify file on disk
    const raw = JSON.parse(readFileSync(result.cursor_path, "utf8"));
    assert.equal(raw.schema, BRAINSTORM_CURSOR_SCHEMA);
  });

  it("roundtrips: write then read yields same data", () => {
    const cursor = {
      last_brainstorm_issue_number: "99",
      last_seed_prompt: "test prompt",
      last_intent_stack_sha256: sha256Text("stack"),
      last_shipped_goals_sha256: sha256Text("goals"),
      last_scenario_holdouts_sha256: sha256Text("holdouts"),
      intent_stack_snapshot: "stack-snap",
      shipped_goals_snapshot: "goals-snap",
      scenario_holdouts_snapshot: "holdouts-snap",
    };

    const writeResult = writeBrainstormCursor({
      rootDir: testDir,
      factoryId: "roundtrip",
      cursor,
    });

    const readResult = readBrainstormCursor({
      rootDir: testDir,
      factoryId: "roundtrip",
    });

    assert.notEqual(readResult, null);
    assert.equal(readResult.last_brainstorm_issue_number, "99");
    assert.equal(readResult.last_seed_prompt, "test prompt");
    assert.equal(readResult.last_intent_stack_sha256, cursor.last_intent_stack_sha256);
    assert.equal(readResult.intent_stack_snapshot, "stack-snap");
    // updated_at should match what was written
    assert.equal(readResult.updated_at, writeResult.cursor.updated_at);
  });
});

describe("aliases", () => {
  it("resolveBrainstormContextCursorPath === resolveBrainstormCursorPath", () => {
    assert.equal(resolveBrainstormContextCursorPath, resolveBrainstormCursorPath);
  });

  it("readBrainstormContextCursor === readBrainstormCursor", () => {
    assert.equal(readBrainstormContextCursor, readBrainstormCursor);
  });

  it("writeBrainstormContextCursor === writeBrainstormCursor", () => {
    assert.equal(writeBrainstormContextCursor, writeBrainstormCursor);
  });

  it("BRAINSTORM_CONTEXT_CURSOR_SCHEMA === BRAINSTORM_CURSOR_SCHEMA", () => {
    assert.equal(BRAINSTORM_CONTEXT_CURSOR_SCHEMA, BRAINSTORM_CURSOR_SCHEMA);
  });
});
