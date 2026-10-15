import { createRecordingGhFixture, runRecordingOpsCli as runCli, readGhCalls as readCalls } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { join } from "node:path";
import test from "node:test";

function makeGhStub() {
  return createRecordingGhFixture("research-stage-label-gh-", `if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ labels: [{ name: "research:stage/hypothesis_formulation" }] }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit") {
  if (mode === "label_not_found" && args.includes("--add-label")) {
    process.stderr.write("could not add label: 'research:stage/backtesting' not found");
    process.exit(1);
  }
  process.exit(0);
}

process.exit(0);
`);
}

test("research set-stage-label applies stage label via gh issue edit", () => {
  const stub = makeGhStub("ok");
  try {
    const payload = runCli([
      "research",
      "set-stage-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--stage",
      "backtesting",
    ], { ...stub, mode: "ok", expectedStatus: 0 });

    assert.equal(payload.ok, true);
    assert.equal(payload.code, "ok");
    assert.equal(payload.stage, "backtesting");
    assert.equal(payload.label, "research:stage/backtesting");

    const calls = readCalls(stub.statePath).map((args) => args.join(" "));
    assert.ok(calls.some((line) => line.includes("issue edit 1 --repo example-org/example-research --add-label research:stage/backtesting")));
  } finally {
    stub.cleanup();
  }
});

test("research set-stage-label returns label_not_found without throwing", () => {
  const stub = makeGhStub("label_not_found");
  try {
    const payload = runCli([
      "research",
      "set-stage-label",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--stage",
      "backtesting",
    ], { ...stub, mode: "label_not_found", expectedStatus: 1 });

    assert.equal(payload.ok, false);
    assert.equal(payload.code, "label_not_found");
    assert.equal(payload.stage, "backtesting");
    assert.equal(payload.label, "research:stage/backtesting");
  } finally {
    stub.cleanup();
  }
});
