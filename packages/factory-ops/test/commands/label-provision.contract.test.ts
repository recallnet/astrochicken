import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildManagedFactoryLabelProvisionPlan,
  buildManagedFactoryLabelSnapshot,
  provisionManagedFactoryLabels,
} from "../../src/lib/factory-label-contract.ts";
import { runLabelProvision } from "../../src/commands/label-provision.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("buildManagedFactoryLabelProvisionPlan returns deterministic example-notes operations", () => {
  const plan = buildManagedFactoryLabelProvisionPlan({
    kindId: "example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.equal(plan.kind_id, "example-notes");
  assert.equal(plan.control_plane_repo, "recallnet/astrochicken");
  assert.equal(plan.target_repo, "example-org/example-notes");

  const controlPlaneLabels = plan.operations
    .filter((entry) => entry.scope === "control_plane")
    .map((entry) => entry.label)
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(controlPlaneLabels, ["kind:example-notes", "managed-factory-bug"]);

  const homeLabels = plan.operations
    .filter((entry) => entry.scope === "home")
    .map((entry) => entry.label)
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(homeLabels, [
    "hatch:blocked",
    "hatch:done",
    "hatch:in-progress",
    "hatch:intake",
    "hatch:queued",
  ]);
});

test("provisionManagedFactoryLabels dry-run returns planned operations without executing gh", () => {
  const calls = [];
  const result = provisionManagedFactoryLabels({
    kindId: "example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    dryRun: true,
    ghExec: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
    authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(calls.length, 0);
  assert.equal(result.operations.length, 7);
  assert.deepEqual(
    result.operations.map((entry) => entry.scope),
    ["control_plane", "control_plane", "home", "home", "home", "home", "home"],
  );
});

test("provisionManagedFactoryLabels executes label create args for both repos", () => {
  const calls = [];
  const result = provisionManagedFactoryLabels({
    kindId: "example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    dryRun: false,
    ghExec: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
    authCheck: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.operations.length, 7);
  assert.equal(calls.length, 7);
  assert.ok(calls.every((args) => args.includes("--force")));
  assert.ok(calls.some((args) => args.includes("kind:example-notes")));
  assert.ok(calls.some((args) => args.includes("managed-factory-bug")));
  assert.ok(calls.some((args) => args.includes("hatch:intake")));
});

test("provisionManagedFactoryLabels fails closed when gh auth is missing", () => {
  const result = provisionManagedFactoryLabels({
    kindId: "example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    dryRun: false,
    authCheck: () => ({ status: 1, stderr: "not logged in" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_github_auth");
  assert.equal(result.operations.length, 0);
});

test("provisionManagedFactoryLabels fails closed on boundary mismatch", () => {
  assert.throws(
    () => provisionManagedFactoryLabels({
      kindId: "example-notes",
      targetRepo: "example-org/not-example-notes",
      controlPlaneRepo: "recallnet/astrochicken",
      dryRun: true,
      authCheck: () => ({ status: 0 }),
    }),
    /target_repo_boundary_mismatch/,
  );
});

test("runLabelProvision delegates command inputs to managed label provisioner", () => {
  const result = runLabelProvision({
    factoryKind: "example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    dryRun: true,
    authCheck: () => ({ status: 0 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind_id, "example-notes");
  assert.equal(result.operations.length, 7);
});

test("managed label snapshot publishes example-notes scope contract", () => {
  const snapshot = buildManagedFactoryLabelSnapshot();
  const exampleNotes = (snapshot.kinds || []).find((entry) => entry.kind_id === "example-notes");
  assert.ok(exampleNotes, "example-notes kind entry must exist");

  const controlPlaneNames = (exampleNotes.control_plane_labels || []).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(controlPlaneNames, ["kind:example-notes", "managed-factory-bug"]);

  const homeNames = (exampleNotes.home_labels || []).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(homeNames, [
    "hatch:blocked",
    "hatch:done",
    "hatch:in-progress",
    "hatch:intake",
    "hatch:queued",
  ]);
});

test("label-provision CLI dry-run supports example-notes managed contract path", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "label-provision",
    "--factory-kind",
    "example-notes",
    "--home-repo",
    "example-org/example-notes",
    "--control-plane-repo",
    "recallnet/astrochicken",
    "--dry-run",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(String(run.stdout || "{}").trim() || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.kind_id, "example-notes");
  assert.equal(Array.isArray(payload.operations), true);
  assert.equal(payload.operations.length, 7);
});
