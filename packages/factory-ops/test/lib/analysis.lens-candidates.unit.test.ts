import assert from "node:assert/strict";
import test from "node:test";

import {
  isLensActionRegistryEntry,
  prepareLensCandidateEntries,
  publishLensCandidates,
} from "../../src/lib/analysis/lens-candidates.ts";

test("prepareLensCandidateEntries materializes v2 action_registry entries", () => {
  const prepared = prepareLensCandidateEntries({
    date: "2026-03-15",
    meta: { run_id: "run-123" },
    action_registry: [
      {
        id: "lens-2026-03-15-001",
        type: "task",
        title: "Add deterministic gate for flaky retries",
        summary: "Add deterministic gate for flaky retries",
        why_now: "Retries increased in the last report window.",
        success_metric: "Retry regression test passes for 3 consecutive runs.",
        evidence_links: ["langfuse.trace:123"],
        dependency_hints: ["Depends on timeout budget metrics PR"],
        recommendation: "Add a deterministic retry regression and tighten the timeout budget guard.",
        execution_owner: "supervisor_on_main",
      },
    ],
  });

  assert.equal(prepared.report_date, "2026-03-15");
  assert.equal(prepared.lens_run_id, "run-123");
  assert.equal(prepared.source, "action_registry");
  assert.equal(prepared.entries.length, 1);
  assert.equal(prepared.entries[0].suggestion_id, "lens-2026-03-15-001");
  assert.equal(prepared.entries[0].type, "task");
  assert.equal(prepared.entries[0].title, "Add deterministic gate for flaky retries");
  assert.equal(prepared.entries[0].why_now, "Retries increased in the last report window.");
  assert.equal(prepared.entries[0].success_metric, "Retry regression test passes for 3 consecutive runs.");
  assert.deepEqual(prepared.entries[0].dependency_hints, ["Depends on timeout budget metrics PR"]);
  assert.deepEqual(prepared.entries[0].evidence, ["langfuse.trace:123"]);
  assert.equal(prepared.entries[0].execution_owner, "supervisor_on_main");
  assert.equal(prepared.skipped.length, 0);
});

test("prepareLensCandidateEntries skips invalid action_registry entries instead of throwing", () => {
  const prepared = prepareLensCandidateEntries({
    action_registry: [{
      id: "lens-2026-03-15-001",
      type: "task",
      title: "Add deterministic gate for flaky retries",
      why_now: "Need deterministic guardrail.",
      evidence_links: ["langfuse.trace:123"],
      dependency_hints: [],
    }],
  });

  assert.equal(prepared.entries.length, 0);
  assert.match(prepared.skipped[0].reason, /missing_field field=success_metric/);

  assert.equal(isLensActionRegistryEntry({
    id: "lens-2026-03-15-002",
    type: "task",
    title: "Valid",
    why_now: "Needed now",
    success_metric: "Shipped",
    evidence_links: [],
    dependency_hints: [],
  }), true);

  assert.equal(isLensActionRegistryEntry({ id: "broken" }), false);
});

test("prepareLensCandidateEntries preserves legacy suggestions fallback", () => {
  const prepared = prepareLensCandidateEntries({
    date: "2026-03-15",
    suggestions: [
      {
        id: "lens-2026-03-15-001",
        summary: "Add deterministic gate for flaky retries",
        recommendation: "Capture flaky retry signature and fail closed.",
        evidence_refs: ["langfuse.trace:123"],
      },
      {
        id: "lens-2026-03-15-002",
        summary: "",
      },
      {
        summary: "missing id",
      },
    ],
  });

  assert.equal(prepared.source, "suggestions");
  assert.equal(prepared.entries.length, 1);
  assert.equal(prepared.entries[0].why_now, "Add deterministic gate for flaky retries");
  assert.ok(prepared.entries[0].success_metric.length > 0);
  assert.equal(prepared.skipped.length, 2);
  assert.equal(prepared.skipped[0].reason, "missing_summary");
  assert.equal(prepared.skipped[1].reason, "missing_id");
});

test("prepareLensCandidateEntries skips vague or evidence-free candidates instead of throwing", () => {
  const prepared = prepareLensCandidateEntries({
    date: "2026-03-15",
    action_registry: [
      {
        id: "lens-2026-03-15-001",
        type: "task",
        title: "Investigate weirdness",
        why_now: "Something was odd",
        success_metric: "Unknown",
        recommendation: "Investigate why this happened",
        evidence_links: [],
        dependency_hints: [],
      },
    ],
  });

  assert.equal(prepared.entries.length, 0);
  assert.deepEqual(prepared.skipped.map((entry) => entry.reason), ["missing_evidence"]);
});

test("publishLensCandidates creates candidate issues from action_registry fields", () => {
  const ghCalls = [];
  const linkCalls = [];

  const result = publishLensCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2100,
    reportDate: "2026-03-15",
    lensJson: {
      meta: { run_id: "run-456" },
      action_registry: [
        {
          id: "lens-2026-03-15-001",
          type: "task",
          title: "Add deterministic gate for flaky retries",
          summary: "Add deterministic gate for flaky retries",
          why_now: "Retries increased by 2x in the latest window.",
          success_metric: "Regression gate proves no retry spike for 3 runs.",
          recommendation: "Add a retry regression and tighten the timeout budget guard.",
          evidence_links: ["langfuse.trace:123"],
          dependency_hints: ["Depends on retry-budget telemetry cleanup"],
          execution_owner: "supervisor_on_main",
        },
      ],
    },
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "create") {
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2101\n",
          stderr: "",
        };
      }
      return {
        ok: false,
        status: 1,
        stdout: "",
        stderr: `unexpected gh args: ${args.join(" ")}`,
      };
    },
    addSubIssueFn: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
  });

  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(linkCalls, [{
    repo: "recallnet/astrochicken",
    parentNumber: 2100,
    childNumber: 2101,
  }]);

  const createCall = ghCalls.find((args) => args[0] === "issue" && args[1] === "create");
  assert.ok(createCall, "expected gh issue create call");
  const body = String(createCall[createCall.indexOf("--body") + 1] || "");
  assert.match(body, /## Why now/);
  assert.match(body, /## Success metric/);
  assert.match(body, /## Execution owner/);
  assert.match(body, /## Dependency hints/);
  assert.match(body, /candidate_source/);
  assert.match(body, /execution_owner/);
  assert.match(body, /Do not add `goal` or `ready` labels/);
});

test("publishLensCandidates updates changed existing candidate and skips unchanged legacy suggestion candidate", () => {
  const ghCalls = [];
  const linkCalls = [];

  const unchangedBody = [
    "## Action title",
    "Unchanged summary",
    "",
    "## Recommendation summary",
    "Unchanged summary",
    "",
    "## Why now",
    "Unchanged summary",
    "",
    "## Success metric",
    "Candidate issue reaches merged or closed state with evidence-backed completion notes.",
    "",
    "## Evidence (quoted from Daily Lens output)",
    "```json",
    "[]",
    "```",
    "",
    "## Candidate metadata",
    "```json",
    JSON.stringify({
      origin_report_number: 2100,
      origin_report_date: "2026-03-15",
      lens_suggestion_id: "lens-2026-03-15-002",
      lens_run_id: "2026-03-15 manual",
      action_type: "task",
      candidate_source: "suggestions",
    }, null, 2),
    "```",
    "",
    "> Operator note: This is candidate follow-up work pending human report promotion. Do not add `goal` or `ready` labels until the parent Daily Lens report is reviewed.",
  ].join("\n");

  const result = publishLensCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2100,
    reportDate: "2026-03-15",
    lensJson: {
      suggestions: [
        {
          id: "lens-2026-03-15-001",
          summary: "Updated summary",
          evidence_refs: ["new evidence"],
        },
        {
          id: "lens-2026-03-15-002",
          summary: "Unchanged summary",
        },
      ],
    },
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      const argString = args.join(" ");
      if (args[0] === "issue" && args[1] === "list" && argString.includes("lens-2026-03-15-001")) {
        return [{
          number: 2101,
          title: "Daily Lens Candidate — 2026-03-15 — lens-2026-03-15-001",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2101",
        }];
      }
      if (args[0] === "issue" && args[1] === "list" && argString.includes("lens-2026-03-15-002")) {
        return [{
          number: 2102,
          title: "Daily Lens Candidate — 2026-03-15 — lens-2026-03-15-002",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2102",
        }];
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2101") {
        return {
          number: 2101,
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2101",
          body: "old body",
          labels: [{ name: "daily-lens" }],
        };
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2102") {
        return {
          number: 2102,
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2102",
          body: unchangedBody,
          labels: [
            { name: "daily-lens" },
            { name: "daily-lens-candidate" },
            { name: "daily-lens-lens-2026-03-15-002" },
          ],
        };
      }
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "edit") {
        return { ok: true, status: 0, stdout: "", stderr: "" };
      }
      return {
        ok: false,
        status: 1,
        stdout: "",
        stderr: `unexpected gh args: ${args.join(" ")}`,
      };
    },
    addSubIssueFn: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
  });

  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 1);
  assert.equal(result.skipped.filter((entry) => entry.reason === "missing_evidence").length, 1);
  assert.deepEqual(linkCalls.map((entry) => entry.childNumber), [2101]);

  const editCall = ghCalls.find((args) => args[0] === "issue" && args[1] === "edit" && String(args[2]) === "2101");
  assert.ok(editCall, "expected issue edit for changed candidate");
});
