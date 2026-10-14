import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyGoalExecutionPath,
  transitionGoalExecutionPathPlanningState,
} from "../../../src/commands/goal-execution-path.ts";

export const commandsTestDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(commandsTestDir, "../../../..");
export const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function b64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

export function seedScenario(registryRoot, relPath, options = {}) {
  const fullPath = join(registryRoot, relPath, "SCENARIO.md");
  mkdirSync(dirname(fullPath), { recursive: true });
  const pathParts = relPath.split("/").filter(Boolean);
  const scope = options.scope || pathParts[0] || "scope";
  const domain = options.domain || pathParts[1] || "domain";
  const id = options.id || pathParts[pathParts.length - 1] || "scenario";
  const priority = options.priority || "medium";
  const encoded = `---\nid: ${id}\nscope: ${scope}\ndomain: ${domain}\npriority: ${priority}\n---\n\n# ${relPath}\n`;
  writeFileSync(fullPath, encoded, "utf8");
}

export function writeReviewEvidence({ worktreeDir, issueNumber, qaStatus = "pass", qaCommand = "npm test" }) {
  const evidencePath = join(worktreeDir, ".hatch", "review", `${issueNumber}.json`);
  mkdirSync(join(worktreeDir, ".hatch", "review"), { recursive: true });
  writeFileSync(
    evidencePath,
    `${JSON.stringify({ qa: { status: qaStatus, command: qaCommand } }, null, 2)}\n`,
    "utf8",
  );
  return evidencePath;
}

export function buildWaveJudgeContext(worktreeDir, issueNumber = "420") {
  return [
    {
      issue_number: issueNumber,
      branch: `wave/${issueNumber}`,
      worktree_dir: worktreeDir,
    },
  ];
}

export function assertDeterministicGateFailure({
  validated,
  gatePassKey,
  gateCodeKey,
  expectedCode,
  routeCodeKey = "judge_route_code",
  expectedDisposition = "escalate",
  expectedTransition,
  notesPattern,
  primaryReasonCode,
}) {
  assert.equal(validated[gatePassKey], "false");
  assert.equal(validated[gateCodeKey], expectedCode);
  assert.equal(validated[routeCodeKey], expectedCode);

  if (expectedDisposition) {
    assert.equal(validated.disposition, expectedDisposition);
  }
  if (expectedTransition) {
    assert.equal(validated.recommended_transition, expectedTransition);
  }
  if (notesPattern) {
    assert.match(validated.notes, notesPattern);
  } else if (primaryReasonCode) {
    assert.match(validated.notes, new RegExp(primaryReasonCode));
  }
}

export function parseJsonStdout(stdout) {
  return JSON.parse(String(stdout || "{}").trim() || "{}");
}

export function runOpsCli(args, { cwd = repoRoot, env = process.env } = {}) {
  return spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

export function runOpsCliJson(args, { cwd = repoRoot, env = process.env, expectStatus = 0 } = {}) {
  const run = runOpsCli(args, { cwd, env });
  assert.equal(run.status, expectStatus, run.stderr || run.stdout);
  return parseJsonStdout(run.stdout);
}

export function seedApprovedHardPlanningState({
  packetRepoRoot,
  goalIssueNumber,
  planningArtifactPath,
  factoryId = "mothership",
}) {
  classifyGoalExecutionPath({
    repo: packetRepoRoot,
    goalIssueNumber,
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    planningArtifactPath,
    classifiedBy: "test.seed",
    classificationReason: "seed hard path",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId,
  });

  transitionGoalExecutionPathPlanningState({
    repo: packetRepoRoot,
    goalIssueNumber,
    factoryId,
    nextPlanningState: "pending_review",
    planningArtifactPath,
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({
      decomposition_state: "required",
      planning_state: "not_required",
    }),
    classifiedBy: "test.seed",
    classificationReason: "seed pending review",
    classificationSignalsRaw: JSON.stringify({ test: true, state: "pending_review" }),
  });

  transitionGoalExecutionPathPlanningState({
    repo: packetRepoRoot,
    goalIssueNumber,
    factoryId,
    nextPlanningState: "approved",
    planningArtifactPath,
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({
      decomposition_state: "required",
      planning_state: "pending_review",
      planning_artifact_path: planningArtifactPath,
    }),
    classifiedBy: "test.seed",
    classificationReason: "seed approved state",
    classificationSignalsRaw: JSON.stringify({ test: true, state: "approved" }),
  });
}

export function runGoalMaterializeApprovedPlan({
  packetRepoRoot,
  goalIssueNumber,
  planPacket,
  planningArtifactPath,
  factoryId = "mothership",
  env = {},
}) {
  return runOpsCli([
    "goal",
    "materialize-approved-plan",
    "--repo-root",
    packetRepoRoot,
    "--repo",
    "recallnet/astrochicken",
    "--goal-number",
    goalIssueNumber,
    "--plan-packet",
    planPacket,
    "--planning-artifact-path",
    planningArtifactPath,
    "--factory-id",
    factoryId,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
  });
}

export function writeFactoryRequestPlanArtifact({ packetRepoRoot, goalIssueNumber }) {
  const planningArtifactPath = join(packetRepoRoot, "plan-factory-request-2300.json");

  const goals = [
    ["goal_capability", "prerequisite", "Capability prerequisite goal", "set_capability", "7401"],
    ["goal_policy", "prerequisite", "Policy prerequisite goal", "set_policy", "7402"],
    ["goal_final", "final_instantiation", "Final instantiation goal", "set_final", "7403"],
  ].map(([goal_id, goal_kind, title, issue_set_id, goal_issue_number]) => ({
    goal_id,
    goal_kind,
    title,
    issue_set_id,
    goal_issue_number,
  }));

  const goalIssueSets = [
    ["set_capability", "Capability set", ["goal_capability"], ["F-cap"]],
    ["set_policy", "Policy set", ["goal_policy"], ["F-pol"]],
    ["set_final", "Final set", ["goal_final"], ["F-final"]],
  ].map(([issue_set_id, title, goal_ids, feature_ids]) => ({
    issue_set_id,
    title,
    goal_ids,
    feature_ids,
  }));

  const packet = {
    schema_version: "hard_plan_packet/v1",
    packet_type: "hard_plan_packet",
    packet_id: "plan-factory-request-2300",
    goal_issue_number: goalIssueNumber,
    planning_state: "approved",
    goal_request_type: "factory_request",
    approved_features: [
      {
        feature_id: "F-cap",
        name: "Ship capability prereq",
        summary: "Capability prerequisite issue",
        issue_set_id: "set_capability",
        goal_id: "goal_capability",
      },
      {
        feature_id: "F-pol",
        name: "Ship policy prereq",
        summary: "Policy prerequisite issue",
        issue_set_id: "set_policy",
        goal_id: "goal_policy",
      },
      {
        feature_id: "F-final",
        name: "Ship final instantiation wiring",
        summary: "Final thin-client factory wiring issue",
        issue_set_id: "set_final",
        goal_id: "goal_final",
      },
    ],
    goal_context: {
      factory_request_goal_graph: {
        schema_version: "factory_request_goal_graph/v1",
        goals,
        goal_edges: [
          { from_goal_id: "goal_capability", to_goal_id: "goal_final" },
          { from_goal_id: "goal_policy", to_goal_id: "goal_final" },
        ],
        goal_issue_sets: goalIssueSets,
      },
      factory_request_goal_issue_numbers: {
        goal_capability: "7401",
        goal_policy: "7402",
        goal_final: "7403",
      },
    },
  };

  writeFileSync(planningArtifactPath, JSON.stringify(packet, null, 2));
  return planningArtifactPath;
}

export function makeGhStub() {
  const root = mkdtempSync(join(tmpdir(), "goal-hard-materialize-gh-"));
  const statePath = join(root, "state.json");
  const ghPath = join(root, "gh");

  writeFileSync(statePath, JSON.stringify({ calls: [], nextIssue: 900 }, null, 2), "utf8");
  writeFileSync(
    ghPath,
    String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.HATCH_TEST_GH_STATE_PATH;
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls.push(args);

if (args[0] === "issue" && args[1] === "create") {
  const number = state.nextIssue;
  state.nextIssue += 1;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("https://github.com/recallnet/astrochicken/issues/" + number);
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  const queryArg = args.find((entry) => String(entry).startsWith("query=")) || "";
  if (queryArg.includes("target: issue(number:")) {
    const issueMatch = queryArg.match(/target: issue\\(number:(\\d+)\\)/);
    const issue = issueMatch ? Number(issueMatch[1]) : 0;
    process.stdout.write(JSON.stringify({
      data: {
        repository: {
          target: {
            id: "issue-node-" + issue,
            blockedBy: { nodes: [] },
          },
        },
      },
    }));
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    process.exit(0);
  }

  if (queryArg.includes(" b: issue(number:")) {
    const issueMatch = queryArg.match(/ b: issue\\(number:(\\d+)\\)/);
    const issue = issueMatch ? Number(issueMatch[1]) : 0;
    process.stdout.write(JSON.stringify({
      data: {
        repository: {
          b: { id: "issue-node-" + issue },
        },
      },
    }));
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({ data: { addBlockedBy: { clientMutationId: "x" } } }));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.exit(0);
}

if (args[0] === "api" && args.includes("-X") && args.includes("POST") && args.some((entry) => String(entry).includes("/issues/") && String(entry).endsWith("/sub_issues"))) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("");
  process.exit(0);
}

if (args[0] === "api" && /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(args[1]) && args.includes("--jq") && args.includes(".node_id")) {
  const issue = args[1].split("/").at(-1);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("issue-node-" + issue);
  process.exit(0);
}

if (args[0] === "api" && args[1].includes("/issues/") && args.includes("--jq") && args.includes(".id")) {
  const issueMatch = args[1].match(/\/issues\/(\d+)/);
  const issue = issueMatch ? Number(issueMatch[1]) : 0;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(String(10000 + issue));
  process.exit(0);
}

if (args[0] === "label" && args[1] === "create") {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit") {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write("");
  process.exit(0);
}


fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
process.stderr.write("unexpected gh args: " + args.join(" "));
process.exit(1);
`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);

  return {
    binDir: root,
    statePath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
