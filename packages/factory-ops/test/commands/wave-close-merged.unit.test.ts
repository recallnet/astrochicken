import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeMergedIssues } from "../../src/commands/wave-close-merged.ts";

function makeExecGh(results = {}) {
  const calls = [];
  return {
    fn: (args) => {
      calls.push(args);
      const issueNum = args[2];
      return results[issueNum] ?? { ok: true };
    },
    calls,
  };
}

function makeListMilestoneIssues(issues = []) {
  const calls = [];
  return {
    fn: (args, fallback) => {
      calls.push({ args, fallback });
      return issues;
    },
    calls,
  };
}

describe("closeMergedIssues", () => {
  // --- Basic behavior ---

  it("returns empty results for empty candidates and no milestone", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: "[]",
      runId: "r1",
      milestoneTitle: "",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result, {
      closed: [],
      failed: [],
      closed_count: 0,
      failed_count: 0,
    });
  });

  it("closes a single candidate issue", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 42 }]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, ["42"]);
    assert.equal(result.closed_count, 1);
    assert.equal(result.failed_count, 0);
  });

  it("closes multiple candidate issues", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([
        { issue_number: 10 },
        { issue_number: 20 },
        { issue_number: 30 },
      ]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, ["10", "20", "30"]);
    assert.equal(result.closed_count, 3);
    assert.equal(result.failed_count, 0);
  });

  it("puts issue in failed array when execGh returns ok: false", () => {
    const gh = makeExecGh({ "42": { ok: false } });
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 42 }]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, []);
    assert.deepStrictEqual(result.failed, ["42"]);
    assert.equal(result.closed_count, 0);
    assert.equal(result.failed_count, 1);
  });

  it("handles mixed success and failure", () => {
    const gh = makeExecGh({ "20": { ok: false } });
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([
        { issue_number: 10 },
        { issue_number: 20 },
        { issue_number: 30 },
      ]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, ["10", "30"]);
    assert.deepStrictEqual(result.failed, ["20"]);
    assert.equal(result.closed_count, 2);
    assert.equal(result.failed_count, 1);
  });

  // --- Deduplication ---

  it("deduplicates issue numbers in candidates", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([
        { issue_number: 42 },
        { issue_number: 42 },
      ]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, ["42"]);
    assert.equal(result.closed_count, 1);
    // Should have exactly 2 calls: comment + close (not 4)
    const closeCalls = gh.calls.filter((c) => c[0] === "issue" && c[1] === "close");
    assert.equal(closeCalls.length, 1);
  });

  it("deduplicates issues present in both candidates and milestone", () => {
    const gh = makeExecGh();
    const milestone = makeListMilestoneIssues([
      { number: 42, title: "Some issue", labels: [] },
    ]);
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 42 }]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: milestone.fn,
    });
    assert.deepStrictEqual(result.closed, ["42"]);
    assert.equal(result.closed_count, 1);
    const closeCalls = gh.calls.filter((c) => c[0] === "issue" && c[1] === "close");
    assert.equal(closeCalls.length, 1);
  });

  // --- Milestone issue collection ---

  it("closes milestone issues alongside candidates", () => {
    const gh = makeExecGh();
    const milestone = makeListMilestoneIssues([
      { number: 99, title: "Milestone bug", labels: [] },
    ]);
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 10 }]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: milestone.fn,
    });
    assert.ok(result.closed.includes("10"));
    assert.ok(result.closed.includes("99"));
    assert.equal(result.closed_count, 2);
  });

  it("filters out wave marker issues from milestone", () => {
    const gh = makeExecGh();
    const milestone = makeListMilestoneIssues([
      { number: 1, title: "Wave Ready: wave-1", labels: [] },
      { number: 2, title: "Real issue", labels: [] },
    ]);
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: "[]",
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: milestone.fn,
    });
    assert.deepStrictEqual(result.closed, ["2"]);
    assert.equal(result.closed_count, 1);
  });

  it("skips milestone query when milestoneTitle is empty", () => {
    const gh = makeExecGh();
    const milestone = makeListMilestoneIssues([
      { number: 99, title: "Should not appear", labels: [] },
    ]);
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 10 }]),
      runId: "r1",
      milestoneTitle: "",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: milestone.fn,
    });
    assert.deepStrictEqual(result.closed, ["10"]);
    // Milestone fn should not have been called
    assert.equal(milestone.calls.length, 0);
  });

  it("skips milestone query when repo is empty", () => {
    const milestone = makeListMilestoneIssues([
      { number: 99, title: "Should not appear", labels: [] },
    ]);
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 10 }]),
      runId: "r1",
      milestoneTitle: "wave-1",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: milestone.fn,
    });
    assert.equal(milestone.calls.length, 0);
  });

  // --- Edge cases ---

  it("treats invalid JSON in mergeCandidatesRaw as empty array", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: "not valid json{{{",
      runId: "r1",
      milestoneTitle: "",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result, {
      closed: [],
      failed: [],
      closed_count: 0,
      failed_count: 0,
    });
  });

  it("filters out '0' issue numbers", () => {
    const gh = makeExecGh();
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([
        { issue_number: 0 },
        { issue_number: 5 },
      ]),
      runId: "r1",
      milestoneTitle: "",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    assert.deepStrictEqual(result.closed, ["5"]);
    assert.equal(result.closed_count, 1);
  });

  it("includes milestoneTitle and runId in comment body", () => {
    const gh = makeExecGh();
    closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 7 }]),
      runId: "run-abc",
      milestoneTitle: "wave-42",
      execGh: gh.fn,
      listMilestoneOpenIssuesFn: makeListMilestoneIssues().fn,
    });
    const commentCall = gh.calls.find(
      (c) => c[0] === "issue" && c[1] === "comment",
    );
    assert.ok(commentCall, "expected a comment call");
    const body = commentCall[commentCall.indexOf("--body") + 1];
    assert.ok(body.includes("wave-42"), "comment should include milestoneTitle");
    assert.ok(body.includes("run-abc"), "comment should include runId");
  });

  it("emits canonical close lifecycle and projection receipts for merged issues", () => {
    const canonicalEvents = [];
    const result = closeMergedIssues({
      repo: "owner/repo",
      mergeCandidatesRaw: JSON.stringify([{ issue_number: 7 }]),
      runId: "run-abc",
      factoryId: "example-trading",
      milestoneTitle: "wave-42",
      githubProjectionTarget: {
        repo: "owner/repo",
        issueComment({ number, body }) {
          return { ok: true, status: 0, stderr: "", error: "", number, body };
        },
        issueClose({ number, reason }) {
          return { ok: true, status: 0, stderr: "", error: "", number, reason };
        },
      },
      emitCanonicalEventFn: (event) => canonicalEvents.push(event),
      appendCanonicalEventsFn: ({ events }) => {
        canonicalEvents.push(...events);
        return 11;
      },
    });

    assert.deepStrictEqual(result.closed, ["7"]);
    assert.equal(result.canonical_event_commit_cursor, 11);
    assert.equal(
      canonicalEvents.some((event) => event.event_family === "github.projection.receipt" && event.payload.operation === "issue_close"),
      true,
    );
    assert.equal(
      canonicalEvents.some((event) => event.event_family === "factory.issue.close_applied" && event.payload.close_status === "closed"),
      true,
    );
  });
});
