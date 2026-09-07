import assert from "node:assert/strict";
import test from "node:test";

import { evaluateUpstreamBugGate } from "../../src/commands/supervisor-upstream-bug-gate.ts";


test("evaluateUpstreamBugGate reports open upstream bugs deterministically", () => {
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({
      payload: [
        { number: 301, title: "[bug] infra crash" },
        { number: 302, title: "[bug] ops regression" },
      ],
      parse_error: "",
    }),
  });

  assert.equal(gate.has_open_upstream_bugs, "true");
  assert.equal(gate.open_upstream_bug_count, 2);
  assert.deepEqual(gate.open_upstream_bug_numbers, [301, 302]);
  assert.equal(gate.parse_error, "");
});

test("evaluateUpstreamBugGate reports clear gate when no bugs remain", () => {
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({ payload: [], parse_error: "" }),
  });

  assert.equal(gate.has_open_upstream_bugs, "false");
  assert.equal(gate.open_upstream_bug_count, 0);
  assert.deepEqual(gate.open_upstream_bug_numbers, []);
  assert.equal(gate.parse_error, "");
});

test("evaluateUpstreamBugGate fails safe on malformed payload", () => {
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({ payload: { malformed: true }, parse_error: "" }),
  });

  assert.equal(gate.has_open_upstream_bugs, "false");
  assert.equal(gate.open_upstream_bug_count, 0);
  assert.deepEqual(gate.open_upstream_bug_numbers, []);
  assert.match(String(gate.parse_error || ""), /malformed_payload/);
});

test("evaluateUpstreamBugGate keeps needs-triage incidents non-blocking", () => {
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({
      payload: [
        {
          number: 401,
          title: "[bug] ambiguous incident",
          labels: [{ name: "managed-factory-bug" }, { name: "factory:example-trading" }, { name: "needs-triage" }],
        },
      ],
      parse_error: "",
    }),
  });

  assert.equal(gate.has_open_upstream_bugs, "false");
  assert.equal(gate.open_upstream_bug_count, 0);
  assert.deepEqual(gate.open_upstream_bug_numbers, []);
  assert.equal(gate.parse_error, "");
});

test("evaluateUpstreamBugGate defaults label filters when CLI passes empty list", () => {
  const calls = [];
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    labelFilters: [],
    ghIssueListFn: ({ labels = [] }) => {
      calls.push(labels);
      return {
        payload: [{ number: 501, title: "[bug] infra incident" }],
        parse_error: "",
      };
    },
  });

  assert.equal(gate.has_open_upstream_bugs, "true");
  assert.equal(gate.open_upstream_bug_count, 1);
  assert.deepEqual(gate.open_upstream_bug_numbers, [501]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["managed-factory-bug", "factory:example-trading"]);
});

test("evaluateUpstreamBugGate keeps parse failures non-blocking", () => {
  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({
      payload: null,
      parse_error: "gh_issue_list_failed:status=1:network",
    }),
  });

  assert.equal(gate.has_open_upstream_bugs, "false");
  assert.equal(gate.open_upstream_bug_count, 0);
  assert.deepEqual(gate.open_upstream_bug_numbers, []);
  assert.match(String(gate.parse_error || ""), /gh_issue_list_failed/);
});
