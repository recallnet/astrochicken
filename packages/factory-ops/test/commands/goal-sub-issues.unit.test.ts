import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import { linkSubIssueSuccessfully } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createTestAdapter } from "../../../github-adapter/src/test-adapter.ts";
import { listGoalSubIssues, addSubIssue, checkAllSubIssuesClosed } from "../../src/commands/goal-sub-issues.ts";

// ─── DI stubs ───────────────────────────────────────────────────────────────

function makePaginatedFn(response) {
  return (_url, _fallback) => response;
}

function makeAdapter(subIssues) {
  const calls = [];
  return {
    repo: "owner/repo",
    listSubIssues: (args) => {
      calls.push(args);
      return subIssues;
    },
    _calls: calls,
  };
}

// ─── listGoalSubIssues ──────────────────────────────────────────────────────

describe("listGoalSubIssues", () => {
  it("returns [] when repo is missing", () => {
    assert.deepEqual(listGoalSubIssues({ goalNumber: "1" }), []);
  });

  it("returns [] when goalNumber is missing", () => {
    assert.deepEqual(listGoalSubIssues({ repo: "o/r" }), []);
  });

  it("returns [] when called with no args", () => {
    assert.deepEqual(listGoalSubIssues(), []);
  });

  it("returns normalized output from ghPaginatedFn", () => {
    const raw = [
      {
        number: 100,
        title: "Feature A",
        state: "open",
        labels: [{ name: "bug" }],
        issue_dependencies_summary: { blocked_by: 2 },
      },
      { number: "101", title: "Feature B", state: "closed" },
    ];
    const out = listGoalSubIssues({
      repo: "o/r",
      goalNumber: "50",
      ghPaginatedFn: makePaginatedFn(raw),
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      number: 100,
      title: "Feature A",
      state: "open",
      labels: [{ name: "bug" }],
      blocked_by_count: 2,
    });
    assert.deepEqual(out[1], {
      number: 101,
      title: "Feature B",
      state: "closed",
      labels: [],
      blocked_by_count: 0,
    });
  });

  it("uses adapter.listSubIssues when adapter is provided", () => {
    const adapter = makeAdapter([
      { number: 10, title: "A", state: "open" },
    ]);
    const out = listGoalSubIssues({ goalNumber: "5", adapter });
    assert.equal(out.length, 1);
    assert.equal(out[0].number, 10);
    // adapter carries the repo, no explicit repo needed
    assert.deepEqual(adapter._calls, [{ number: "5" }]);
  });

  it("returns [] for non-array API response", () => {
    assert.deepEqual(
      listGoalSubIssues({ repo: "o/r", goalNumber: "1", ghPaginatedFn: makePaginatedFn(null) }),
      [],
    );
    assert.deepEqual(
      listGoalSubIssues({ repo: "o/r", goalNumber: "1", ghPaginatedFn: makePaginatedFn("bad") }),
      [],
    );
  });

  it("normalizes state to lowercase", () => {
    const raw = [
      { number: 1, title: "A", state: "OPEN" },
      { number: 2, title: "B", state: "Closed" },
    ];
    const out = listGoalSubIssues({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn(raw),
    });
    assert.equal(out[0].state, "open");
    assert.equal(out[1].state, "closed");
  });

  it("reads blocked_by_count from issue_dependencies_summary", () => {
    const raw = [
      { number: 1, title: "A", state: "open", issue_dependencies_summary: { blocked_by: 3 } },
      { number: 2, title: "B", state: "open" },
    ];
    const out = listGoalSubIssues({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn(raw),
    });
    assert.equal(out[0].blocked_by_count, 3);
    assert.equal(out[1].blocked_by_count, 0);
  });
});

// ─── checkAllSubIssuesClosed ────────────────────────────────────────────────

describe("checkAllSubIssuesClosed", () => {
  it("returns all_closed: true when all sub-issues are closed", () => {
    const out = checkAllSubIssuesClosed({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn([
        { number: 10, title: "A", state: "closed" },
        { number: 11, title: "B", state: "closed" },
      ]),
    });
    assert.equal(out.all_closed, true);
    assert.equal(out.total, 2);
    assert.equal(out.open, 0);
    assert.equal(out.closed, 2);
  });

  it("returns all_closed: false when some sub-issues are open", () => {
    const out = checkAllSubIssuesClosed({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn([
        { number: 10, title: "A", state: "closed" },
        { number: 11, title: "B", state: "open" },
      ]),
    });
    assert.equal(out.all_closed, false);
    assert.equal(out.open, 1);
    assert.equal(out.closed, 1);
  });

  it("returns all_closed: false when there are no sub-issues (empty = not closeable)", () => {
    const out = checkAllSubIssuesClosed({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn([]),
    });
    assert.equal(out.all_closed, false);
    assert.equal(out.total, 0);
    assert.equal(out.open, 0);
    assert.equal(out.closed, 0);
  });

  it("includes sub_issues array in output with correct counts", () => {
    const out = checkAllSubIssuesClosed({
      repo: "o/r",
      goalNumber: "1",
      ghPaginatedFn: makePaginatedFn([
        { number: 1, title: "A", state: "closed" },
        { number: 2, title: "B", state: "open" },
        { number: 3, title: "C", state: "closed" },
      ]),
    });
    assert.equal(out.sub_issues.length, 3);
    assert.equal(out.total, 3);
    assert.equal(out.open, 1);
    assert.equal(out.closed, 2);
  });
});

// ─── addSubIssue ────────────────────────────────────────────────────────────

describe("addSubIssue", () => {
  it("returns ok: false with missing_required_args when args are missing", () => {
    assert.equal(addSubIssue().ok, false);
    assert.equal(addSubIssue().error, "missing_required_args");
    assert.equal(addSubIssue({ repo: "o/r" }).ok, false);
    assert.equal(addSubIssue({ repo: "o/r", parentNumber: "1" }).ok, false);
  });

  it("returns ok: true on success", () => {
    const adapter = createTestAdapter({
      repo: "o/r",
      stubs: { addSubIssue: () => ({ ok: true, parent: "1", child: "2", error: "" }) },
    });
    const out = addSubIssue({ repo: "o/r", parentNumber: "1", childNumber: "2", adapter });
    assert.equal(out.ok, true);
    assert.equal(out.parent, "1");
    assert.equal(out.child, "2");
    assert.equal(out.error, "");
  });

  it("uses adapter.addSubIssue when adapter is provided", () => {
    const adapter = createTestAdapter({
      repo: "o/r",
      stubs: { addSubIssue: ({ parentNumber, childNumber }) => ({ ok: true, parent: parentNumber, child: childNumber, error: "" }) },
    });
    const out = addSubIssue({ repo: "o/r", parentNumber: "1", childNumber: "2", adapter });
    assert.equal(out.ok, true);
    assert.deepEqual(adapter.callsTo("addSubIssue"), [
      {
        method: "addSubIssue",
        args: { parentNumber: "1", childNumber: "2" },
      },
    ]);
  });

  it("returns adapter failure when addSubIssue fails", () => {
    const adapter = createTestAdapter({
      repo: "o/r",
      stubs: { addSubIssue: () => ({ ok: false, parent: "1", child: "2", error: "add_sub_issue_failed: conflict" }) },
    });
    const out = addSubIssue({ repo: "o/r", parentNumber: "1", childNumber: "2", adapter });
    assert.equal(out.ok, false);
    assert.match(out.error, /add_sub_issue_failed/);
  });

  it("emits canonical lifecycle state when sub-issue link succeeds", () => {
    const domainEvents = [];
    const canonicalEvents = [];
    const out = addSubIssue({
      repo: "o/r",
      parentNumber: "1400",
      childNumber: "1536",
      factoryId: "example-trading",
      runId: "goal-run-1",
      githubProjectionTarget: {
        repo: "o/r",
        addSubIssue: linkSubIssueSuccessfully,
      },
      emitDomainEventFn: (event) => domainEvents.push(event),
      emitCanonicalEventFn: (event) => canonicalEvents.push(event),
      appendCanonicalEventsFn: ({ events }) => {
        canonicalEvents.push(...events);
        return 1;
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.canonical_events.length >= 2, true);
    assert.equal(domainEvents.length, 1);
    assert.equal(domainEvents[0].event_family, "factory.issue.sub_issue_link_applied");
    assert.equal(domainEvents[0].payload.parent_issue_number, "1400");
    assert.equal(domainEvents[0].payload.issue_number, "1536");
    assert.equal(domainEvents[0].payload.link_status, "linked");
    assert.equal(canonicalEvents.some((event) => event.event_family === "github.projection.receipt"), true);
  });

  it("records failed sub-issue link attempts canonically and keeps the workflow-visible error", () => {
    const domainEvents = [];
    const canonicalEvents = [];
    const out = addSubIssue({
      repo: "o/r",
      parentNumber: "1400",
      childNumber: "1536",
      factoryId: "example-trading",
      runId: "goal-run-1",
      githubProjectionTarget: {
        repo: "o/r",
        addSubIssue: ({ parentNumber, childNumber }) => ({
          ok: false,
          parent: String(parentNumber),
          child: String(childNumber),
          error: "add_sub_issue_failed: boom",
          status: 1,
          stderr: "boom",
        }),
      },
      emitDomainEventFn: (event) => domainEvents.push(event),
      emitCanonicalEventFn: (event) => canonicalEvents.push(event),
      appendCanonicalEventsFn: ({ events }) => {
        canonicalEvents.push(...events);
        return 1;
      },
    });

    assert.equal(out.ok, false);
    assert.match(out.error, /add_sub_issue_failed/);
    assert.equal(domainEvents.length, 1);
    assert.equal(domainEvents[0].payload.link_status, "failed");
    assert.equal(domainEvents[0].payload.error, "add_sub_issue_failed: boom");
    assert.equal(canonicalEvents.some((event) => event.event_family === "github.projection.receipt"), true);
  });

  it("degrades canonical append lock timeouts after a successful sub-issue link", () => {
    const out = addSubIssue({
      repo: "o/r",
      parentNumber: "1400",
      childNumber: "1536",
      factoryId: "example-trading",
      runId: "goal-run-1",
      githubProjectionTarget: {
        repo: "o/r",
        addSubIssue: linkSubIssueSuccessfully,
      },
      appendCanonicalEventsFn: () => {
        const error = new Error("canceling statement due to lock timeout");
        error.code = "55P03";
        throw error;
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.parent, "1400");
    assert.equal(out.child, "1536");
    assert.equal(out.canonical_event_commit_cursor, 0);
    assert.equal(out.canonical_event_persistence_deferred, true);
    assert.match(out.stderr, /canonical_event_append_deferred: canceling statement due to lock timeout/i);
  });

  it("forwards explicit mutation audit context through the shared GitHub projection path", () => {
    const auditRoot = mkdtempSync(path.join(tmpdir(), "goal-sub-issues-audit-"));
    try {
      const auditCalls = [];
      const ghCalls = [];
      const out = addSubIssue({
        repo: "o/r",
        parentNumber: "1400",
        childNumber: "1536",
        factoryId: "example-trading",
        runId: "goal-run-1",
        mutationContext: {
          instance_id: "example-trading",
          installation_id: "inst_example_trading_devrel",
          host_id: "host_example_trading_01",
          run_id: "goal-run-1",
          tick_id: "tick-example-trading-01",
          destination_name: "github",
          capability_version: "capability.goal.decomposition.v1",
          policy_profile: "policy.default",
          runtime_version: "runtime.test",
        },
        ghExec: (args) => {
          ghCalls.push(args);
          if (args[0] === "api" && String(args[1] || "").startsWith("repos/o/r/issues/")) {
            const issueNumber = String(args[1]).split("/").pop();
            return successfulCommandResult(issueNumber === "1400" ? "PARENT_NODE_ID\n" : "CHILD_NODE_ID\n");
          }
          if (args[0] === "api" && args[1] === "graphql") {
            return successfulCommandResult(JSON.stringify({ data: { addSubIssue: { issue: { number: 1400 }, subIssue: { number: 1536 } } } }));
          }
          return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${JSON.stringify(args)}` };
        },
        appendAuditRecordFn: (record) => {
          auditCalls.push(record);
          return { ok: true };
        },
        auditHostBaseDir: auditRoot,
        appendCanonicalEventsFn: () => 0,
      });

      assert.equal(out.ok, true);
      assert.equal(auditCalls.length, 1);
      assert.equal(auditCalls[0].installation_id, "inst_example_trading_devrel");
      assert.equal(auditCalls[0].host_id, "host_example_trading_01");
      assert.equal(auditCalls[0].run_id, "goal-run-1");
      assert.equal(auditCalls[0].tick_id, "tick-example-trading-01");
      assert.equal(auditCalls[0].target_ref, "issues/1400/sub_issues/1536");
      assert.equal(ghCalls.some((args) => args[0] === "api" && args[1] === "graphql"), true);
    } finally {
      rmSync(auditRoot, { recursive: true, force: true });
    }
  });
});
