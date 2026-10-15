import { createRecordingGhFixture, runRecordingOpsCli as runCli, readGhCalls as readCalls } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import test from "node:test";

function makeGhStub() {
  return createRecordingGhFixture("common-create-issue-gh-", `if (args[0] === "issue" && args[1] === "create") {
  process.stdout.write("https://github.com/recallnet/astrochicken/issues/2363\\n");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit" && args.includes("--add-label")) {
  const label = args[args.indexOf("--add-label") + 1] || "";
  if (mode === "missing_docs_label" && label === "docs") {
    process.stderr.write("could not add label: 'docs' not found\\n");
    process.exit(1);
  }
  process.exit(0);
}

process.exit(0);
`);
}

test("common create-issue exits successfully when optional label reconciliation hits label_not_found", () => {
  const stub = makeGhStub("missing_docs_label");
  try {
    const payload = runCli([
      "common",
      "create-issue",
      "--repo",
      "recallnet/astrochicken",
      "--issue-spec",
      JSON.stringify({
        issue_title: "Document canonical Hatch graph transition and convergence contract",
        issue_body: "Body.",
        issue_labels: "feature,docs",
      }),
    ], { ...stub, mode: "missing_docs_label", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.issue_url, "https://github.com/recallnet/astrochicken/issues/2363");
    assert.equal(payload.created_issue_number, "2363");
    assert.deepEqual(payload.applied_labels, ["feature"]);
    assert.deepEqual(payload.rejected_labels, ["docs"]);

    const calls = readCalls(stub.statePath);
    assert.deepEqual(calls[0], [
      "issue", "create", "--repo", "recallnet/astrochicken",
      "--title", "Document canonical Hatch graph transition and convergence contract",
      "--body", "Body.",
    ]);
  } finally {
    stub.cleanup();
  }
});
