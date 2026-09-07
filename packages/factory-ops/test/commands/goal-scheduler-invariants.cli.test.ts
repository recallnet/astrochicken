import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeStatefulGhStub({ issues = [], milestones = [], subIssues = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "goal-scheduler-gh-"));
  const statePath = join(root, "state.json");
  const ghPath = join(root, "gh");

  writeFileSync(
    statePath,
    JSON.stringify({
      issues,
      milestones,
      blockedBy: {},
      subIssues,
    }, null, 2),
    "utf8",
  );

  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const statePath = process.env.HATCH_TEST_GH_STATE_PATH;
const args = process.argv.slice(2);

function readState() {
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function flagValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
}

function hasFlag(flag) {
  return args.includes(flag);
}

function issueJsonShape(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: (issue.labels || []).map((name) => ({ name })),
    milestone: issue.milestone ? { title: issue.milestone } : null,
    comments: issue.comments || [],
  };
}

if (args[0] === "label" && args[1] === "create") {
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit") {
  const state = readState();
  const issueNumber = Number(args[2]);
  const issue = state.issues.find((entry) => entry.number === issueNumber);
  if (!issue) process.exit(1);
  const addLabel = flagValue("--add-label");
  const removeLabel = flagValue("--remove-label");
  if (addLabel && !(issue.labels || []).includes(addLabel)) issue.labels.push(addLabel);
  if (removeLabel) issue.labels = (issue.labels || []).filter((label) => label !== removeLabel);
  writeState(state);
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  const state = readState();
  const issueNumber = Number(args[2]);
  const issue = state.issues.find((entry) => entry.number === issueNumber);
  if (!issue) process.exit(1);
  const body = flagValue("--body");
  issue.comments = issue.comments || [];
  issue.comments.push({ body, createdAt: "2026-03-10T00:00:00Z" });
  writeState(state);
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "list") {
  const state = readState();
  const wantedState = String(flagValue("--state") || "open").toUpperCase();
  const wantedLabel = flagValue("--label");
  const wantedMilestone = flagValue("--milestone");
  const rawSearch = flagValue("--search");
  const search = rawSearch.replace(/^"/, "").replace(/"\\s+in:title$/, "");
  let issues = [...state.issues];
  if (wantedState === "OPEN") issues = issues.filter((issue) => issue.state === "OPEN");
  if (wantedState === "CLOSED") issues = issues.filter((issue) => issue.state === "CLOSED");
  if (wantedLabel) {
    const labels = wantedLabel.split(",");
    issues = issues.filter((issue) => labels.every((label) => (issue.labels || []).includes(label)));
  }
  if (wantedMilestone) issues = issues.filter((issue) => issue.milestone === wantedMilestone);
  if (search) issues = issues.filter((issue) => String(issue.title || "").includes(search));
  process.stdout.write(JSON.stringify(issues.map(issueJsonShape)));
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  const state = readState();
  const queryArg = args.find((entry) => entry.startsWith("query=")) || "";
  const match = queryArg.match(/issue\\(number:(\\d+)\\)/);
  const issueNumber = match ? Number(match[1]) : 0;
  const nodes = state.blockedBy[String(issueNumber)] || [];
  process.stdout.write(JSON.stringify({
    data: {
      repository: {
        issue: {
          blockedBy: {
            nodes,
          },
        },
      },
    },
  }));
  process.exit(0);
}

if (args[0] === "api" && args[1] && args[1].includes("/milestones")) {
  const state = readState();
  process.stdout.write(JSON.stringify(state.milestones));
  process.exit(0);
}

if (args[0] === "api" && args[1] && args[1].includes("/sub_issues")) {
  const state = readState();
  const match = args[1].match(/\\/issues\\/(\\d+)\\/sub_issues/);
  const issueNumber = match ? Number(match[1]) : 0;
  const subIssues = (state.subIssues || {})[String(issueNumber)] || [];
  process.stdout.write(JSON.stringify(subIssues));
  process.exit(0);
}

process.stdout.write("[]");
`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);

  return {
    binDir: root,
    ghPath,
    statePath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function readStubState(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeStubState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function runGoalCli(args, { binDir, statePath }) {
  return spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_TEST_GH_STATE_PATH: statePath,
      MOTHERSHIP_REPO: "recallnet/astrochicken",
    },
  });
}

test("exhausted goals leave the ready queue until an explicit requeue re-adds ready", () => {
  const stub = makeStatefulGhStub({
    issues: [
      {
        number: 101,
        title: "Goal: recover example-trading parity",
        state: "OPEN",
        labels: ["goal", "ready"],
        milestone: null,
        comments: [],
      },
    ],
  });

  try {
    const before = runGoalCli(["goal", "list-ready", "--repo", "recallnet/astrochicken"], stub);
    assert.equal(before.status, 0, before.stderr || before.stdout);
    const [initialGoal] = JSON.parse(before.stdout);
    assert.equal(initialGoal.number, 101);
    assert.equal(initialGoal.title, "Goal: recover example-trading parity");
    assert.equal(initialGoal.state, "OPEN");
    assert.deepEqual(initialGoal.labels, [{ name: "goal" }, { name: "ready" }]);
    assert.equal(initialGoal.milestone, null);
    assert.deepEqual(initialGoal.blocked_by, []);
    assert.equal(initialGoal.blocked, false);
    assert.equal(initialGoal.is_bug, false);

    const exhausted = runGoalCli([
      "goal",
      "exhaust-decompose-retries",
      "--repo", "recallnet/astrochicken",
      "--issue-number", "101",
      "--decompose-retry-count", "3",
    ], stub);
    assert.equal(exhausted.status, 0, exhausted.stderr || exhausted.stdout);

    const afterExhaust = runGoalCli(["goal", "list-ready", "--repo", "recallnet/astrochicken"], stub);
    assert.equal(afterExhaust.status, 0, afterExhaust.stderr || afterExhaust.stdout);
    assert.deepEqual(JSON.parse(afterExhaust.stdout).map((goal) => goal.number), [101]);

    const exhaustedState = readStubState(stub.statePath);
    const exhaustedIssue = exhaustedState.issues.find((issue) => issue.number === 101);
    assert.ok(exhaustedIssue.labels.includes("ready"));
    assert.ok(exhaustedIssue.comments.some((comment) => String(comment.body || "").includes("goal-run:decompose-exhausted")));
  } finally {
    stub.cleanup();
  }
});

test("limit-kept CLI enforces max_goal_runs_per_tick on a recovered backlog", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "goal",
    "limit-kept",
    "--kept-goals", JSON.stringify([201, 202, 203, 204, 205]),
    "--max-goals-per-tick", "3",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(JSON.parse(run.stdout), [201, 202, 203]);
});

test("decompose-backpressure CLI blocks fresh goal intake when executable goals fill wave capacity", () => {
  const stub = makeStatefulGhStub({
    issues: [
      { number: 10, title: "Goal: alpha", state: "OPEN", labels: ["goal", "ready"], comments: [] },
      { number: 11, title: "Goal: beta", state: "OPEN", labels: ["goal", "ready"], comments: [] },
      { number: 12, title: "Goal: gamma", state: "OPEN", labels: ["goal", "ready"], comments: [] },
    ],
    subIssues: {
      "10": [{ number: 301, state: "OPEN", title: "Feature: alpha-1" }],
      "11": [{ number: 302, state: "OPEN", title: "Feature: beta-1" }],
      "12": [{ number: 303, state: "OPEN", title: "Feature: gamma-1" }],
    },
  });

  try {
    const run = runGoalCli([
      "goal",
      "decompose-backpressure",
      "--repo", "recallnet/astrochicken",
      "--max-concurrent-goals", "3",
    ], stub);

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.deepEqual(JSON.parse(run.stdout), {
      decompose_allowed: "false",
      decompose_skip_reason: "goal_execution_backlog_at_or_above_capacity",
      executable_goal_count: 3,
      max_concurrent_goals: 3,
    });
  } finally {
    stub.cleanup();
  }
});
