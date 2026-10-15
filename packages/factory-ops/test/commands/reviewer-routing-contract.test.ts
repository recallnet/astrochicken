import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REVIEW_RECOMMENDED_TRANSITIONS } from "../../src/commands/wave-review-route.ts";

const GRAPH_PATHS = {
  issue_execute_item: "docs/contracts/workflow-ir/capability-coding/issue_execute_item.dot",
  wave_issue_execute: "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot",
};

const FIXTURE_CASES = [
  {
    name: "approved payload",
    payloadFixture: "approved.payload.json",
    expectedRoute: "approve",
    expectedReason: "approved",
  },
  {
    name: "revise payload",
    payloadFixture: "revise.payload.json",
    expectedRoute: "revise",
    expectedReason: "non_approve_verdict",
  },
  {
    name: "qa infra payload",
    payloadFixture: "qa-infra.payload.json",
    expectedRoute: "revise",
    expectedReason: "qa_infra",
  },
  {
    name: "policy override payload",
    payloadFixture: "policy-override.payload.json",
    contextFixture: "policy-override.context.json",
    expectedRoute: "revise",
    expectedReason: "policy_override_revise",
  },
  {
    name: "missing context payload",
    payloadFixture: "missing-context.payload.json",
    expectedRoute: "revise",
    expectedReason: "review_context_missing_required_fields",
  },
  {
    name: "malformed output payload",
    payloadFixture: "malformed-output.payload.json",
    expectedRoute: "revise",
    expectedReason: "invalid_review_verdict",
  },
  {
    name: "unknown verdict payload",
    payloadFixture: "unknown-verdict.payload.json",
    expectedRoute: "revise",
    expectedReason: "invalid_review_verdict",
  },
];

function fixturePath(name) {
  return new URL(`./fixtures/reviewer-routing/${name}`, import.meta.url);
}

function loadFixtureJson(name) {
  return JSON.parse(readFileSync(fixturePath(name), "utf8"));
}

function parseDotEdges(dot) {
  const edges = [];
  for (const raw of dot.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line.includes("->")) continue;
    const condition = line.match(/condition="([^"]+)"/)?.[1] || "";
    const segments = line
      .replace(/\[[^\]]*\]/g, "")
      .split("->")
      .map((part) => part.match(/[A-Za-z0-9_]+/)?.[0] || "")
      .filter(Boolean);

    for (let i = 0; i < segments.length - 1; i += 1) {
      edges.push({
        from: segments[i],
        to: segments[i + 1],
        condition: i === segments.length - 2 ? condition : "",
      });
    }
  }
  return edges;
}

function decisionContract(dot) {
  const edges = parseDotEdges(dot);
  const decideEdges = edges.filter((edge) => edge.from === "decide");
  const conditions = decideEdges.map((edge) => edge.condition).sort();
  assert.deepEqual(conditions, ["disposition!=approve", "disposition=approve"]);

  const approveEdge = decideEdges.find((edge) => edge.condition === "disposition=approve");
  const reviseEdge = decideEdges.find((edge) => edge.condition === "disposition!=approve");
  assert.ok(approveEdge, "approve edge is required");
  assert.ok(reviseEdge, "revise edge is required");

  return {
    edges,
    approveTarget: approveEdge.to,
    reviseTarget: reviseEdge.to,
  };
}

function evaluateCondition(condition, context) {
  const [leftBang, rightBang] = condition.split("!=");
  if (rightBang !== undefined) {
    return String(context[leftBang.trim()] || "") !== rightBang.trim();
  }
  const [left, right] = condition.split("=");
  return String(context[left.trim()] || "") === right.trim();
}

function pickDecisionTarget(contract, disposition) {
  const decideEdges = contract.edges.filter((edge) => edge.from === "decide");
  const matches = decideEdges.filter((edge) => evaluateCondition(edge.condition, { disposition }));
  assert.equal(matches.length, 1, `expected exactly one matching decision edge for disposition=${disposition}`);
  return matches[0].to;
}

function incomingEdges(contract, nodeId) {
  return contract.edges.filter((edge) => edge.to === nodeId);
}

// Tests "review routing decision branches..." and "unknown/malformed reviewer outputs..."
// removed — resolveReviewRoute from wave-review-route.mjs was deleted in goal migration.

test("approve and feedback sinks remain exclusive with no bypass edges around decide", () => {
  const issueContract = decisionContract(readFileSync(GRAPH_PATHS.issue_execute_item, "utf8"));
  const waveContract = decisionContract(readFileSync(GRAPH_PATHS.wave_issue_execute, "utf8"));

  const issueApproveIncoming = incomingEdges(issueContract, "report");
  assert.deepEqual(
    issueApproveIncoming.map((edge) => `${edge.from}:${edge.condition}`),
    ["decide:disposition=approve"],
  );
  const issueFailureIncoming = incomingEdges(issueContract, "give_up");
  assert.deepEqual(
    issueFailureIncoming.map((edge) => `${edge.from}:${edge.condition}`),
    ["check_attempt:review_attempt>=3"],
  );
  assert.equal(incomingEdges(issueContract, "report").some((edge) => edge.from === "review"), false);
  assert.equal(incomingEdges(issueContract, "report").some((edge) => edge.from === "review_context_gate"), false);

  const waveApproveIncoming = incomingEdges(waveContract, "report_approved");
  assert.deepEqual(
    waveApproveIncoming.map((edge) => `${edge.from}:${edge.condition}`),
    ["bump_approve:"],
  );
  const waveBuildFailureIncoming = incomingEdges(waveContract, "report_build_failed");
  assert.deepEqual(
    waveBuildFailureIncoming.map((edge) => `${edge.from}:${edge.condition}`).sort(),
    ["build:outcome!=success", "assert_main_after_build:ok!=true", "commit_push_gate:ok!=true"].sort(),
  );
  const waveRetryFailureIncoming = incomingEdges(waveContract, "report_retry_failed");
  assert.deepEqual(
    waveRetryFailureIncoming.map((edge) => `${edge.from}:${edge.condition}`).sort(),
    [
      "retry_gate:retry_review!=true",
      "visual_refinement_gate:visual_refinement_gate_pass!=true",
    ],
  );

  const approveAttemptIncoming = incomingEdges(waveContract, "approve_attempt");
  assert.deepEqual(approveAttemptIncoming.map((edge) => `${edge.from}:${edge.condition}`), ["decide:disposition=approve"]);
  const reviseAttemptIncoming = incomingEdges(waveContract, "revise_attempt");
  assert.deepEqual(reviseAttemptIncoming.map((edge) => `${edge.from}:${edge.condition}`), ["decide:disposition!=approve"]);

  assert.equal(incomingEdges(waveContract, "report_approved").some((edge) => edge.from === "decide"), false);
});

test("review route canonical transitions remain approved/revise only", () => {
  assert.deepEqual([...REVIEW_RECOMMENDED_TRANSITIONS].sort(), ["approved", "revise"]);
});
