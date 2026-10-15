import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTestAdapter } from "../../github-adapter/src/test-adapter.ts";
import { filterReadyIssues } from "../src/commands/wave-filter-ready-issues.ts";

export function registerWaveFilterReadyIssuesCases({ variant = "unit" } = {}) {
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("filterReadyIssues returns [] for malformed milestone issue JSON", () => {
  const out = filterReadyIssues({ milestoneIssuesRaw: "{broken" });
  assert.deepEqual(out, []);
});

test("filterReadyIssues handles mixed blocker states deterministically", () => {
  const issues = [
    { number: 101, title: "closed blockers only", labels: [] },
    { number: 102, title: "mixed open/closed", labels: [] },
    { number: 103, title: "missing blocker state", labels: [] },
    { number: 104, title: "all clear", labels: [] },
  ];

  const blockedBy = new Map([
    [101, { ok: true, nodes: [{ number: 1, state: "CLOSED" }] }],
    [102, { ok: true, nodes: [{ number: 2, state: "OPEN" }, { number: 3, state: "CLOSED" }] }],
    [103, { ok: true, nodes: [{ number: 4 }] }],
    [104, { ok: true, nodes: [] }],
  ]);

  const out = filterReadyIssues({
    milestoneIssuesRaw: JSON.stringify(issues),
    repo: "",
    queryBlockedBy: ({ issueNumber }) => blockedBy.get(Number(issueNumber)) || { ok: true, nodes: [] },
  });

  assert.deepEqual(out, [
    { issue_number: 101, issue_title: "closed blockers only" },
    { issue_number: 104, issue_title: "all clear" },
  ]);
});

test("filterReadyIssues excludes awaiting-human and tolerates nullable/missing labels", () => {
  const issues = [
    { number: 201, title: "awaiting human", labels: [{ name: "awaiting-human" }] },
    { number: 202, title: "labels null", labels: null },
    { number: 203, title: "labels missing" },
    { number: 204, title: "label object without name", labels: [{}] },
  ];

  const out = filterReadyIssues({
    milestoneIssuesRaw: JSON.stringify(issues),
    repo: "",
    queryBlockedBy: () => ({ ok: true, nodes: [] }),
  });

  assert.deepEqual(out, [
    { issue_number: 202, issue_title: "labels null" },
    { issue_number: 203, issue_title: "labels missing" },
    { issue_number: 204, issue_title: "label object without name" },
  ]);
});

test("filterReadyIssues falls back to include item when GraphQL query fails", () => {
  const out = filterReadyIssues({
    milestoneIssuesRaw: JSON.stringify([{ number: 301, title: "graphql fallback", labels: [] }]),
    repo: "",
    queryBlockedBy: () => ({ ok: false, nodes: [] }),
  });

  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]), ["issue_number", "issue_title"]);
  assert.equal(JSON.stringify(out), '[{"issue_number":301,"issue_title":"graphql fallback"}]');
});

if (variant === "unit") {
test("filterReadyIssues uses adapter blockedBy seam when provided", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: ({ number }) => (Number(number) === 501 ? [{ number: 1, state: "OPEN" }] : []),
    },
  });

  const out = filterReadyIssues({
    milestoneIssuesRaw: JSON.stringify([
      { number: 501, title: "blocked", labels: [] },
      { number: 502, title: "ready", labels: [] },
    ]),
    adapter,
    queryBlockedBy: () => {
      throw new Error("queryBlockedBy must not be called when adapter is provided");
    },
  });

  assert.deepEqual(out, [{ issue_number: 502, issue_title: "ready" }]);
  assert.equal(adapter.callsTo("issueBlockedBy").length, 2);
});

}

test("wave filter-ready-issues CLI accepts --milestone-issues-b64 payload transport", () => {
  const payload = JSON.stringify([
    { number: 401, title: "Owner's wave task", labels: [] },
  ]);

  const run = spawnSync("node", [
    opsCliPath,
    "wave",
    "filter-ready-issues",
    "--repo",
    "",
    "--milestone-issues-b64",
    Buffer.from(payload, "utf8").toString("base64"),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.deepEqual(out, [{ issue_number: 401, issue_title: "Owner's wave task" }]);
});

test("wave filter-ready-issues CLI accepts stdin payload transport with apostrophes/newlines", () => {
  const payload = JSON.stringify([
    { number: 402, title: "Owner's wave task\nLine two", labels: [] },
  ]);

  const run = spawnSync("node", [
    opsCliPath,
    "wave",
    "filter-ready-issues",
    "--repo",
    "",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: payload,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.deepEqual(out, [{ issue_number: 402, issue_title: "Owner's wave task\nLine two" }]);
});

test("wave filter-ready-issues CLI empty-stdin fallback is deterministic", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "wave",
    "filter-ready-issues",
    "--repo",
    "",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[]");
});

}
