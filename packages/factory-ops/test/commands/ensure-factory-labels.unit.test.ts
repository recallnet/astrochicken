import assert from "node:assert/strict";
import test from "node:test";

import { buildEnsureLabelArgs, ensureFactoryLabels } from "../../src/lib/factory-label-contract.ts";

test("buildEnsureLabelArgs includes --force for idempotent label creation", () => {
  const argSets = buildEnsureLabelArgs({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    keys: ["triaged", "deferred", "blocked_control_plane"],
  });

  assert.ok(argSets.length > 0, "must produce at least one command");
  for (const args of argSets) {
    assert.ok(
      args.includes("--force"),
      `label create args must include --force for idempotent ensure: ${args.join(" ")}`,
    );
  }
});

test("ensureFactoryLabels succeeds when gh label create returns already-exists with --force", () => {
  const calls = [];
  const result = ensureFactoryLabels({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    keys: ["triaged"],
    ghExec: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("--force"), "must pass --force to gh");
});

test("ensureFactoryLabels returns ok=true for all requested keys", () => {
  const result = ensureFactoryLabels({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    keys: ["triaged", "deferred", "blocked_control_plane"],
    ghExec: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.keys, ["triaged", "deferred", "blocked_control_plane"]);
  assert.equal(result.ensured_labels.length, 3);
});
