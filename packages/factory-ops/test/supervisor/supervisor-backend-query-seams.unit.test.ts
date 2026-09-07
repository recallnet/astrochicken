import assert from "node:assert/strict";
import test from "node:test";

import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";
import { selectManagedIntakeIssue } from "../../src/commands/supervisor-managed-intake-selector.ts";
import { evaluateUpstreamBugGate } from "../../src/commands/supervisor-upstream-bug-gate.ts";
import { resolveSupervisorGhJsonFn } from "../../src/commands/supervisor-backend-query-seams.ts";

function makeAdapter({ repo = "example/repo", issueRows = [] } = {}) {
  const calls = [];
  return {
    adapter: {
      repo,
      issueList(args = {}) {
        calls.push(args);
        return issueRows;
      },
    },
    calls,
  };
}

test("selectManagedIntakeIssue uses backend adapter issueList seam instead of ghJson", () => {
  const { adapter, calls } = makeAdapter({
    issueRows: [
      { number: 12, title: "later", body: "", labels: [{ name: "brainstorm" }] },
      { number: 7, title: "earliest", body: "", labels: [{ name: "brainstorm" }] },
    ],
  });

  const out = selectManagedIntakeIssue({
    repo: "example/repo",
    labels: ["brainstorm"],
    backendAdapter: adapter,
    ghJsonFn: () => {
      throw new Error("ghJson must not be called when backend adapter is provided");
    },
  });

  assert.equal(out.has_issue, "true");
  assert.equal(out.selected_issue_number, "7");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    state: "open",
    labels: ["brainstorm"],
    limit: 200,
    fields: "number,title,body,url,labels",
    search: "",
  });
});

test("evaluateUpstreamBugGate uses backend adapter seam for issue listing", () => {
  const { adapter, calls } = makeAdapter({
    issueRows: [{ number: 42, title: "upstream", labels: [{ name: "managed-factory-bug" }] }],
  });

  const out = evaluateUpstreamBugGate({
    repo: "example/repo",
    labelFilters: ["managed-factory-bug"],
    backendAdapter: adapter,
    ghJsonFn: () => {
      throw new Error("ghJson must not be called when backend adapter is provided");
    },
  });

  assert.equal(out.has_open_upstream_bugs, "true");
  assert.deepEqual(out.open_upstream_bug_numbers, [42]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    state: "open",
    labels: ["managed-factory-bug"],
    limit: 200,
    fields: "number,title,labels,body",
    search: "",
  });
});

test("resolveSupervisorGhJsonFn routes issue list to backend adapter and falls back for other commands", () => {
  const { adapter, calls } = makeAdapter({
    issueRows: [{ number: 99, title: "from-adapter" }],
  });
  const fallbackCalls = [];
  const seam = resolveSupervisorGhJsonFn({
    backendAdapter: adapter,
    repo: "example/repo",
    ghJsonFn: (args, fallback = null) => {
      fallbackCalls.push(Array.isArray(args) ? args.join(" ") : String(args || ""));
      return fallback;
    },
  });

  const issueListPayload = seam([
    "issue", "list", "--repo", "example/repo", "--state", "open", "--limit", "200", "--label", "brainstorm", "--json", "number,title",
  ], []);
  assert.deepEqual(issueListPayload, [{ number: 99, title: "from-adapter" }]);
  assert.equal(calls.length, 1);

  seam(["issue", "view", "99", "--repo", "example/repo", "--json", "number"], {});
  assert.equal(fallbackCalls.length, 1);
  assert.match(fallbackCalls[0], /issue view 99/);
});

test("buildStateSnapshot reads issue lists through backend seam when adapter is provided", () => {
  const { adapter, calls } = makeAdapter({ issueRows: [] });

  const out = JSON.parse(buildStateSnapshot({
    repo: "example/repo",
    backendAdapter: adapter,
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("issue view") || cmd.includes("api graphql")) {
        return fallback;
      }
      throw new Error(`unexpected ghJson call for ${cmd}`);
    },
    listGoalSubIssuesFn: () => [],
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_000_000_000,
  }));

  assert.ok(Array.isArray(out.action_items));
  // Unified fetch: 1 call for all open issues (no label filter), filtered in-memory.
  assert.ok(calls.length >= 1, "expected at least 1 issueList-backed query (unified fetch)");
  assert.ok(calls.some((entry) => entry.state === "open" && entry.limit === 500),
    "expected unified open issue fetch with limit 500");
});
