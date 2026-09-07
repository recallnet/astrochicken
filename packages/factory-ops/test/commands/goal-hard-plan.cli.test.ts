import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeGhStub() {
  const root = mkdtempSync(join(tmpdir(), "goal-hard-plan-gh-"));
  const statePath = join(root, "state.json");
  const ghPath = join(root, "gh");

  writeFileSync(statePath, JSON.stringify({ calls: [] }, null, 2), "utf8");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.HATCH_TEST_GH_STATE_PATH;
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls.push(args);
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

const apiPath = String(args[1] || "");
const method = String(args[3] || "");

if (args[0] === "api" && apiPath.includes("/comments?") && method !== "POST" && method !== "PATCH") {
  process.stdout.write("[]");
  process.exit(0);
}

if (args[0] === "api" && apiPath.endsWith("/issues/2200/comments") && method === "POST") {
  process.stdout.write(JSON.stringify({
    id: 987,
    html_url: "https://github.com/recallnet/astrochicken/issues/2200#issuecomment-987"
  }));
  process.exit(0);
}

if (args[0] === "api" && apiPath.includes("/issues/comments/") && method === "PATCH") {
  process.stdout.write(JSON.stringify({
    id: 987,
    html_url: "https://github.com/recallnet/astrochicken/issues/2200#issuecomment-987"
  }));
  process.exit(0);
}

if (args[0] === "label" && args[1] === "create") {
  process.stdout.write("");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ comments: [] }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "edit") {
  process.stdout.write("");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  process.stdout.write("");
  process.exit(0);
}

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

function runCli(args = [], { binDir, statePath, expectedStatus = 0, extraEnv = {} } = {}) {
  const out = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_TEST_GH_STATE_PATH: statePath,
      ...extraEnv,
    },
  });

  assert.equal(out.status, expectedStatus, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  return {
    json: JSON.parse(String(out.stdout || "{}").trim() || "{}"),
    stdout: String(out.stdout || ""),
    stderr: String(out.stderr || ""),
  };
}

test("goal hard-plan attach CLI persists packet and creates deterministic marker comment", () => {
  const stub = makeGhStub();
  const packetRepoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-packets-"));
  try {
    const result = runCli([
      "goal",
      "hard-plan",
      "attach",
      "--repo",
      "recallnet/astrochicken",
      "--repo-root",
      packetRepoRoot,
      "--goal",
      "2200",
      "--plan-id",
      "plan-cli-1",
      "--summary",
      "Hard plan summary from CLI",
      "--artifact-refs",
      '[{"label":"plan","url":"https://example.com/plan.md"}]',
      "--factory-id",
      "mothership",
    ], { ...stub, expectedStatus: 0 });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.goal_number, "2200");
    assert.equal(result.json.packet_id, "plan-cli-1");
    assert.equal(result.json.comment_action, "created");
    assert.match(result.json.comment_marker, /goal-hard-plan:v1 goal=2200 packet=plan-cli-1/);
    assert.equal(result.json.awaiting_review, true);
    assert.match(result.json.awaiting_review_marker, /goal-run:awaiting-review/);

    const packetPath = result.json.packet_path;
    const packet = JSON.parse(readFileSync(packetPath, "utf8"));
    assert.equal(packet.packet_type, "goal_hard_plan_packet");
    assert.equal(packet.goal_number, "2200");
    assert.equal(packet.goal_issue_comment_id, "987");

    const calls = JSON.parse(readFileSync(stub.statePath, "utf8")).calls || [];
    const listCall = calls.find((entry) => entry[0] === "api" && String(entry[1] || "").includes("/issues/2200/comments?"));
    const createCall = calls.find((entry) => entry[0] === "api" && String(entry[1] || "").match(/\/issues\/2200\/comments$/));
    const holdLabelCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "edit" && entry.includes("--add-label") && entry.includes("awaiting-human") && entry.includes("--remove-label") && entry.includes("ready"));
    const holdCommentCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "comment" && String(entry[6] || "").includes("goal-run:awaiting-review"));
    assert.ok(listCall, "must list comments to deterministically upsert marker");
    assert.ok(createCall, "must create marker comment when absent");
    assert.ok(holdLabelCall, "must hold goal for human review by toggling labels");
    assert.ok(holdCommentCall, "must post awaiting-review marker comment");
  } finally {
    rmSync(packetRepoRoot, { recursive: true, force: true });
    stub.cleanup();
  }
});

test("goal hard-plan inspect CLI reports missing attachment deterministically", () => {
  const out = spawnSync("node", [
    opsCliPath,
    "goal",
    "hard-plan",
    "inspect",
    "--repo-root",
    mkdtempSync(join(tmpdir(), "goal-hard-plan-inspect-")),
    "--goal",
    "2200",
    "--factory-id",
    "mothership",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  const payload = JSON.parse(String(out.stdout || "{}").trim() || "{}");
  assert.equal(payload.attached, false);
  assert.equal(payload.goal_number, "2200");
});

test("goal validate-planning-artifact CLI fails on factory_request packet that bypasses reusable analysis", () => {
  const repoRootTmp = mkdtempSync(join(tmpdir(), "goal-hard-plan-cli-validate-fail-"));
  const packetPath = join(repoRootTmp, "hard_plan_packet_invalid.json");
  writeFileSync(packetPath, JSON.stringify({
    schema_version: "hard_plan_packet/v1",
    packet_type: "hard_plan_packet",
    packet_id: "hard_plan_packet_invalid",
    goal_issue_number: "2351",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2351" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Bespoke wiring",
        factory_request_bucket: "factory_instance_wiring",
      },
    ],
    factory_request_plan: {
      reusable_capability_gaps: [],
      reusable_policy_profile_gaps: [],
      factory_instance_wiring: [{ feature_id: "F-1", name: "Bespoke wiring" }],
      domain_specific_residues: [],
      raw_bucket_text: {
        reusable_capability_gaps: [],
        reusable_policy_profile_gaps: [],
        factory_instance_wiring: ["wire instance directly"],
        domain_specific_residues: [],
      },
      normalization_warnings: [],
    },
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        {
          goal_id: "prereq_bespoke",
          goal_kind: "prerequisite",
          title: "Prereq bespoke",
          issue_set_id: "set_prereq_bespoke",
        },
      ],
      final_instantiation_goal: {
        goal_id: "final_instantiation",
        goal_kind: "final_instantiation",
        title: "Final instantiation",
        issue_set_id: "set_final_instantiation",
      },
      goal_edges: [
        {
          from_goal_id: "prereq_bespoke",
          to_goal_id: "final_instantiation",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_bespoke",
          title: "Prereq bespoke set",
          goal_ids: ["prereq_bespoke"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_final_instantiation",
          title: "Final set",
          goal_ids: ["final_instantiation"],
          feature_ids: [],
        },
      ],
    },
  }, null, 2), "utf8");

  const out = spawnSync("node", [
    opsCliPath,
    "goal",
    "validate-planning-artifact",
    "--packet-path",
    packetPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 1, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  assert.match(String(out.stderr || ""), /invalid_planning_artifact:.*bypassed_reuse_analysis/);

  rmSync(repoRootTmp, { recursive: true, force: true });
});

test("goal attach-planning-artifacts CLI includes reusable-vs-instantiation markdown for factory_request packets", () => {
  const stub = makeGhStub();
  const repoRootTmp = mkdtempSync(join(tmpdir(), "goal-hard-plan-cli-attach-summary-"));
  const packetPath = join(repoRootTmp, "hard_plan_packet_factory_request.json");

  writeFileSync(packetPath, JSON.stringify({
    schema_version: "hard_plan_packet/v1",
    packet_type: "hard_plan_packet",
    packet_id: "hard_plan_packet_factory_request",
    goal_issue_number: "2200",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2200" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
      {
        id: "F-3",
        name: "Instance wiring",
        factory_request_bucket: "factory_instance_wiring",
      },
      {
        id: "F-4",
        name: "Domain residue",
        factory_request_bucket: "domain_specific_residues",
      },
    ],
    factory_request_plan: {
      reusable_capability_gaps: [{ feature_id: "F-1", name: "Reusable capability" }],
      reusable_policy_profile_gaps: [{ feature_id: "F-2", name: "Reusable policy/profile" }],
      factory_instance_wiring: [{ feature_id: "F-3", name: "Instance wiring" }],
      domain_specific_residues: [{ feature_id: "F-4", name: "Domain residue" }],
      raw_bucket_text: {
        reusable_capability_gaps: ["shared capability surface"],
        reusable_policy_profile_gaps: ["shared policy profile"],
        factory_instance_wiring: ["wire target factory instance"],
        domain_specific_residues: ["domain-local residue"],
      },
      normalization_warnings: [],
    },
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        {
          goal_id: "prereq_capability",
          goal_kind: "prerequisite",
          title: "Capability prereq",
          issue_set_id: "set_capability",
        },
        {
          goal_id: "prereq_policy",
          goal_kind: "prerequisite",
          title: "Policy prereq",
          issue_set_id: "set_policy",
        },
      ],
      final_instantiation_goal: {
        goal_id: "final_instantiation",
        goal_kind: "final_instantiation",
        title: "Final instantiation",
        issue_set_id: "set_final",
      },
      goal_edges: [
        {
          from_goal_id: "prereq_capability",
          to_goal_id: "final_instantiation",
        },
        {
          from_goal_id: "prereq_policy",
          to_goal_id: "final_instantiation",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_capability",
          title: "Capability set",
          goal_ids: ["prereq_capability"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_policy",
          title: "Policy set",
          goal_ids: ["prereq_policy"],
          feature_ids: ["F-2"],
        },
        {
          issue_set_id: "set_final",
          title: "Final set",
          goal_ids: ["final_instantiation"],
          feature_ids: ["F-3", "F-4"],
        },
      ],
    },
  }, null, 2), "utf8");

  try {
    const result = runCli([
      "goal",
      "attach-planning-artifacts",
      "--repo",
      "recallnet/astrochicken",
      "--goal-issue-number",
      "2200",
      "--planning-artifact-path",
      packetPath,
      "--planning-packet-id",
      "hard_plan_packet_factory_request",
      "--run-id",
      "run-hard-cli-attach",
      "--summary",
      "hard_path_planning_completed",
    ], { ...stub, expectedStatus: 0 });

    assert.equal(result.json.planning_attachment_posted, "true");

    const calls = JSON.parse(readFileSync(stub.statePath, "utf8")).calls || [];
    const commentCall = calls.find((entry) => entry[0] === "issue" && entry[1] === "comment");
    assert.ok(commentCall, "must post planning artifact issue comment");

    const body = String(commentCall[6] || "");
    assert.match(body, /### Reusable platform work/);
    assert.match(body, /### Target factory instantiation/);
    assert.match(body, /### Prerequisite goal graph/);
    assert.match(body, /\*\*Goal order \(topological\)\*\*/);
    assert.match(body, /shared capability surface/);
    assert.match(body, /wire target factory instance/);
    assert.match(body, /\*\*Final goal callout\*\*/);
    assert.match(body, /prereq_capability → final_instantiation/);
  } finally {
    rmSync(repoRootTmp, { recursive: true, force: true });
    stub.cleanup();
  }
});

test("goal persist-hard-plan-artifact CLI persists explicit factory_request_goal_graph", () => {
  const repoRootTmp = mkdtempSync(join(tmpdir(), "goal-hard-plan-cli-persist-goal-graph-"));

  const goalIssue = {
    number: 2401,
    title: "Stand up a new managed factory client for research",
    body: "Factory request needs prerequisite reusable capabilities before instantiation.",
  };
  const goalContext = {
    goal_request_type: "factory_request",
  };
  const approvedFeatures = [
    {
      id: "F-1",
      name: "Reusable capability prereq",
      summary: "Add capability contract",
      factory_request_bucket: "reusable_capability_gaps",
      factory_request_bucket_text: ["shared capability prerequisite"],
      issue_set_id: "set_capability",
      goal_id: "goal_capability",
    },
    {
      id: "F-2",
      name: "Reusable policy prereq",
      summary: "Add policy contract",
      factory_request_bucket: "reusable_policy_profile_gaps",
      factory_request_bucket_text: ["shared policy prerequisite"],
      issue_set_id: "set_policy",
      goal_id: "goal_policy",
    },
    {
      id: "F-3",
      name: "Final instantiation work",
      summary: "Instantiate target factory",
      factory_request_bucket: "factory_instance_wiring",
      factory_request_bucket_text: ["final instantiation wiring"],
      issue_set_id: "set_final",
      goal_id: "goal_final",
    },
  ];

  const factoryRequestGoalGraph = {
    schema_version: "factory_request_goal_graph/v1",
    goals: [
      {
        goal_id: "goal_capability",
        goal_kind: "prerequisite",
        title: "Capability prerequisite",
        issue_set_id: "set_capability",
      },
      {
        goal_id: "goal_policy",
        goal_kind: "prerequisite",
        title: "Policy prerequisite",
        issue_set_id: "set_policy",
      },
      {
        goal_id: "goal_final",
        goal_kind: "final_instantiation",
        title: "Final factory instantiation",
        issue_set_id: "set_final",
      },
    ],
    goal_edges: [
      {
        from_goal_id: "goal_capability",
        to_goal_id: "goal_final",
      },
      {
        from_goal_id: "goal_policy",
        to_goal_id: "goal_final",
      },
    ],
    goal_issue_sets: [
      {
        issue_set_id: "set_capability",
        title: "Capability set",
        goal_ids: ["goal_capability"],
        feature_ids: ["F-1"],
      },
      {
        issue_set_id: "set_policy",
        title: "Policy set",
        goal_ids: ["goal_policy"],
        feature_ids: ["F-2"],
      },
      {
        issue_set_id: "set_final",
        title: "Final set",
        goal_ids: ["goal_final"],
        feature_ids: ["F-3"],
      },
    ],
  };

  const out = spawnSync("node", [
    opsCliPath,
    "goal",
    "persist-hard-plan-artifact",
    "--repo-root",
    repoRootTmp,
    "--goal-issue-number",
    "2401",
    "--goal-issue",
    JSON.stringify(goalIssue),
    "--goal-context",
    JSON.stringify(goalContext),
    "--approved-features",
    JSON.stringify(approvedFeatures),
    "--factory-request-goal-graph",
    JSON.stringify(factoryRequestGoalGraph),
    "--factory-id",
    "mothership",
    "--run-id",
    "run-cli-persist-goal-graph",
    "--pipeline",
    "goal_hard_plan",
    "--node-id",
    "persist_hard_plan_packet",
    "--target-repo",
    "recallnet/astrochicken",
    "--control-plane-repo",
    "recallnet/astrochicken",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  const payload = JSON.parse(String(out.stdout || "{}").trim() || "{}");
  const packet = JSON.parse(readFileSync(payload.hard_plan_packet_path, "utf8"));

  assert.equal(packet.goal_request_type, "factory_request");
  assert.equal(packet.factory_request_goal_graph.schema_version, "factory_request_goal_graph/v1");
  assert.equal(packet.factory_request_goal_graph.final_instantiation_goal.goal_id, "goal_final");
  assert.equal(packet.factory_request_goal_graph.prerequisite_goals.length, 2);
  assert.equal(packet.factory_request_goal_graph.goal_edges.length, 2);

  rmSync(repoRootTmp, { recursive: true, force: true });
});
