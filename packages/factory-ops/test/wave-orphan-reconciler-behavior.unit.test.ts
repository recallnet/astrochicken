import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWaveOrphanStateRepair,
  collectActiveWaveLeases,
  planWaveOrphanStateRepair,
} from "../src/commands/wave-sanitize-state.ts";
import { blockReadyWaveIssue } from "../src/commands/wave-block-ready.ts";

function issue(number, title, labels = [], milestone = "", body = "") {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    milestone: milestone ? { title: milestone } : null,
    body,
    state: "OPEN",
  };
}

function createGhIssueStub(initialIssues) {
  const byNumber = new Map(initialIssues.map((i) => [Number(i.number), structuredClone(i)]));

  function editIssue(issue, args) {
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--add-label") {
        const name = String(args[i + 1] || "").trim();
        if (!name) continue;
        const labels = Array.isArray(issue.labels) ? issue.labels : [];
        if (!labels.some((l) => String(l?.name || "") === name)) labels.push({ name });
        issue.labels = labels;
      }
      if (args[i] === "--remove-label") {
        const name = String(args[i + 1] || "").trim();
        if (!name) continue;
        issue.labels = (Array.isArray(issue.labels) ? issue.labels : []).filter((l) => String(l?.name || "") !== name);
      }
    }
  }

  const execGh = (args) => {
    if (!Array.isArray(args) || args[0] !== "issue") return { ok: false };
    const command = String(args[1] || "");
    const number = Number(args[2] || 0);
    const issue = byNumber.get(number);
    if (!issue) return { ok: false };

    if (command === "comment") return { ok: true };
    if (command === "close") {
      issue.state = "CLOSED";
      return { ok: true };
    }
    if (command === "edit") {
      editIssue(issue, args);
      return { ok: true };
    }
    return { ok: false };
  };

  const openIssues = () =>
    Array.from(byNumber.values())
      .filter((i) => String(i?.state || "OPEN").toUpperCase() === "OPEN")
      .map((i) => structuredClone(i));

  return { execGh, openIssues };
}

test("orphan-state planner no-ops on clean state", () => {
  const openIssues = [issue(100, "Wave Ready: goal-1-wave-1", ["ready"], "goal-1-wave-1")];
  const leases = collectActiveWaveLeases([], { nowEpochMs: Date.parse("2026-01-01T00:10:00.000Z") });
  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  assert.equal(plan.action_count, 0);
  assert.deepEqual(plan.actions, []);
});

test("sanitizeWaveState dry-run summary includes active lease guard messaging", () => {
  const leases = collectActiveWaveLeases([
    {
      runId: "wave-run-410",
      status: "running",
      pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      updatedAt: "2026-01-01T00:20:00.000Z",
      context: { milestone_title: "goal-4-wave-1" },
    },
  ], { nowEpochMs: Date.parse("2026-01-01T00:25:00.000Z"), staleRunMinutes: 20 });
  const plan = planWaveOrphanStateRepair({ openIssues: [], activeLeases: leases });
  const summary = (plan.action_count === 0)
    ? `Wave orphan-state already clean. Active lease guard: ${leases.active_lease_count} active lease(s) for milestones: ${leases.active_milestones.join(", ") || "(none)"}.`
    : "";

  assert.match(summary, /Active lease guard: 1 active lease\(s\) for milestones: goal-4-wave-1/);
});

test("orphan-state planner deterministically closes duplicate markers", () => {
  const openIssues = [
    issue(201, "Wave Ready: goal-2-wave-1", ["ready"], "goal-2-wave-1"),
    issue(200, "Wave Ready: goal-2-wave-1", ["ready"], "goal-2-wave-1"),
  ];
  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: collectActiveWaveLeases([]) });
  const closeActions = plan.actions.filter((a) => a.type === "close_issue");
  assert.equal(closeActions.length, 1);
  assert.equal(closeActions[0].issue_number, "201");
});

test("orphan-state planner releases stale wave-in-progress marker when no active lease exists", () => {
  const openIssues = [
    issue(300, "Wave Ready: goal-3-wave-1", ["ready", "wave-in-progress"], "goal-3-wave-1"),
  ];
  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: collectActiveWaveLeases([]) });
  assert.equal(
    plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "300" && a.label === "wave-in-progress"),
    true,
  );
});

test("orphan-state planner keeps in-progress marker when active lease exists", () => {
  const openIssues = [
    issue(320, "Wave Ready: goal-3-wave-2", ["ready", "wave-in-progress"], "goal-3-wave-2"),
  ];
  const leases = collectActiveWaveLeases([
    {
      runId: "wave-run-320",
      status: "running",
      pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      updatedAt: "2026-01-01T00:25:00.000Z",
      context: { milestone_title: "goal-3-wave-2", worktree_dir: "/tmp/goal-3-wave-2", ready_issue_number: 320 },
    },
  ], { nowEpochMs: Date.parse("2026-01-01T00:30:00.000Z"), staleRunMinutes: 20 });

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  assert.equal(plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "320"), false);
});

test("orphan-state planner restores in-progress label for lease-owned marker", () => {
  const openIssues = [
    issue(340, "Wave Ready: goal-3-wave-3", ["ready"], "goal-3-wave-3"),
  ];
  const leases = collectActiveWaveLeases([
    {
      runId: "wave-run-340",
      status: "running",
      pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      updatedAt: "2026-01-01T00:25:00.000Z",
      context: { milestone_title: "goal-3-wave-3", worktree_dir: "/tmp/goal-3-wave-3", ready_issue_number: 340 },
    },
  ], { nowEpochMs: Date.parse("2026-01-01T00:30:00.000Z"), staleRunMinutes: 20 });

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "340" && a.label === "wave-in-progress"),
    true,
  );
});

test("orphan-state planner restores lease-owned marker when both labels are missing", () => {
  const openIssues = [
    issue(341, "Wave Ready: goal-3-wave-3a", [], "goal-3-wave-3a"),
  ];
  const activeLeases = {
    active_milestones: ["goal-3-wave-3a"],
    active_leases: [
      {
        milestone_title: "goal-3-wave-3a",
        ready_issue_number: "341",
        run_id: "wave-run-341",
      },
    ],
  };

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases });
  assert.equal(plan.actions.some((a) => a.type === "close_issue" && a.issue_number === "341"), false);
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "341" && a.label === "ready"),
    true,
  );
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "341" && a.label === "wave-in-progress"),
    true,
  );
});

test("orphan-state planner restores in-progress label when active lease omits ready issue number", () => {
  const openIssues = [
    issue(345, "Wave Ready: goal-3-wave-3b", ["ready"], "goal-3-wave-3b"),
  ];
  const leases = collectActiveWaveLeases([
    {
      runId: "wave-run-345",
      status: "running",
      pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      updatedAt: "2026-01-01T00:25:00.000Z",
      context: { milestone_title: "goal-3-wave-3b", worktree_dir: "/tmp/goal-3-wave-3b" },
    },
  ], { nowEpochMs: Date.parse("2026-01-01T00:30:00.000Z"), staleRunMinutes: 20 });

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "345" && a.label === "wave-in-progress"),
    true,
  );
});

test("orphan-state planner keeps lease-owned marker when duplicate markers exist", () => {
  const openIssues = [
    issue(350, "Wave Ready: goal-3-wave-4", ["ready", "wave-in-progress"], "goal-3-wave-4"),
    issue(351, "Wave Ready: goal-3-wave-4", ["ready"], "goal-3-wave-4"),
  ];
  const leases = collectActiveWaveLeases([
    {
      runId: "wave-run-351",
      status: "running",
      pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      updatedAt: "2026-01-01T00:25:00.000Z",
      context: { milestone_title: "goal-3-wave-4", worktree_dir: "/tmp/goal-3-wave-4", ready_issue_number: 351 },
    },
  ], { nowEpochMs: Date.parse("2026-01-01T00:30:00.000Z"), staleRunMinutes: 20 });

  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });
  const closeActions = plan.actions.filter((a) => a.type === "close_issue");
  assert.equal(closeActions.length, 1);
  assert.equal(closeActions[0].issue_number, "350");
  assert.equal(
    plan.actions.some((a) => a.type === "add_label" && a.issue_number === "351" && a.label === "wave-in-progress"),
    true,
  );
});

test("orphan-state planner removes invalid wave-in-progress labels on non-marker issues", () => {
  const openIssues = [
    issue(330, "Feature: unexpected lock label", ["wave-in-progress"], "goal-3-wave-2"),
  ];
  const plan = planWaveOrphanStateRepair({ openIssues, activeLeases: collectActiveWaveLeases([]) });
  assert.equal(
    plan.actions.some((a) => a.type === "remove_label" && a.issue_number === "330" && a.label === "wave-in-progress"),
    true,
  );
});

test("block-ready surfaces lease release failure for deterministic retry", () => {
  const calls = [];
  const out = blockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "430",
    milestoneTitle: "goal-4-wave-3",
    reason: "judge_failed",
    runId: "run-430",
    pipeline: "wave_execute",
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ synced: true, added: 0, removed: 0 }),
    releaseReadyWaveClaimFn: () => ({ ok: false, error: "gh_comment_failed" }),
    execGh: (args) => {
      calls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.failures.includes("lease_release_failed"), true);
  assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "edit").length, 1);
  assert.equal(calls.filter((args) => args[0] === "issue" && args[1] === "comment").length, 1);
});

test("orphan-state apply is idempotent under repeated runs", () => {
  const initial = [
    issue(410, "Wave Ready: goal-4-wave-1", ["ready", "wave-in-progress"], "goal-4-wave-1"),
    issue(411, "Wave Ready: goal-4-wave-1", ["ready"], "goal-4-wave-1"),
    issue(499, "Normal feature", ["ready"], "goal-4-wave-1"),
  ];
  const stub = createGhIssueStub(initial);

  const firstPlan = planWaveOrphanStateRepair({ openIssues: stub.openIssues(), activeLeases: collectActiveWaveLeases([]) });
  assert.equal(firstPlan.action_count > 0, true);

  const firstApply = applyWaveOrphanStateRepair({ repo: "recallnet/astrochicken", plan: firstPlan, execGh: stub.execGh });
  assert.equal(firstApply.ok, true);

  const secondPlan = planWaveOrphanStateRepair({ openIssues: stub.openIssues(), activeLeases: collectActiveWaveLeases([]) });
  assert.equal(secondPlan.action_count, 0);

  const secondApply = applyWaveOrphanStateRepair({ repo: "recallnet/astrochicken", plan: secondPlan, execGh: stub.execGh });
  assert.equal(secondApply.ok, true);
  assert.equal(secondApply.applied_count, 0);
});
