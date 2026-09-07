import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_CANONICAL_EVENT_FAMILIES,
  createGitHubIssueSource,
  createGitHubProjectionTarget,
} from "../src/github-adapter.ts";
import { createTestAdapter } from "../src/test-adapter.ts";

test("github issue source emits canonical source-read events for inbound issue reads", () => {
  const emitted = [];
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueView: () => ({
        number: 2411,
        title: "Goal: Fix the factory",
        body: "Body",
        state: "OPEN",
        labels: [{ name: "goal" }, { name: "ready" }],
      }),
    },
  });

  const source = createGitHubIssueSource({
    adapter,
    factoryId: "mothership",
    runId: "run-2411",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  const issue = source.issueView({ number: 2411, fields: "number,title,body,state,labels" });

  assert.equal(issue.number, 2411);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, GITHUB_CANONICAL_EVENT_FAMILIES.ISSUE_SOURCE_READ);
  assert.equal(emitted[0].factory_id, "mothership");
  assert.equal(emitted[0].run_id, "run-2411");
  assert.equal(emitted[0].payload.operation, "issue_view");
  assert.equal(emitted[0].payload.issue_number, "2411");
  assert.deepEqual(emitted[0].payload.labels, ["goal", "ready"]);
});

test("github projection target emits projection receipt events for outbound mutations", () => {
  const emitted = [];
  const adapter = createTestAdapter({
    repo: "example-org/example-trading",
    stubs: {
      issueCreate: () => ({ ok: true, status: 0, stdout: "", stderr: "", url: "https://github.com/example-org/example-trading/issues/1536" }),
      issueEdit: () => ({ ok: true, status: 0, stdout: "", stderr: "" }),
      issueComment: () => ({ ok: true, status: 0, stdout: "", stderr: "" }),
      issueClose: () => ({ ok: true, status: 0, stdout: "", stderr: "" }),
      addSubIssue: () => ({ ok: true, status: 0, stdout: "", stderr: "", parent: "1400", child: "1536", error: "" }),
      labelCreate: () => ({ ok: true, status: 0, stdout: "", stderr: "" }),
    },
  });

  const target = createGitHubProjectionTarget({
    adapter,
    factoryId: "example-trading",
    runId: "run-1536",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  target.issueCreate({ title: "Feature", body: "Ship it", labels: ["ready"] });
  target.issueEdit({ number: 1536, addLabels: ["ready"], removeLabels: ["triaged"] });
  target.issueComment({ number: 1536, body: "comment" });
  target.issueClose({ number: 1536, reason: "completed" });
  target.addSubIssue({ parentNumber: 1400, childNumber: 1536 });
  target.labelCreate({ name: "ready", description: "desc", color: "ededed" });

  assert.equal(emitted.length, 6);
  for (const event of emitted) {
    assert.equal(event.event_family, GITHUB_CANONICAL_EVENT_FAMILIES.PROJECTION_RECEIPT);
    assert.equal(event.factory_id, "example-trading");
    assert.equal(event.run_id, "run-1536");
  }
  assert.deepEqual(
    emitted.map((event) => event.payload.operation),
    ["issue_create", "issue_edit", "issue_comment", "issue_close", "add_sub_issue", "label_create"],
  );
  assert.equal(emitted[0].payload.issue_number, "1536");
  assert.equal(emitted[4].payload.target_ref, "issues/1400/sub_issues/1536");
  assert.equal(emitted[5].payload.target_ref, "labels/ready");
});

test("github projection target emits projection receipt events for failed outbound mutations too", () => {
  const emitted = [];
  const adapter = createTestAdapter({
    repo: "example-org/example-trading",
    stubs: {
      issueEdit: () => ({ ok: false, status: 1, stdout: "", stderr: "denied" }),
    },
  });

  const target = createGitHubProjectionTarget({
    adapter,
    factoryId: "example-trading",
    runId: "run-1536",
    emitCanonicalEventFn: (event) => emitted.push(event),
  });

  const result = target.issueEdit({ number: 1536, addLabels: ["ready"] });

  assert.equal(result.ok, false);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, GITHUB_CANONICAL_EVENT_FAMILIES.PROJECTION_RECEIPT);
  assert.equal(emitted[0].payload.operation, "issue_edit");
  assert.equal(emitted[0].payload.ok, false);
  assert.equal(emitted[0].payload.status, 1);
  assert.equal(emitted[0].payload.stderr, "denied");
});
