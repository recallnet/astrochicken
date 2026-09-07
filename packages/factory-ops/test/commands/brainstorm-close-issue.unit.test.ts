import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeBrainstormIssue } from "../../src/commands/brainstorm-close-issue.ts";
import { readBrainstormCursor } from "../../src/commands/brainstorm-cursor.ts";

test("closeBrainstormIssue posts completion comment and closes source issue", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-close-"));
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "1",
    factoryId: "brainstorm",
    rootDir: root,
    nextCursorRaw: JSON.stringify({
      schema: "brainstorm-cursor/v1",
      last_brainstorm_issue_number: "1",
      last_seed_prompt: "seed",
      last_intent_stack_sha256: "a",
      last_shipped_goals_sha256: "b",
      last_scenario_holdouts_sha256: "c",
      intent_stack_snapshot: "{}",
      shipped_goals_snapshot: "[]",
      scenario_holdouts_snapshot: "[]",
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.closed, "true");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ["issue", "comment"]);
  assert.deepEqual(calls[1].slice(0, 2), ["issue", "close"]);
  for (const call of calls) {
    const repoIndex = call.indexOf("--repo");
    assert.equal(call[repoIndex + 1], "example-org/example-notes");
  }
  assert.equal(calls[1].includes("--reason"), true);
  assert.equal(calls[1].includes("completed"), true);
  // Comment should say "Brainstorm complete" without goal backlink
  const commentBody = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(commentBody, /Brainstorm complete/);
  assert.doesNotMatch(commentBody, /goal issue/i);
  assert.equal(out.cursor_path.endsWith("/brainstorm-cursor.json"), true);
  assert.equal(existsSync(out.cursor_path), true);

  const cursor = readBrainstormCursor({ factoryId: "brainstorm", rootDir: root });
  assert.equal(cursor.last_brainstorm_issue_number, "1");
  assert.equal(cursor.last_seed_prompt, "seed");
});

test("closeBrainstormIssue fails closed on missing required inputs", () => {
  assert.throws(() => closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "",
  }), /missing_brainstorm_issue_number/);
});

test("closeBrainstormIssue surfaces comment failures", () => {
  assert.throws(() => closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "1",
    ghExec: () => ({ ok: false, stderr: "comment denied", stdout: "" }),
  }), /comment_failed:comment denied/);
});

test("closeBrainstormIssue surfaces close failures", () => {
  let call = 0;
  assert.throws(() => closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "1",
    ghExec: () => {
      call += 1;
      if (call === 1) return { ok: true, stderr: "", stdout: "" };
      return { ok: false, stderr: "close denied", stdout: "" };
    },
  }), /close_failed:close denied/);
});

test("closeBrainstormIssue does not persist cursor when close fails", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-close-"));
  let call = 0;

  assert.throws(() => closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "1",
    factoryId: "brainstorm",
    rootDir: root,
    nextCursorRaw: JSON.stringify({
      schema: "brainstorm-cursor/v1",
      last_brainstorm_issue_number: "1",
      last_seed_prompt: "seed",
      last_intent_stack_sha256: "a",
      last_shipped_goals_sha256: "b",
      last_scenario_holdouts_sha256: "c",
      intent_stack_snapshot: "{}",
      shipped_goals_snapshot: "[]",
      scenario_holdouts_snapshot: "[]",
    }),
    ghExec: () => {
      call += 1;
      if (call === 1) return { ok: true, stderr: "", stdout: "" };
      return { ok: false, stderr: "close denied", stdout: "" };
    },
  }), /close_failed:close denied/);

  assert.equal(readBrainstormCursor({ factoryId: "brainstorm", rootDir: root }), null);
});

test("closeBrainstormIssue ignores malformed next_cursor payload and does not write cursor", () => {
  const root = mkdtempSync(join(tmpdir(), "brainstorm-close-"));
  const out = closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "1",
    factoryId: "brainstorm",
    rootDir: root,
    nextCursorRaw: "not-json",
    ghExec: () => ({ ok: true, status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(out.cursor_path, "");
  assert.equal(readBrainstormCursor({ factoryId: "brainstorm", rootDir: root }), null);
});
