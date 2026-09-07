import assert from "node:assert/strict";
import test from "node:test";

import { collectGithubState } from "../src/daily-lens-github-state.ts";

const WINDOW_START = "2026-03-05T00:00:00.000Z";
const WINDOW_END = "2026-03-06T00:00:00.000Z";

function ghStub(args, fallback = []) {
  const jsonFields = args.includes("--json") ? args[args.indexOf("--json") + 1] : "";

  if (args[0] === "issue" && args[1] === "list" && jsonFields === "number,title,state,createdAt,closedAt,labels") {
    return [
      {
        number: 1325,
        title: "Collector issue",
        state: "OPEN",
        createdAt: "2026-03-05T05:00:00.000Z",
        closedAt: "",
        labels: [{ name: "feature" }],
      },
      {
        number: 1324,
        title: "Closed issue",
        state: "CLOSED",
        createdAt: "2026-03-04T23:00:00.000Z",
        closedAt: "2026-03-05T07:00:00.000Z",
        labels: [{ name: "bug" }],
      },
      {
        number: 1200,
        title: "Outside window",
        state: "OPEN",
        createdAt: "2026-03-01T00:00:00.000Z",
        closedAt: "",
        labels: [],
      },
    ];
  }

  if (args[0] === "pr" && args[1] === "list") {
    return [
      {
        number: 700,
        title: "Merged in window",
        state: "MERGED",
        updatedAt: "2026-03-05T08:30:00.000Z",
        mergedAt: "2026-03-05T08:00:00.000Z",
        labels: [{ name: "wave" }],
      },
      {
        number: 701,
        title: "Outside window",
        state: "OPEN",
        updatedAt: "2026-03-07T08:30:00.000Z",
        mergedAt: "",
        labels: [],
      },
    ];
  }

  return fallback;
}

test("collectGithubState filters issues and PRs to the report window", async () => {
  const payload = await collectGithubState({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    repo: "recallnet/astrochicken",
    ghJsonFn: ghStub,
    buildStateSnapshotFn: () => JSON.stringify({
      action_count: 3,
      orphan_features: [{ number: 91 }],
      open_bugs: [{ number: 7 }],
    }),
    evaluateOpenBugGateFn: () => ({
      has_open_bugs: "true",
      open_bug_count: 1,
      issue_numbers: [7],
      parse_error: "",
    }),
  });

  assert.equal(payload.source, "github_state");
  assert.equal(payload.missing_data.length, 0);
  assert.equal(payload.issues.length, 2);
  assert.equal(payload.pull_requests.length, 1);
  assert.deepEqual(payload.issue_counts, { created: 1, closed: 1 });
  assert.deepEqual(payload.pull_request_counts, { merged: 1, updated: 1 });
  assert.equal(payload.bug_gate.open_bug_count, 1);
  assert.deepEqual(payload.snapshot, {
    action_count: 3,
    orphan_feature_count: 1,
    open_bug_count: 1,
  });
});

test("collectGithubState returns structured missing data when repo is absent", async () => {
  const payload = await collectGithubState({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    repo: "",
  });

  assert.equal(payload.source, "github_state");
  assert.equal(payload.issues.length, 0);
  assert.equal(payload.pull_requests.length, 0);
  assert.equal(payload.missing_data.length, 1);
  assert.equal(payload.missing_data[0].reason, "source_missing");
});
