import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalFsAdapter } from "../src/local-fs-adapter.ts";
import { appendLineAtomicSync, resolveRepoStore, writeJsonAtomicSync } from "../src/fs-utils.ts";

function validMutationContext(overrides = {}) {
  return {
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_test_01",
    run_id: "run_01",
    tick_id: "tick_01",
    destination_name: "goal_issues",
    capability_version: "capability.v1",
    policy_profile: "policy_pack:v1",
    runtime_version: "1.2.3",
    ...overrides,
  };
}

function withTempStore(run) {
  const storeRoot = mkdtempSync(path.join(tmpdir(), "local-fs-adapter-test-"));
  try {
    return run(storeRoot);
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

test("local_fs adapter creates, lists, edits, comments, closes, and labels issues", () => {
  withTempStore((storeRoot) => {
    const adapter = createLocalFsAdapter({
      repo: "Owner/Repo",
      storeRoot,
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T00:00:00.000Z",
    });

    const created = adapter.issueCreate({
      title: "First issue",
      body: "Details",
      labels: ["bug", "bug", "triage"],
    });
    assert.equal(created.ok, true);
    assert.equal(created.number, 1);

    assert.deepEqual(
      adapter.issueList({ fields: "number,title,state" }),
      [{ number: 1, title: "First issue", state: "open" }],
    );

    const viewed = adapter.issueView({ number: 1, fields: "number,title,labels,comments" });
    assert.deepEqual(viewed.labels, [{ name: "bug" }, { name: "triage" }]);
    assert.deepEqual(viewed.comments, []);

    assert.deepEqual(adapter.issueComment({ number: 1, body: "hello" }), { ok: true });

    assert.deepEqual(
      adapter.issueEdit({ number: 1, addLabels: ["ready", "ready"], removeLabels: ["bug"], milestone: "v1" }),
      { ok: true },
    );

    const edited = adapter.issueView({ number: 1, fields: "number,labels,milestone,comments" });
    assert.deepEqual(edited.labels, [{ name: "triage" }, { name: "ready" }]);
    assert.equal(edited.milestone, "v1");
    assert.deepEqual(edited.comments, [{ body: "hello", created_at: "" }]);

    assert.deepEqual(adapter.issueClose({ number: 1 }), { ok: true });
    assert.deepEqual(adapter.issueList({ state: "all", fields: "number,state" }), [{ number: 1, state: "closed" }]);

    assert.deepEqual(adapter.labelCreate({ name: "triaged", description: "done", color: "00ff00" }), { ok: true });

    assert.deepEqual(adapter.listSubIssues({ number: 1 }), []);
    assert.deepEqual(adapter.addSubIssue({ parentNumber: 1, childNumber: 1 }), {
      ok: true,
      parent: "1",
      child: "1",
      error: "",
    });

    const repoDir = resolveRepoStore(storeRoot, "owner/repo");
    const labelsJson = JSON.parse(readFileSync(path.join(repoDir, "labels.json"), "utf8"));
    assert.deepEqual(labelsJson, [{ name: "triaged", description: "done", color: "00ff00" }]);
    const subIssuesJson = JSON.parse(readFileSync(path.join(repoDir, "subissues", "1.json"), "utf8"));
    assert.equal(subIssuesJson.length, 1);
    assert.equal(subIssuesJson[0].number, 1);
  });
});

test("local_fs adapter uses sequential IDs and repo isolation under shared store root", () => {
  withTempStore((storeRoot) => {
    const one = createLocalFsAdapter({
      repo: "org/one",
      storeRoot,
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T00:00:01.000Z",
    });
    const two = createLocalFsAdapter({
      repo: "org/two",
      storeRoot,
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T00:00:02.000Z",
    });

    assert.equal(one.issueCreate({ title: "one-a" }).number, 1);
    assert.equal(one.issueCreate({ title: "one-b" }).number, 2);
    assert.equal(two.issueCreate({ title: "two-a" }).number, 1);

    assert.deepEqual(one.issueList({ state: "all", fields: "number,title" }), [
      { number: 1, title: "one-a" },
      { number: 2, title: "one-b" },
    ]);
    assert.deepEqual(two.issueList({ state: "all", fields: "number,title" }), [
      { number: 1, title: "two-a" },
    ]);

    const rootEntries = new Set(readdirSync(storeRoot));
    assert.equal(rootEntries.has("org~one"), true);
    assert.equal(rootEntries.has("org~two"), true);
  });
});

test("local_fs adapter writes audit records using GitHub audit schema", () => {
  withTempStore((storeRoot) => {
    const adapter = createLocalFsAdapter({
      repo: "o/r",
      storeRoot,
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T01:00:00.000Z",
    });

    adapter.issueCreate({ title: "audit" });
    adapter.issueComment({ number: 1, body: "c" });
    adapter.issueEdit({ number: 1, addLabels: ["bug"] });
    adapter.issueClose({ number: 1 });

    const repoDir = resolveRepoStore(storeRoot, "o/r");
    const lines = readFileSync(path.join(repoDir, "audit.log"), "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map((entry) => entry.action), [
      "issue_create",
      "comment_create",
      "issue_label",
      "issue_close",
    ]);

    for (const record of lines) {
      assert.equal(record.schema, "audit.v1");
      assert.equal(record.target_repo, "o/r");
      assert.equal(record.destination_name, "goal_issues");
      assert.equal(record.timestamp, "2026-03-19T01:00:00.000Z");
    }
  });
});

test("writeJsonAtomicSync cleans up temp files when rename fails", () => {
  withTempStore((storeRoot) => {
    const targetPath = path.join(storeRoot, "atomic.json");

    assert.throws(
      () => writeJsonAtomicSync(targetPath, { ok: true }, {
        renameSyncFn: () => {
          throw new Error("rename failed");
        },
      }),
      /rename failed/,
    );

    const leftovers = readdirSync(storeRoot).filter((entry) => entry.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

test("appendLineAtomicSync cleans up temp files when rename fails", () => {
  withTempStore((storeRoot) => {
    const targetPath = path.join(storeRoot, "audit.log");
    writeFileSync(targetPath, "{}\n", "utf8");

    assert.throws(
      () => appendLineAtomicSync(targetPath, JSON.stringify({ ok: true }), {
        renameSyncFn: () => {
          throw new Error("rename failed");
        },
      }),
      /rename failed/,
    );

    const leftovers = readdirSync(storeRoot).filter((entry) => entry.includes(".tmp"));
    assert.deepEqual(leftovers, []);
    assert.equal(readFileSync(targetPath, "utf8"), "{}\n");
  });
});
