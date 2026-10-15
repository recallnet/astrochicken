import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";


import test from "node:test";

test("goal apply-decisions via CLI returns stable empty result on malformed JSON", () => {
  const run = spawnOpsCli([
      "goal",
      "apply-decisions",
      "--repo",
      "recallnet/astrochicken",
      "--decisions",
      "{broken"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "{\"applied_count\":0,\"applied\":[]}");
});

test("goal filter-kept via CLI returns [] on malformed issues payload", () => {
  const run = spawnOpsCli([
      "goal",
      "filter-kept",
      "--issues",
      "{broken",
      "--decisions",
      "[]"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[]");
});

test("goal filter-kept via CLI preserves keep-only semantics for non-keep decisions", () => {
  const issues = JSON.stringify([
    { number: "101" },
    { number: "102" },
    { number: "103" },
    { number: "104" },
  ]);
  const decisions = JSON.stringify([
    { issue_number: 102, decision: "close" },
    { issue_number: "103", decision: "duplicate", canonical_issue: 101 },
    { issue_number: "104", decision: "reject" },
  ]);

  const run = spawnOpsCli([
      "goal",
      "filter-kept",
      "--issues",
      issues,
      "--decisions",
      decisions
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[101]");
});

test("goal apply-decisions via CLI accepts apostrophe payload via --decisions-b64", () => {
  const decisions = JSON.stringify([
    { issue_number: 101, decision: "keep", reason: "O'Hare duplicate triage note" },
  ]);
  const decisionsB64 = Buffer.from(decisions, "utf8").toString("base64");

  const run = spawnOpsCli([
      "goal",
      "apply-decisions",
      "--repo",
      "recallnet/astrochicken",
      "--decisions-b64",
      decisionsB64
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "{\"applied_count\":0,\"applied\":[]}");
});

test("goal apply-decisions via CLI accepts stdin payload transport with apostrophes/newlines", () => {
  const decisions = JSON.stringify([
    { issue_number: 101, decision: "keep", reason: "O'Hare duplicate triage note\nline two" },
  ]);

  const run = spawnOpsCli([
      "goal",
      "apply-decisions",
      "--repo",
      "recallnet/astrochicken"
    ], {
      input: decisions
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "{\"applied_count\":0,\"applied\":[]}");
});

test("goal apply-decisions empty-stdin fallback is deterministic", () => {
  const run = spawnOpsCli([
      "goal",
      "apply-decisions",
      "--repo",
      "recallnet/astrochicken"
    ], {
      input: ""
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "{\"applied_count\":0,\"applied\":[]}");
});

test("goal filter-kept via CLI accepts apostrophe payloads via --issues-b64/--decisions-b64", () => {
  const issues = JSON.stringify([
    { number: "101", title: "Fix O'Hare parser edge case" },
    { number: "102", title: "Secondary task" },
  ]);
  const decisions = JSON.stringify([
    { issue_number: "101", decision: "keep", reason: "Keep O'Hare item" },
    { issue_number: 102, decision: "close", reason: "Already done" },
  ]);

  const run = spawnOpsCli([
      "goal",
      "filter-kept",
      "--issues-b64",
      Buffer.from(issues, "utf8").toString("base64"),
      "--decisions-b64",
      Buffer.from(decisions, "utf8").toString("base64")
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[101]");
});

test("goal filter-kept via CLI accepts stdin issues payload transport", () => {
  const issues = JSON.stringify([
    { number: "101", title: "Fix O'Hare parser edge case\nline two" },
    { number: "102", title: "Secondary task" },
  ]);

  const run = spawnOpsCli([
      "goal",
      "filter-kept",
      "--decisions",
      JSON.stringify([{ issue_number: 102, decision: "close" }])
    ], {
      input: issues
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[101]");
});

test("goal apply-decisions rejects mixed raw and b64 payload transport", () => {
  const run = spawnOpsCli([
      "goal",
      "apply-decisions",
      "--repo",
      "recallnet/astrochicken",
      "--decisions",
      "[]",
      "--decisions-b64",
      Buffer.from("[]", "utf8").toString("base64")
    ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /decisions accepts one transport: --decisions or --decisions-b64/);
});

test("goal filter-kept rejects mixed raw and b64 issue payload transport", () => {
  const run = spawnOpsCli([
      "goal",
      "filter-kept",
      "--issues",
      "[]",
      "--issues-b64",
      Buffer.from("[]", "utf8").toString("base64"),
      "--decisions",
      "[]"
    ]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /issues accepts one transport: --issues or --issues-b64/);
});

test("goal validate-decisions rejects incomplete decision sets", () => {
  const run = spawnOpsCli([
      "goal",
      "validate-decisions",
      "--goal-issues",
      JSON.stringify([{ number: 1907 }, { number: 1908 }]),
      "--decisions",
      JSON.stringify({ decisions: [{ issue_number: 1907, decision: "keep" }] })
    ]);

  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /input goal #1908 is missing from decisions/);
});
