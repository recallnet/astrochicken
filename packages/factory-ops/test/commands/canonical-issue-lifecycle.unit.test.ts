import { makeAppliedTradingSubIssueLinkEvent } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { listCanonicalIssueLifecycleForGoal, listCanonicalGoalLifecycleForGoal, listCanonicalGoalCandidatesForRepo, normalizeIssueSubIssueLinkTransition, projectGoalCandidatesFromCanonicalRows, projectIssueLifecycleFromCanonicalRows, projectGoalLifecycleFromCanonicalRows } from "../../src/lib/canonical-issue-lifecycle.ts";

test("normalizeIssueSubIssueLinkTransition validates and normalizes canonical sub-issue link state", () => {
  const out = normalizeIssueSubIssueLinkTransition({
    repo: " example-org/example-trading ",
    issueNumber: "1799",
    parentIssueNumber: "1782",
    linkStatus: "LINKED",
    error: " ",
  });

  assert.deepEqual(out, {
    repo: "example-org/example-trading",
    issue_number: "1799",
    parent_issue_number: "1782",
    link_status: "linked",
    error: "",
  });
});

test("projectIssueLifecycleFromCanonicalRows keeps created issues and sub-issue link status in canonical state", () => {
  const rows = [
    {
      event_family: "factory.issue.created",
      payload: {
        issue_number: "1799",
        issue_url: "https://github.com/example-org/example-trading/issues/1799",
        repo: "example-org/example-trading",
      },
    },
    {
      event_family: "factory.issue.sub_issue_link_applied",
      payload: {
        issue_number: "1799",
        parent_issue_number: "1782",
        repo: "example-org/example-trading",
        link_status: "linked",
        error: "",
      },
    },
  ];

  assert.deepEqual(projectIssueLifecycleFromCanonicalRows(rows), [
    {
      issue_number: "1799",
      repo: "example-org/example-trading",
      created: true,
      issue_url: "https://github.com/example-org/example-trading/issues/1799",
      parent_issue_number: "1782",
      sub_issue_link_status: "linked",
      merge_status: "",
      shipped_to_main: false,
      github_close_status: "",
      last_error: "",
    },
  ]);
});

test("listCanonicalIssueLifecycleForGoal projects canonical merge and close state for linked goal sub-issues", async () => {
  const out = await listCanonicalIssueLifecycleForGoal({
    factoryId: "example-trading",
    goalNumber: "1789",
    repo: "example-org/example-trading",
    queryRowsFn: () => [
      makeAppliedTradingSubIssueLinkEvent(),
      {
        event_family: "factory.merge.completed",
        payload: {
          issue_number: "1791",
          repo: "example-org/example-trading",
          merge_status: "pushed",
        },
      },
      {
        event_family: "factory.issue.close_applied",
        payload: {
          issue_number: "1791",
          repo: "example-org/example-trading",
          close_status: "closed",
          reason: "completed",
          error: "",
        },
      },
    ],
  });

  assert.deepEqual(out, [
    {
      issue_number: "1791",
      repo: "example-org/example-trading",
      created: false,
      issue_url: "",
      parent_issue_number: "1789",
      sub_issue_link_status: "linked",
      merge_status: "pushed",
      shipped_to_main: true,
      github_close_status: "closed",
      close_reason: "completed",
      last_error: "",
    },
  ]);
});

test("projectGoalLifecycleFromCanonicalRows keeps canonical close request and close applied state for goals", () => {
  const rows = [
    {
      event_family: "factory.goal.close_requested",
      payload: {
        goal_issue_number: "1789",
        repo: "example-org/example-trading",
        request_status: "requested",
        reason: "all_sub_issues_shipped",
        error: "",
      },
    },
    {
      event_family: "factory.goal.close_applied",
      payload: {
        goal_issue_number: "1789",
        repo: "example-org/example-trading",
        close_status: "closed",
        reason: "completed",
        error: "",
      },
    },
  ];

  assert.deepEqual(projectGoalLifecycleFromCanonicalRows(rows), [
    {
      goal_issue_number: "1789",
      repo: "example-org/example-trading",
      goal_close_request_status: "requested",
      goal_close_request_reason: "all_sub_issues_shipped",
      goal_close_status: "closed",
      goal_close_reason: "completed",
      last_error: "",
    },
  ]);
});

test("listCanonicalGoalLifecycleForGoal projects canonical goal close state", async () => {
  const out = await listCanonicalGoalLifecycleForGoal({
    factoryId: "example-trading",
    goalNumber: "1789",
    repo: "example-org/example-trading",
    queryRowsFn: () => [
      {
        event_family: "factory.goal.close_requested",
        payload: {
          goal_issue_number: "1789",
          repo: "example-org/example-trading",
          request_status: "requested",
          reason: "all_sub_issues_shipped",
          error: "",
        },
      },
      {
        event_family: "factory.goal.close_applied",
        payload: {
          goal_issue_number: "1789",
          repo: "example-org/example-trading",
          close_status: "failed",
          reason: "completed",
          error: "transport_failed",
        },
      },
    ],
  });

  assert.deepEqual(out, [
    {
      goal_issue_number: "1789",
      repo: "example-org/example-trading",
      goal_close_request_status: "requested",
      goal_close_request_reason: "all_sub_issues_shipped",
      goal_close_status: "failed",
      goal_close_reason: "completed",
      last_error: "transport_failed",
    },
  ]);
});

test("projectGoalCandidatesFromCanonicalRows keeps canonically known goals and latest close state", () => {
  const out = projectGoalCandidatesFromCanonicalRows([
    makeAppliedTradingSubIssueLinkEvent(),
    {
      event_family: "factory.goal.close_applied",
      payload: {
        goal_issue_number: "1789",
        repo: "example-org/example-trading",
        close_status: "closed",
        reason: "completed",
        error: "",
      },
    },
  ]);

  assert.deepEqual(out, [
    {
      goal_number: "1789",
      repo: "example-org/example-trading",
      goal_close_request_status: "",
      goal_close_status: "closed",
      goal_close_reason: "completed",
      last_error: "",
    },
  ]);
});

test("listCanonicalGoalCandidatesForRepo projects distinct goals from canonical lifecycle rows", async () => {
  const out = await listCanonicalGoalCandidatesForRepo({
    factoryId: "example-trading",
    repo: "example-org/example-trading",
    queryRowsFn: () => [
      makeAppliedTradingSubIssueLinkEvent(),
      {
        event_family: "factory.goal.close_requested",
        payload: {
          goal_issue_number: "1790",
          repo: "example-org/example-trading",
          request_status: "requested",
          reason: "all_sub_issues_shipped",
          error: "",
        },
      },
    ],
  });

  assert.deepEqual(out, [
    {
      goal_number: "1789",
      repo: "example-org/example-trading",
      goal_close_request_status: "",
      goal_close_status: "",
      last_error: "",
    },
    {
      goal_number: "1790",
      repo: "example-org/example-trading",
      goal_close_request_status: "requested",
      goal_close_request_reason: "all_sub_issues_shipped",
      goal_close_status: "",
      last_error: "",
    },
  ]);
});
