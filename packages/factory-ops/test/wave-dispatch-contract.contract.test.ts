import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function b64Json(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("wave_dispatch uses shell-safe payload transport and no parent run-id lookup", () => {
  const dot = readFileSync(join(repoRoot, "docs/contracts/workflow-ir/mothership/wave_dispatch.dot"), "utf8");

  assert.match(dot, /output_key="milestones_b64"/);
  assert.match(dot, /output_key="ready_issues_b64"/);
  assert.match(dot, /output_key="priorities_issue_b64"/);
  assert.match(dot, /list_milestones\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="wave.list_milestones_b64"/);
  assert.match(dot, /list_ready_issues\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="wave.list_ready_issues_b64"/);
  assert.match(dot, /list_priorities\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="wave.list_priorities_b64"/);
  assert.match(dot, /decide[^]*action_id="wave.dispatch_select"/);
  assert.match(dot, /action_milestones_b64="\$\{milestones_b64\}"/);
  assert.match(dot, /action_ready_issues_b64="\$\{ready_issues_b64\}"/);
  assert.match(dot, /action_priorities_issue_b64="\$\{priorities_issue_b64\}"/);
  assert.doesNotMatch(dot, /dispatch-select[^\n]*--run-id/);
  assert.match(dot, /create_ready[^]*action_id="wave.create_ready_markers"/);
  assert.match(dot, /action_selected_waves="\$\{selected_waves\}"/);
  assert.doesNotMatch(dot, /create-ready[^\n]*--run-id/);
});

test("wave_dispatch leases execution lane before mutating ready markers", () => {
  const dot = readFileSync(join(repoRoot, "docs/contracts/workflow-ir/mothership/wave_dispatch.dot"), "utf8");
  assert.match(dot, /set_factory_lease_seconds[^]*action_id="common.resolve_default"/);
  assert.match(dot, /action_value="\$\{factory_lease_seconds\}"/);
  assert.match(dot, /action_fallback="600"/);
  assert.match(dot, /acquire_dispatch_lease[^]*action_id="factory.acquire_lease"/);
  assert.match(dot, /action_lease_name="wave_dispatch"/);
  assert.match(dot, /action_lease_seconds="\$\{factory_lease_seconds\}"/);
  assert.match(dot, /outputs="lease_acquired/);
  assert.match(dot, /lease_gate -> done \[condition="lease_acquired!=true"\]/);
  assert.match(dot, /release_dispatch_lease[^]*action_id="factory.release_lease"/);
  assert.match(dot, /action_lease_name="wave_dispatch"/);
  assert.match(dot, /action_holder_id="\$\{lease_holder_id\}"/);
});

test("wave_issue_execute defers merge to wave end after approve", () => {
  const dot = readFileSync(join(repoRoot, "docs/contracts/workflow-ir/mothership/wave_issue_execute.dot"), "utf8");

  // After approve, the pipeline should report approved (no inline merge)
  assert.match(dot, /approve_attempt\s*->\s*bump_approve\s*->\s*report_approved/);
  assert.match(dot, /report_approved\s*->\s*done/);
  // Must NOT have inline merge nodes
  assert.doesNotMatch(dot, /rebase_on_main/);
  assert.doesNotMatch(dot, /attempt_merge/);
  assert.doesNotMatch(dot, /inline_merge_gate/);
  assert.doesNotMatch(dot, /--merged true/);
});

test("wave dispatch/create-ready CLI enforce explicit payload contracts", () => {
  const dispatchMissingPayload = spawnSync("node", [
    opsCliPath,
    "wave",
    "dispatch-select",
    "--repo",
    "recallnet/astrochicken",
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(dispatchMissingPayload.status, 2);
  assert.match(dispatchMissingPayload.stderr, /requires explicit payload inputs/);

  const createMissingPayload = spawnSync("node", [
    opsCliPath,
    "wave",
    "create-ready",
    "--repo",
    "recallnet/astrochicken",
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(createMissingPayload.status, 2);
  assert.match(createMissingPayload.stderr, /requires explicit payload input/);

  const dispatchExplicitPayload = spawnSync("node", [
    opsCliPath,
    "wave",
    "dispatch-select",
    "--repo",
    "recallnet/astrochicken",
    "--max-concurrent",
    "1",
    "--milestones",
    "[]",
    "--ready-issues",
    "[]",
    "--priorities-issue",
    "[]",
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(dispatchExplicitPayload.status, 0);
  assert.deepEqual(JSON.parse(dispatchExplicitPayload.stdout), {
    selected_waves: [],
    selected_count: 0,
    in_flight_count: 0,
    ready_count: 0,
    priorities_text: "",
    max_concurrent: 1,
    candidate_waves: [],
    evaluations: [],
    milestone_issues: [],
    blocked_by: [],
    control_plane_blocked_items: [],
    control_plane_blocked_waves: [],
  });

  const createExplicitPayload = spawnSync("node", [
    opsCliPath,
    "wave",
    "create-ready",
    "--repo",
    "recallnet/astrochicken",
    "--selected-waves",
    "[]",
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(createExplicitPayload.status, 0);
  assert.deepEqual(JSON.parse(createExplicitPayload.stdout), []);
});

test("wave dispatch tick artifact contract includes throughput invariants block", () => {
  const tickSnapshot = JSON.parse(readFileSync(
    join(repoRoot, "packages/factory-ops/test/snapshots/wave-dispatch-select/tick.expected.json"),
    "utf8",
  ));

  assert.equal(typeof tickSnapshot.throughput_invariants, "object");
  assert.equal(typeof tickSnapshot.throughput_invariants.idle_with_runnable_backlog, "boolean");
  assert.equal(typeof tickSnapshot.throughput_invariants.refill_latency, "object");
  assert.equal(typeof tickSnapshot.throughput_invariants.duplicate_claims, "object");
});

test("wave (run --op )?dispatch-select base64 payload path tolerates apostrophes and newlines", () => {
  const prioritiesBody = "Today's priorities:\n- don't break wave dispatch";
  const prioritiesIssue = [{ number: 999, title: "Priorities", body: prioritiesBody }];

  const dispatchB64Payload = spawnSync("node", [
    opsCliPath,
    "wave",
    "dispatch-select",
    "--repo",
    "recallnet/astrochicken",
    "--max-concurrent",
    "1",
    "--milestones-b64",
    b64Json([]),
    "--ready-issues-b64",
    b64Json([]),
    "--priorities-issue-b64",
    b64Json(prioritiesIssue),
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(dispatchB64Payload.status, 0);
  const out = JSON.parse(dispatchB64Payload.stdout);
  assert.equal(out.priorities_text, prioritiesBody);
  assert.deepEqual(out.selected_waves, []);
});
