import assert from "node:assert/strict";
import test from "node:test";

import { buildStateSnapshot, evaluateOpenBugGate } from "../../src/commands/supervisor-state-snapshot.ts";
import {
  fetchBugBlockedBy,
  fetchBugBlockedByBatch,
  filterBlockingOpenBugs,
  filterSnapshotVisibleOpenBugs,
  isBlockedByOpenRelationships,
} from "../../src/commands/supervisor-open-bug-gate.ts";

function makeUnifiedStub(issues) {
  return (args, fallback = []) => {
    const cmd = Array.isArray(args) ? args.join(" ") : "";
    if (cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")) {
      return issues;
    }
    if (cmd.includes("api graphql")) {
      const queryArg = args.find((a) => String(a).startsWith("query=")) || "";
      const query = String(queryArg);
      const matches = [...query.matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
      const repository = {};
      for (const m of matches) {
        const n = Number(m[2]);
        if (query.includes("blockedBy(")) {
          repository[`i${n}`] = { blockedBy: { nodes: [] } };
        } else {
          repository[`i${n}`] = { state: "OPEN" };
        }
      }
      return { data: { repository } };
    }
    return fallback;
  };
}

function makeOpenBugStub() {
  return makeUnifiedStub([
    {
      number: 1287,
      title: "[bug] fast-route telemetry missing in supervisor run state",
      createdAt: "2026-03-07T19:00:00Z",
      body: "Regression report",
      labels: [{ name: "bug" }, { name: "managed-factory-bug" }, { name: "factory:example-trading" }],
    },
  ]);
}

function makeRepoAwareStub(repo, calls) {
  return (args, fallback = []) => {
    const cmd = Array.isArray(args) ? args.join(" ") : "";
    calls.push(cmd);
    if (cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")) {
      return [
        {
          number: 1346,
          title: "[bug] open-bug fast-route ordering regression",
          createdAt: "2026-03-08T00:00:00Z",
          body: "Detected in supervisor tick",
          labels: [{ name: "bug" }, { name: "managed-factory-bug" }, { name: "factory:example-trading" }],
        },
      ];
    }
    if (cmd.includes("api graphql")) {
      const queryArg = args.find((a) => String(a).startsWith("query=")) || "";
      const query = String(queryArg);
      const matches = [...query.matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
      const repository = {};
      for (const m of matches) {
        const n = Number(m[2]);
        if (query.includes("blockedBy(")) {
          repository[`i${n}`] = { blockedBy: { nodes: [] } };
        } else {
          repository[`i${n}`] = { state: "OPEN" };
        }
      }
      return { data: { repository } };
    }
    return fallback;
  };
}

test("buildStateSnapshot + evaluateOpenBugGate reports open bugs deterministically", () => {
  const snapshot = buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeOpenBugStub(),
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  assert.equal(Array.isArray(parsed.open_bugs), true);
  assert.equal(parsed.open_bugs.length, 1);
  assert.equal(parsed.open_bugs[0].number, 1287);

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [1287]);
  assert.equal(gate.parse_error, "");
});

test("open-bug gate honors repo-scoped snapshot path used by CLI", () => {
  const calls = [];
  const repo = "recallnet/astrochicken";
  const snapshot = buildStateSnapshot({
    repo,
    ghJsonFn: makeRepoAwareStub(repo, calls),
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [1346]);
  assert.equal(gate.parse_error, "");

  assert.ok(
    calls.some((cmd) => cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")),
    "expected state snapshot to make unified issue fetch for the target repo",
  );
});

test("evaluateOpenBugGate fails safe on malformed JSON input", () => {
  const malformedSnapshot = "{\"open_bugs\": [";
  const gate = evaluateOpenBugGate({ snapshot: malformedSnapshot });
  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_upstream_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
  assert.ok(String(gate.parse_error || "").length > 0);
});

test("evaluateOpenBugGate fails safe on missing_repo snapshot payload", () => {
  const snapshot = buildStateSnapshot({ repo: "", factoryRoot: "/tmp/does-not-exist-factory-root" });
  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_upstream_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
  assert.ok(String(gate.parse_error || "").length > 0);
});

test("buildStateSnapshot/evaluateOpenBugGate fail safe on malformed GH payloads", () => {
  const snapshot = buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: () => ({ flake: true }),
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  assert.ok(Array.isArray(parsed.snapshot_errors));
  assert.ok(parsed.snapshot_errors.length > 0);

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_upstream_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
  assert.ok(String(gate.parse_error || "").length > 0);
  assert.match(String(gate.parse_error || ""), /malformed_payload|unified_issue_fetch/);
});

test("buildStateSnapshot reports missing_repo payload for empty repo", () => {
  const snapshot = buildStateSnapshot({ repo: "", factoryRoot: "/tmp/does-not-exist-factory-root" });
  const parsed = JSON.parse(snapshot);
  assert.deepEqual(parsed, { error: "missing_repo" });
});

test("evaluateOpenBugGate repo path prefers target repo over control-plane repo and sorts issue numbers", () => {
  const calls = [];
  const gate = evaluateOpenBugGate({
    repo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    labelFilters: ["managed-factory-bug", "factory:example-trading"],
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      if (cmd.includes("issue list --repo example-org/example-trading")) {
        return [
          { number: 42, title: "[bug] infra mismatch" },
          { number: 7, title: "[bug] runner crash" },
        ];
      }
      return fallback;
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 2);
  assert.deepEqual(gate.issue_numbers, [7, 42]);
  assert.equal(gate.parse_error, "");
  assert.ok(calls.some((cmd) => cmd.includes("issue list --repo example-org/example-trading")));
  assert.ok(!calls.some((cmd) => cmd.includes("issue list --repo recallnet/astrochicken")));
  assert.ok(calls.some((cmd) => cmd.includes("--label managed-factory-bug")));
  assert.ok(calls.some((cmd) => cmd.includes("--label factory:example-trading")));
});

test("evaluateOpenBugGate live query ignores CI failure bugs whose referenced run is still in progress", () => {
  const gate = evaluateOpenBugGate({
    repo: "example-org/example-trading",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("issue list --repo example-org/example-trading")) {
        return [
          {
            number: 1848,
            title: "CI: failures on main @ 9accd0f927fd",
            body: [
              "## CI failure",
              "",
              "**Run:** https://github.com/example-org/example-trading/actions/runs/23807270463",
              "",
              "### Logs",
              "```",
              "job 69384128871 is still in progress; logs will be available when it is complete",
              "Logs unavailable",
              "```",
            ].join("\n"),
            labels: [{ name: "bug" }],
          },
          {
            number: 1850,
            title: "CI: failures on main @ a8c56068fd7f",
            body: [
              "## CI failure",
              "",
              "**Run:** https://github.com/example-org/example-trading/actions/runs/23808829874",
              "",
              "### Logs",
              "```",
              "Logs unavailable",
              "```",
            ].join("\n"),
            labels: [{ name: "bug" }],
          },
        ];
      }
      if (cmd.includes("run view 23807270463 --repo example-org/example-trading")) {
        return { status: "in_progress", conclusion: "" };
      }
      if (cmd.includes("run view 23808829874 --repo example-org/example-trading")) {
        return { status: "completed", conclusion: "failure" };
      }
      if (cmd.includes("api graphql")) {
        return {
          data: {
            repository: {
              i1848: { blockedBy: { nodes: [] } },
              i1850: { blockedBy: { nodes: [] } },
            },
          },
        };
      }
      return fallback;
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [1850]);
});

test("filterSnapshotVisibleOpenBugs hides in-progress CI incidents but keeps completed failures visible", () => {
  const bugs = filterSnapshotVisibleOpenBugs([
    {
      number: 1848,
      title: "CI: failures on main @ 9accd0f927fd",
      body: "**Run:** https://github.com/example-org/example-trading/actions/runs/23807270463",
      blocked_by: [],
    },
    {
      number: 1850,
      title: "CI: failures on main @ a8c56068fd7f",
      body: "**Run:** https://github.com/example-org/example-trading/actions/runs/23808829874",
      blocked_by: [],
    },
    {
      number: 1852,
      title: "[bug] local regression",
      body: "No workflow run attached",
      blocked_by: [],
    },
  ], {
    repo: "example-org/example-trading",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("run view 23807270463 --repo example-org/example-trading")) {
        return { status: "in_progress", conclusion: "" };
      }
      if (cmd.includes("run view 23808829874 --repo example-org/example-trading")) {
        return { status: "completed", conclusion: "failure" };
      }
      return fallback;
    },
  });

  assert.deepEqual(bugs.map((bug) => bug.number), [1850, 1852]);
});

test("filterBlockingOpenBugs excludes blocked and wave-managed bugs after CI reconciliation", () => {
  const bugs = filterBlockingOpenBugs([
    {
      number: 1848,
      title: "CI: failures on main @ 9accd0f927fd",
      body: "**Run:** https://github.com/example-org/example-trading/actions/runs/23807270463",
      blocked_by: [],
      labels: [{ name: "bug" }],
    },
    {
      number: 1850,
      title: "CI: failures on main @ a8c56068fd7f",
      body: "**Run:** https://github.com/example-org/example-trading/actions/runs/23808829874",
      blocked_by: [{ number: 9001, state: "OPEN" }],
      labels: [{ name: "bug" }],
    },
    {
      number: 1852,
      title: "[bug] managed wave issue",
      body: "Wave-managed incident",
      milestone: "goal-1782-wave-1",
      blocked_by: [],
      labels: [{ name: "bug" }],
    },
    {
      number: 1854,
      title: "[bug] persistent regression",
      body: "No workflow run attached",
      blocked_by: [],
      labels: [{ name: "bug" }],
    },
  ], {
    repo: "example-org/example-trading",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("run view 23807270463 --repo example-org/example-trading")) {
        return { status: "in_progress", conclusion: "" };
      }
      if (cmd.includes("run view 23808829874 --repo example-org/example-trading")) {
        return { status: "completed", conclusion: "failure" };
      }
      return fallback;
    },
  });

  assert.deepEqual(bugs.map((bug) => bug.number), [1854]);
});

test("evaluateOpenBugGate emits open_upstream_bugs alias for managed-factory gating", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [{ number: 912, title: "[bug] managed infra drift" }],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, gate.has_open_bugs);
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [912]);
});

test("buildStateSnapshot excludes CI failure bugs whose referenced run is still in progress", () => {
  const snapshot = buildStateSnapshot({
    repo: "example-org/example-trading",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("issue list --repo example-org/example-trading") && cmd.includes("--state open")) {
        return [
          {
            number: 1848,
            title: "CI: failures on main @ 9accd0f927fd",
            body: [
              "## CI failure",
              "",
              "**Run:** https://github.com/example-org/example-trading/actions/runs/23807270463",
              "",
              "### Logs",
              "```",
              "job 69384128871 is still in progress; logs will be available when it is complete",
              "Logs unavailable",
              "```",
            ].join("\n"),
            labels: [{ name: "bug" }],
            createdAt: "2026-03-31T16:22:59Z",
          },
          {
            number: 1850,
            title: "CI: failures on main @ a8c56068fd7f",
            body: [
              "## CI failure",
              "",
              "**Run:** https://github.com/example-org/example-trading/actions/runs/23808829874",
            ].join("\n"),
            labels: [{ name: "bug" }],
            createdAt: "2026-03-31T16:45:01Z",
          },
        ];
      }
      if (cmd.includes("run view 23807270463 --repo example-org/example-trading")) {
        return { status: "in_progress", conclusion: "" };
      }
      if (cmd.includes("run view 23808829874 --repo example-org/example-trading")) {
        return { status: "completed", conclusion: "failure" };
      }
      if (cmd.includes("api graphql")) {
        return {
          data: {
            repository: {
              i1848: { blockedBy: { nodes: [] } },
              i1850: { blockedBy: { nodes: [] } },
            },
          },
        };
      }
      return fallback ?? [];
    },
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  assert.deepEqual(parsed.open_bugs.map((bug) => bug.number), [1850]);
});

test("evaluateOpenBugGate snapshot override honors labelFilters against labeled bugs", () => {
  const gate = evaluateOpenBugGate({
    labelFilters: ["managed-factory-bug", "factory:example-trading"],
    snapshotOverride: {
      open_bugs: [
        { number: 21, title: "[bug] wrong labels", labels: [{ name: "bug" }, { name: "managed-factory-bug" }] },
        { number: 22, title: "[bug] matching labels", labels: [{ name: "bug" }, { name: "managed-factory-bug" }, { name: "factory:example-trading" }] },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [22]);
  assert.equal(gate.parse_error, "");
});

test("evaluateOpenBugGate excludes needs-triage classification from blocking count", () => {
  const gate = evaluateOpenBugGate({
    labelFilters: ["managed-factory-bug", "factory:example-trading"],
    snapshotOverride: {
      open_bugs: [
        {
          number: 301,
          title: "[bug] ambiguous managed incident",
          labels: [{ name: "managed-factory-bug" }, { name: "factory:example-trading" }],
          body: "```json\n{\"classification\":\"needs-triage\"}\n```",
        },
        {
          number: 302,
          title: "[bug] real infra incident",
          labels: [{ name: "managed-factory-bug" }, { name: "factory:example-trading" }],
          body: "```json\n{\"classification\":\"factory_design_defect\"}\n```",
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [302]);
  assert.equal(gate.parse_error, "");
});

test("evaluateOpenBugGate excludes needs-triage label from blocking count", () => {
  const gate = evaluateOpenBugGate({
    labelFilters: ["managed-factory-bug", "factory:example-trading"],
    snapshotOverride: {
      open_bugs: [
        {
          number: 401,
          title: "[bug] ambiguous managed incident",
          labels: [{ name: "managed-factory-bug" }, { name: "factory:example-trading" }, { name: "needs-triage" }],
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_upstream_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
  assert.equal(gate.parse_error, "");
});

test("blocked bug helpers detect open relationships and query GitHub blocker metadata", () => {
  assert.equal(isBlockedByOpenRelationships([{ number: 11, state: "OPEN" }]), true);
  assert.equal(isBlockedByOpenRelationships([{ number: 12, state: "CLOSED" }]), false);
  assert.deepEqual(fetchBugBlockedBy({
    repo: "recallnet/astrochicken",
    issueNumber: 777,
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("i777: issue(number:777)") && cmd.includes("blockedBy")) {
        return { data: { repository: { i777: { blockedBy: { nodes: [{ number: 13, state: "OPEN" }] } } } } };
      }
      return fallback;
    },
  }), [{ number: 13, state: "OPEN" }]);
});

test("fetchBugBlockedByBatch loads blocker metadata for multiple issues in one GraphQL query", () => {
  const calls = [];
  const out = fetchBugBlockedByBatch({
    repo: "recallnet/astrochicken",
    issueNumbers: [777, 778, 777],
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      if (cmd.includes("i777: issue(number:777)") && cmd.includes("i778: issue(number:778)")) {
        return {
          data: {
            repository: {
              i777: { blockedBy: { nodes: [{ number: 13, state: "OPEN" }] } },
              i778: { blockedBy: { nodes: [] } },
            },
          },
        };
      }
      return fallback;
    },
  });

  assert.deepEqual(out, {
    777: [{ number: 13, state: "OPEN" }],
    778: [],
  });
  assert.equal(calls.length, 1);
});

test("evaluateOpenBugGate snapshot override excludes bugs blocked by open issue relationships", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        {
          number: 501,
          title: "[bug] blocked bug should not trigger fast path",
          blocked_by: [{ number: 9001, state: "OPEN" }],
        },
        {
          number: 502,
          title: "[bug] unblocked bug should remain actionable",
          blocked_by: [{ number: 9002, state: "CLOSED" }],
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [502]);
  assert.equal(gate.parse_error, "");
});

test("evaluateOpenBugGate live query with empty labelFilters must include --label bug in gh query", () => {
  const calls = [];
  const gate = evaluateOpenBugGate({
    repo: "recallnet/astrochicken",
    // No labelFilters — simulates the DOT graph invocation which passes no --bug-label flags.
    // The gh query MUST still include "--label bug" to avoid counting all open issues as bugs.
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      // Return different results based on whether --label bug is in the query.
      // With --label bug: 1 actual bug.
      // Without --label bug: 76 issues (goals, features, wave markers) — the phantom counting bug.
      if (cmd.includes("--label bug")) {
        return [{ number: 999, title: "[bug] real bug", labels: [{ name: "bug" }] }];
      }
      // Simulate what happens without the filter: ALL open issues returned
      return [
        { number: 1, title: "Goal: do stuff", labels: [{ name: "ready" }] },
        { number: 2, title: "Feature: widget", labels: [{ name: "feature" }] },
        { number: 3, title: "Wave Ready: milestone-1", labels: [{ name: "wave-ready" }] },
      ];
    },
  });

  // The query MUST have included --label bug
  assert.ok(
    calls.some((cmd) => cmd.includes("--label bug")),
    `expected gh query to include "--label bug" but got: ${JSON.stringify(calls)}`,
  );

  // Should find only the 1 real bug, not the 3 non-bug issues
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [999]);
  assert.equal(gate.parse_error, "");
});

test("evaluateOpenBugGate live query treats malformed payload as non-blocking with parse_error", () => {
  const gate = evaluateOpenBugGate({
    repo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    labelFilters: ["managed-factory-bug"],
    ghJsonFn: () => ({ malformed: true }),
  });

  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_upstream_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
  assert.equal(gate.parse_error, "open_bugs_malformed_payload");
});

test("evaluateOpenBugGate live query excludes bugs blocked by open issue relationships", () => {
  const calls = [];
  const gate = evaluateOpenBugGate({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      if (cmd.includes("issue list --repo recallnet/astrochicken")) {
        return [
          { number: 601, title: "[bug] blocked bug", labels: [{ name: "bug" }] },
          { number: 602, title: "[bug] unblocked bug", labels: [{ name: "bug" }] },
        ];
      }
      if (cmd.includes("blockedBy") && cmd.includes("i601: issue(number:601)") && cmd.includes("i602: issue(number:602)")) {
        return {
          data: {
            repository: {
              i601: { blockedBy: { nodes: [{ number: 7001, state: "OPEN" }] } },
              i602: { blockedBy: { nodes: [] } },
            },
          },
        };
      }
      return fallback;
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_upstream_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [602]);
  assert.equal(calls.filter((cmd) => cmd.includes("blockedBy")).length, 1);
});

test("buildStateSnapshot records blocked_by metadata for open bugs so bug-fast can skip blocked incidents", () => {
  const snapshot = buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args, fallback = []) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      if (cmd.includes("issue list") && cmd.includes("--state open") && cmd.includes("--limit 500")) {
        return [
          {
            number: 701,
            title: "[bug] blocked bug in snapshot",
            createdAt: "2026-03-16T00:00:00Z",
            body: "",
            labels: [{ name: "bug" }],
          },
          {
            number: 702,
            title: "[bug] ready bug in snapshot",
            createdAt: "2026-03-16T00:00:00Z",
            body: "",
            labels: [{ name: "bug" }],
          },
        ];
      }
      if (cmd.includes("api graphql")) {
        const queryArg = args.find((a) => String(a).startsWith("query=")) || "";
        const query = String(queryArg);
        if (query.includes("blockedBy(") && query.includes("i701") && query.includes("i702")) {
          return {
            data: {
              repository: {
                i701: { blockedBy: { nodes: [{ number: 8001, state: "OPEN" }] } },
                i702: { blockedBy: { nodes: [] } },
              },
            },
          };
        }
        // Other batch GraphQL queries
        const matches = [...query.matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
        const repository = {};
        for (const m of matches) {
          const n = Number(m[2]);
          repository[`i${n}`] = query.includes("blockedBy(")
            ? { blockedBy: { nodes: [] } }
            : { state: "OPEN" };
        }
        return { data: { repository } };
      }
      return fallback;
    },
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  assert.deepEqual(parsed.open_bugs.map((bug) => ({ number: bug.number, blocked_by: bug.blocked_by })), [
    { number: 701, blocked_by: [{ number: 8001, state: "OPEN" }] },
    { number: 702, blocked_by: [] },
  ]);

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [702]);
});

test("evaluateOpenBugGate snapshot excludes bugs under a goal milestone from fast route", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        {
          number: 2186,
          title: "Fail-closed graph outcome mapping for scheduled Daily Lens jobs",
          labels: [{ name: "bug" }],
          milestone: "goal-2181-wave-1",
        },
        {
          number: 900,
          title: "[bug] standalone infra regression",
          labels: [{ name: "bug" }],
        },
        {
          number: 901,
          title: "[bug] another wave-managed bug",
          labels: [{ name: "bug" }],
          milestone: "goal-2140-wave-3",
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [900]);
  assert.equal(gate.parse_error, "");
});

test("evaluateOpenBugGate snapshot reports no bugs when all are wave-managed", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        {
          number: 2186,
          title: "Fail-closed graph outcome mapping",
          labels: [{ name: "bug" }],
          milestone: "goal-2181-wave-1",
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "false");
  assert.equal(gate.open_bug_count, 0);
  assert.deepEqual(gate.issue_numbers, []);
});

test("evaluateOpenBugGate live query excludes bugs under a goal milestone", () => {
  const calls = [];
  const gate = evaluateOpenBugGate({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args, fallback = null) => {
      const cmd = Array.isArray(args) ? args.join(" ") : "";
      calls.push(cmd);
      if (cmd.includes("issue list --repo recallnet/astrochicken") && cmd.includes("--label bug")) {
        return [
          { number: 2186, title: "Fail-closed graph outcome", labels: [{ name: "bug" }], milestone: { title: "goal-2181-wave-1" } },
          { number: 800, title: "[bug] real standalone bug", labels: [{ name: "bug" }] },
        ];
      }
      if (cmd.includes("blockedBy")) {
        return { data: { repository: { issue: { blockedBy: { nodes: [] } } } } };
      }
      return fallback;
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [800]);
});

test("buildStateSnapshot includes milestone field in open_bugs for wave-managed filtering", () => {
  const snapshot = buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeUnifiedStub([
      {
        number: 2186,
        title: "Fail-closed graph outcome",
        createdAt: "2026-03-16T00:00:00Z",
        body: "",
        labels: [{ name: "bug" }],
        milestone: { title: "goal-2181-wave-1" },
      },
      {
        number: 800,
        title: "[bug] standalone bug",
        createdAt: "2026-03-16T00:00:00Z",
        body: "",
        labels: [{ name: "bug" }],
      },
    ]),
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  assert.equal(parsed.open_bugs.length, 2);
  assert.equal(parsed.open_bugs[0].milestone, "goal-2181-wave-1");
  assert.equal(parsed.open_bugs[1].milestone, undefined);

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [800]);
});

test("evaluateOpenBugGate snapshot excludes goal sub-issues that have not yet been waved", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        {
          number: 2186,
          title: "Fail-closed graph outcome mapping",
          labels: [{ name: "bug" }],
          goal_managed: true,
        },
        {
          number: 900,
          title: "[bug] standalone infra regression",
          labels: [{ name: "bug" }],
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [900]);
});

test("evaluateOpenBugGate snapshot excludes bugs that are goal_managed OR wave-milestoned", () => {
  const gate = evaluateOpenBugGate({
    snapshotOverride: {
      open_bugs: [
        {
          number: 2186,
          title: "Bug under goal, not yet waved",
          labels: [{ name: "bug" }],
          goal_managed: true,
        },
        {
          number: 2187,
          title: "Bug already in a wave",
          labels: [{ name: "bug" }],
          milestone: "goal-2181-wave-1",
        },
        {
          number: 800,
          title: "[bug] standalone bug",
          labels: [{ name: "bug" }],
        },
      ],
    },
  });

  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [800]);
});

test("buildStateSnapshot tags goal sub-issue bugs with goal_managed", () => {
  const snapshot = buildStateSnapshot({
    repo: "recallnet/astrochicken",
    ghJsonFn: makeUnifiedStub([
      { number: 2181, title: "Goal: Daily Lens", labels: [{ name: "goal" }] },
      { number: 2186, title: "Fail-closed graph outcome", createdAt: "2026-03-16T00:00:00Z", body: "", labels: [{ name: "bug" }] },
      { number: 800, title: "[bug] standalone", createdAt: "2026-03-16T00:00:00Z", body: "", labels: [{ name: "bug" }] },
    ]),
    listGoalSubIssuesFn: ({ goalNumber }) => {
      if (goalNumber === 2181) {
        return [
          { number: 2186, title: "Fail-closed graph outcome", state: "open" },
          { number: 2185, title: "Some feature sub-issue", state: "open" },
        ];
      }
      return [];
    },
    recoverySweepFn: () => ({ stale_runs: [] }),
    scanCliCrashesFn: () => [],
    nowMs: 1_700_100_000_000,
  });

  const parsed = JSON.parse(snapshot);
  const bug2186 = parsed.open_bugs.find((b) => b.number === 2186);
  const bug800 = parsed.open_bugs.find((b) => b.number === 800);
  assert.equal(bug2186.goal_managed, true);
  assert.equal(bug800.goal_managed, undefined);

  const gate = evaluateOpenBugGate({ snapshot });
  assert.equal(gate.has_open_bugs, "true");
  assert.equal(gate.open_bug_count, 1);
  assert.deepEqual(gate.issue_numbers, [800]);
});
