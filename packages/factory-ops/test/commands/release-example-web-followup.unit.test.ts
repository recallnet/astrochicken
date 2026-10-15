import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXAMPLE_WEB_COMPREHENSION_LABEL,
  EXAMPLE_WEB_COMPREHENSION_LABEL_COLOR,
  EXAMPLE_WEB_COMPREHENSION_LABEL_DESCRIPTION,
  EXAMPLE_WEB_CURSOR_RELATIVE_PATH,
  EXAMPLE_WEB_CURSOR_SCHEMA,
  EXAMPLE_WEB_REPO,
  buildReleaseShapingFollowupIssueBody,
  buildReleaseShapingFollowupIssueTitle,
  runReleaseShapingFollowup,
} from "../../src/commands/release-example-web-followup.ts";

function makeContext(overrides = {}) {
  return {
    generated_at: "2026-03-19T03:50:41.548Z",
    since_iso: "2026-03-19T00:00:00.000Z",
    factory_id: "mothership",
    repo: "recallnet/astrochicken",
    diff_stats: { text: "+210 -45" },
    metrics: {
      goals_closed: 2,
      issues_closed: 5,
      commits_landed: 7,
    },
    report_issue_url: "https://github.com/recallnet/astrochicken/issues/4000",
    ...overrides,
  };
}

function makeNarrative(overrides = {}) {
  return {
    headline: "Comprehension signals now ship with release windows",
    summary: "Release reporting now emits comprehension payloads for Studio-oriented consumption.",
    structural_changes: [
      "release_report_flow now includes deterministic example-web follow-up issuance",
    ],
    behavioral_shifts: [
      "Each understanding-worthy window now produces a example-web contract artifact",
    ],
    implicit_decisions: [
      "Cursor deduplication relies on generated_at as canonical release window identity",
    ],
    entry_points: [
      "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
      "packages/factory-ops/src/commands/release-example-web-followup.ts",
    ],
    proof_points: [
      "Comprehension payload now includes structural/behavioral/debt fields",
    ],
    watch_items: [
      "generated_at collisions across reruns should remain idempotent",
    ],
    slack_permalink: "https://slack.test/thread/123",
    ...overrides,
  };
}

test("example-web follow-up exports keep deterministic title + label color contract", () => {
  const title = buildReleaseShapingFollowupIssueTitle({
    context: { generated_at: "2026-03-19T03:50:41.548Z" },
  });
  assert.equal(title, "Comprehension UI contract — 2026-03-19T03:50:41.548Z");
  assert.equal(EXAMPLE_WEB_COMPREHENSION_LABEL_COLOR, "5319e7");
});

test("runReleaseShapingFollowup creates issue + cursor when no prior cursor exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-example-web-followup-create-"));
  const calls = [];

  try {
    const out = await runReleaseShapingFollowup({
      context: makeContext(),
      narrative: makeNarrative(),
      factoryId: "mothership",
      repoPath: root,
      ghFn(args) {
        calls.push(args);
        if (args[0] === "label" && args[1] === "create") {
          return { ok: true, stdout: "", stderr: "" };
        }
        if (args[0] === "issue" && args[1] === "create") {
          return { ok: true, stdout: "https://github.com/example-org/example-web/issues/811\n", stderr: "" };
        }
        return { ok: false, stdout: "", stderr: `unexpected:${args.join(" ")}` };
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "published");
    assert.equal(out.action, "created");
    assert.equal(out.issue_number, 811);
    assert.equal(out.target_repo, EXAMPLE_WEB_REPO);
    assert.equal(out.label, EXAMPLE_WEB_COMPREHENSION_LABEL);

    const labelCall = calls.find((args) => args[0] === "label" && args[1] === "create");
    assert.ok(labelCall, "label create call must be present");
    assert.ok(labelCall.includes(EXAMPLE_WEB_COMPREHENSION_LABEL));
    assert.ok(labelCall.includes(EXAMPLE_WEB_COMPREHENSION_LABEL_DESCRIPTION));

    const cursorPath = join(root, EXAMPLE_WEB_CURSOR_RELATIVE_PATH);
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
    assert.equal(cursor.schema, EXAMPLE_WEB_CURSOR_SCHEMA);
    assert.equal(cursor.generated_at, "2026-03-19T03:50:41.548Z");
    assert.equal(cursor.issue_number, 811);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runReleaseShapingFollowup edits existing cursor issue when generated_at matches", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-example-web-followup-edit-"));
  const cursorPath = join(root, EXAMPLE_WEB_CURSOR_RELATIVE_PATH);
  const calls = [];

  try {
    mkdirSync(join(root, ".factory", "state"), { recursive: true });
    writeFileSync(cursorPath, `${JSON.stringify({
      schema: EXAMPLE_WEB_CURSOR_SCHEMA,
      generated_at: "2026-03-19T03:50:41.548Z",
      issue_number: 77,
      issue_url: "https://github.com/example-org/example-web/issues/77",
      updated_at: "2026-03-19T03:51:00.000Z",
    }, null, 2)}\n`, "utf8");

    const out = await runReleaseShapingFollowup({
      context: makeContext(),
      narrative: makeNarrative(),
      repoPath: root,
      ghFn(args) {
        calls.push(args);
        if (args[0] === "label" && args[1] === "create") {
          return { ok: true, stdout: "", stderr: "" };
        }
        if (args[0] === "issue" && args[1] === "edit") {
          return { ok: true, stdout: "", stderr: "" };
        }
        if (args[0] === "issue" && args[1] === "create") {
          return { ok: false, stdout: "", stderr: "create must not be called" };
        }
        return { ok: false, stdout: "", stderr: `unexpected:${args.join(" ")}` };
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "published");
    assert.equal(out.action, "updated");
    assert.equal(out.issue_number, 77);

    assert.ok(calls.some((args) => args[0] === "issue" && args[1] === "edit" && args.includes("77")));
    assert.ok(!calls.some((args) => args[0] === "issue" && args[1] === "create"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReleaseShapingFollowupIssueBody includes required sections and payload schema sample", () => {
  const body = buildReleaseShapingFollowupIssueBody({
    context: makeContext(),
    narrative: makeNarrative(),
    factoryId: "mothership",
  });

  assert.match(body, /^# Comprehension signals now ship with release windows/m);
  assert.match(body, /## Orientation/);
  assert.match(body, /## Structural & Behavioral Signals/);
  assert.match(body, /### Entry points/);
  assert.match(body, /packages\/capability-release-reporting\/workflows\/release_report_flow\/release_report_flow\.workflow-source\.mjs/);
  assert.match(body, /Comprehension payload now includes structural\/behavioral\/debt fields/);
  assert.match(body, /## Payload Contract/);
  assert.match(body, /"structural_changes"/);
  assert.match(body, /"behavioral_shifts"/);
  assert.match(body, /"implicit_decisions"/);
  assert.match(body, /"entry_points"/);
  assert.match(body, /"comprehension_debt_signals"/);
  assert.match(body, /## Delivery Links/);
});

test("runReleaseShapingFollowup is fail-open on gh and cursor failures", async () => {
  const warnings = [];

  const out = await runReleaseShapingFollowup({
    context: makeContext(),
    narrative: makeNarrative(),
    repoPath: "/tmp/nonexistent",
    warnFn(message) {
      warnings.push(String(message || ""));
    },
    fs: {
      async readFile() {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      },
      async mkdir() {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      },
      async writeFile() {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      },
    },
    ghFn(args) {
      if (args[0] === "label" && args[1] === "create") {
        return { ok: false, stdout: "", stderr: "label create denied" };
      }
      if (args[0] === "issue" && args[1] === "create") {
        return { ok: false, stdout: "", stderr: "issue create denied" };
      }
      return { ok: false, stdout: "", stderr: "unexpected" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.status, "best_effort_failed");
  assert.equal(out.action, "create_failed");
  assert.equal(out.issue_number, 0);
  assert.ok(Array.isArray(out.warnings));
  assert.ok(out.warnings.some((warning) => /gh_label_ensure_failed/.test(warning)));
  assert.ok(out.warnings.some((warning) => /cursor_read_failed/.test(warning)));
  assert.equal(warnings.length, out.warnings.length);
});
