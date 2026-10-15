import { createRecordingGhFixture, runRecordingOpsCli as runCli, readGhCalls as readCalls } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import test from "node:test";

function makeGhStub() {
  return createRecordingGhFixture("research-approval-label-gh-", `if (args[0] === "issue" && args[1] === "edit") {
  if (mode === "label_not_found") {
    process.stderr.write("could not add label: label not found");
    process.exit(1);
  }
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  process.exit(0);
}

process.exit(0);
`);
}

test("research set-approval-label applies approved label and posts context comment", () => {
  const stub = makeGhStub("ok");
  try {
    const payload = runCli([
      "research",
      "set-approval-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--approved",
      "true",
      "--approval-context",
      '{"stage_id":"backtesting"}',
    ], { ...stub, mode: "ok", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.code, "ok");
    assert.equal(payload.label, "research:approval/approved");
    assert.equal(payload.comment_posted, true);

    const calls = readCalls(stub.statePath);
    const editCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "edit") || [];
    const commentCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "comment") || [];
    assert.ok(editCall.includes("--add-label"));
    assert.ok(editCall.includes("research:approval/approved"));
    assert.ok(commentCall.includes("--body"));
    const body = commentCall[commentCall.indexOf("--body") + 1] || "";
    assert.match(body, /<!-- research-approval-context -->/);
  } finally {
    stub.cleanup();
  }
});

test("research set-approval-label returns label_not_found when label is missing", () => {
  const stub = makeGhStub("label_not_found");
  try {
    const payload = runCli([
      "research",
      "set-approval-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--approved",
      "true",
      "--approval-context",
      '{"stage_id":"backtesting"}',
    ], { ...stub, mode: "label_not_found", expectedStatus: 1 });

    assert.equal(payload.ok, false);
    assert.equal(payload.code, "label_not_found");
    assert.equal(payload.label, "research:approval/approved");
  } finally {
    stub.cleanup();
  }
});
