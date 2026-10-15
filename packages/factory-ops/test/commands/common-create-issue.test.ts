import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitHubIssueFromSpec, updateGitHubIssueFromSpec } from "../../src/commands/common-create-issue.ts";

test("createGitHubIssueFromSpec creates issue from stdin-safe spec payload", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/123\n");
    }
    return successfulCommandResult();
  };

  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueSpecRaw: JSON.stringify({
      issue_title: "Implement semantic triage",
      issue_body: "Do the thing.",
      issue_labels: "feature,triaged",
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.issue_url, "https://github.com/recallnet/astrochicken/issues/123");
  assert.deepEqual(calls[0], [
    "issue", "create", "--repo", "recallnet/astrochicken",
    "--title", "Implement semantic triage",
    "--body", "Do the thing.",
  ]);
  assert.deepEqual(calls[1], [
    "issue", "edit", "123", "--repo", "recallnet/astrochicken",
    "--add-label", "feature",
  ]);
  assert.deepEqual(calls[2], [
    "issue", "edit", "123", "--repo", "recallnet/astrochicken",
    "--add-label", "triaged",
  ]);
});

test("createGitHubIssueFromSpec returns created_issue_number extracted from issue URL", () => {
  const ghExec = () => (successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2056\n"));

  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueSpecRaw: JSON.stringify({
      issue_title: "Test issue",
      issue_body: "Body.",
    }),
    ghExec,
  });

  assert.equal(out.created_issue_number, "2056");
});

test("createGitHubIssueFromSpec returns empty created_issue_number on failure", () => {
  const ghExec = () => ({ ok: false, status: 1, stdout: "", stderr: "error" });

  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueSpecRaw: JSON.stringify({
      issue_title: "Test issue",
      issue_body: "Body.",
    }),
    ghExec,
  });

  assert.equal(out.created_issue_number, "");
});

test("createGitHubIssueFromSpec keeps created issue when label reconciliation hits label_not_found", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2363\n");
    }
    if (args.includes("docs")) {
      return {
        ok: false,
        status: 1,
        stdout: "",
        stderr: "could not add label: 'docs' not found\n",
      };
    }
    return successfulCommandResult();
  };

  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueSpecRaw: JSON.stringify({
      issue_title: "Test issue",
      issue_body: "Body.",
      issue_labels: "feature,docs",
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.issue_url, "https://github.com/recallnet/astrochicken/issues/2363");
  assert.equal(out.created_issue_number, "2363");
  assert.deepEqual(out.applied_labels, ["feature"]);
  assert.deepEqual(out.rejected_labels, ["docs"]);
  assert.match(out.stderr, /could not add label/i);
});

test("createGitHubIssueFromSpec emits canonical issue_created event from the command owner", () => {
  const emitted = [];
  const ghExec = (args) => {
    if (args[0] === "issue" && args[1] === "create") {
      return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2411\n");
    }
    return successfulCommandResult();
  };

  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    runId: "run-2411",
    issueSpecRaw: JSON.stringify({
      issue_title: "Create issue",
      issue_body: "Body.",
      issue_labels: "feature,ready",
    }),
    ghExec,
    emitDomainEventFn: (event) => emitted.push(event),
    appendCanonicalEventsFn: () => 41,
  });

  assert.equal(out.ok, true);
  assert.equal(out.canonical_events.length, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event_family, "factory.issue.created");
  assert.equal(emitted[0].factory_id, "mothership");
  assert.equal(emitted[0].run_id, "run-2411");
  assert.equal(emitted[0].payload.issue_number, "2411");
  assert.deepEqual(emitted[0].payload.applied_labels, ["feature", "ready"]);
});

test("createGitHubIssueFromSpec forwards projection receipt events through the adapter boundary", () => {
  const emitted = [];
  const ghExec = (args) => {
    if (args[0] === "issue" && args[1] === "create") {
      return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2501\n");
    }
    return successfulCommandResult();
  };

  createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    runId: "run-2501",
    issueSpecRaw: JSON.stringify({
      issue_title: "Create issue",
      issue_body: "Body.",
      issue_labels: "feature,ready",
    }),
    ghExec,
    emitCanonicalEventFn: (event) => emitted.push(event),
    appendCanonicalEventsFn: () => 42,
  });

  assert.deepEqual(
    emitted.map((event) => event.event_family),
    ["github.projection.receipt", "github.projection.receipt", "github.projection.receipt"],
  );
  assert.deepEqual(
    emitted.map((event) => event.payload.operation),
    ["issue_create", "issue_edit", "issue_edit"],
  );
});

test("createGitHubIssueFromSpec forwards explicit mutation audit context through the shared projection owner", () => {
  const auditRoot = mkdtempSync(path.join(tmpdir(), "common-create-issue-audit-"));
  try {
    const auditCalls = [];
    const canonicalAppendCalls = [];
    const out = createGitHubIssueFromSpec({
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      runId: "run-2600",
      issueSpecRaw: JSON.stringify({
        issue_title: "Create issue",
        issue_body: "Body.",
      }),
      mutationContext: {
        instance_id: "mothership",
        installation_id: "inst_mothership_host_a",
        host_id: "host_mothership_a",
        run_id: "run-2600",
        tick_id: "tick-2600",
        destination_name: "github",
        capability_version: "capability.issue.create.v1",
        policy_profile: "policy.default",
        runtime_version: "runtime.test",
      },
      ghExec: (args) => {
        if (args[0] === "issue" && args[1] === "create") {
          return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2600\n");
        }
        return successfulCommandResult();
      },
      appendAuditRecordFn: (record) => {
        auditCalls.push(record);
        return { ok: true };
      },
      appendCanonicalEventsFn: (args) => {
        canonicalAppendCalls.push(args);
        return 43;
      },
      auditHostBaseDir: auditRoot,
    });

    assert.equal(out.ok, true);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, "issue_create");
    assert.equal(auditCalls[0].installation_id, "inst_mothership_host_a");
    assert.equal(auditCalls[0].target_ref, "issues/2600");
    assert.equal(canonicalAppendCalls.length, 1);
    assert.equal(canonicalAppendCalls[0].context.factory_id, "mothership");
    assert.equal(out.canonical_event_commit_cursor, 43);
    const createdEvent = canonicalAppendCalls[0].events.find((event) => event.event_family === "factory.issue.created");
    assert.equal(createdEvent?.payload.issue_number, "2600");
  } finally {
    rmSync(auditRoot, { recursive: true, force: true });
  }
});

test("createGitHubIssueFromSpec degrades canonical append lock timeouts after successful issue creation", () => {
  const out = createGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    runId: "run-2601",
    issueSpecRaw: JSON.stringify({
      issue_title: "Create issue",
      issue_body: "Body.",
      issue_labels: "feature,ready",
    }),
    ghExec: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2601\n");
      }
      return successfulCommandResult();
    },
    appendCanonicalEventsFn: () => {
      const error = new Error("canceling statement due to lock timeout");
      error.code = "55P03";
      throw error;
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.issue_url, "https://github.com/recallnet/astrochicken/issues/2601");
  assert.equal(out.created_issue_number, "2601");
  assert.equal(out.canonical_event_commit_cursor, 0);
  assert.equal(out.canonical_event_persistence_deferred, true);
  assert.match(out.stderr, /canonical_event_append_deferred: canceling statement due to lock timeout/i);
});

test("updateGitHubIssueFromSpec edits existing issue from stdin-safe spec payload", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return successfulCommandResult();
  };

  const out = updateGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueUrl: "https://github.com/recallnet/astrochicken/issues/1937",
    issueSpecRaw: JSON.stringify({
      issue_title: "Implement semantic triage",
      issue_body: "Do the improved thing.",
      issue_labels: "feature,ready",
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.issue_url, "https://github.com/recallnet/astrochicken/issues/1937");
  assert.deepEqual(calls[0], [
    "issue", "edit", "1937", "--repo", "recallnet/astrochicken",
    "--title", "Implement semantic triage",
    "--body", "Do the improved thing.",
  ]);
  assert.deepEqual(calls[1], [
    "issue", "edit", "1937", "--repo", "recallnet/astrochicken",
    "--add-label", "feature",
  ]);
  assert.deepEqual(calls[2], [
    "issue", "edit", "1937", "--repo", "recallnet/astrochicken",
    "--add-label", "ready",
  ]);
});

test("updateGitHubIssueFromSpec tolerates missing labels after successful body edit", () => {
  const ghExec = (args) => {
    if (args[0] === "issue" && args[1] === "edit" && args.includes("--title")) {
      return successfulCommandResult();
    }
    if (args.includes("docs")) {
      return { ok: false, status: 1, stdout: "", stderr: "could not add label: 'docs' not found\n" };
    }
    return successfulCommandResult();
  };

  const out = updateGitHubIssueFromSpec({
    repo: "recallnet/astrochicken",
    issueUrl: "https://github.com/recallnet/astrochicken/issues/1937",
    issueSpecRaw: JSON.stringify({
      issue_title: "Implement semantic triage",
      issue_body: "Do the improved thing.",
      issue_labels: "feature,docs",
    }),
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.applied_labels, ["feature"]);
  assert.deepEqual(out.rejected_labels, ["docs"]);
  assert.match(out.stderr, /could not add label/i);
});
