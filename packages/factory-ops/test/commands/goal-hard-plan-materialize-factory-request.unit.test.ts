import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactoryRequestGoalIssueMap,
  buildFactoryRequestMaterializationLedger,
  normalizeFactoryRequestPrerequisiteMaterialization,
  normalizeFinalInstantiationGoalIssueNumber,
  normalizeGoalIssueMap,
  normalizeIssueSetMap,
  normalizeOptionalIssueNumber,
  normalizePrerequisiteGoalIssueNumbers,
  resolveAndSyncGoalBlockedByEdges,
  resolveFactoryRequestFinalInstantiationTargets,
  resolveFactoryRequestPrerequisiteTargets,
} from "../../src/commands/goal-hard-plan-materialize-factory-request.ts";

function makeFactoryRequestGraph() {
  return {
    schema_version: "factory_request_goal_graph/v1",
    prerequisite_goals: [
      { goal_id: "goal_capability", issue_set_id: "set_capability" },
      { goal_id: "goal_policy", issue_set_id: "set_policy" },
    ],
    final_instantiation_goal: { goal_id: "goal_final", issue_set_id: "set_final" },
    goal_edges: [
      { from_goal_id: "goal_capability", to_goal_id: "goal_final" },
      { from_goal_id: "goal_policy", to_goal_id: "goal_final" },
    ],
    goal_issue_sets: [
      {
        issue_set_id: "set_capability",
        goal_ids: ["goal_capability"],
        feature_ids: ["F-cap"],
      },
      {
        issue_set_id: "set_policy",
        goal_ids: ["goal_policy"],
        feature_ids: ["F-pol"],
      },
      {
        issue_set_id: "set_final",
        goal_ids: ["goal_final"],
        feature_ids: [],
      },
    ],
  };
}

test("factory request helper normalizes optional goal issue numbers", () => {
  assert.equal(normalizeOptionalIssueNumber("42"), "42");
  assert.equal(normalizeOptionalIssueNumber(" 42 "), "42");
  assert.equal(normalizeOptionalIssueNumber("not-a-number"), "");
  assert.equal(normalizeOptionalIssueNumber(""), "");
});

test("factory request helper normalizes goal issue map deterministically", () => {
  assert.deepEqual(normalizeGoalIssueMap({
    goal_policy: "7302",
    goal_final: "2210",
    goal_capability: "7301",
    invalid: "NaN",
  }), {
    goal_capability: "7301",
    goal_final: "2210",
    goal_policy: "7302",
  });
});

test("factory request helper builds goal issue map and pins final goal to current issue", () => {
  const map = buildFactoryRequestGoalIssueMap({
    packet: {
      goal_context: {
        factory_request_goal_issue_numbers: {
          goal_capability: "7301",
          goal_policy: "7302",
          goal_final: "7303",
        },
      },
    },
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    currentGoalIssueNumber: "2210",
  });

  assert.deepEqual(map, {
    goal_capability: "7301",
    goal_final: "2210",
    goal_policy: "7302",
  });
});

test("factory request helper fails closed when prerequisite goal issue numbers are missing", () => {
  assert.throws(() => buildFactoryRequestGoalIssueMap({
    packet: {
      goal_context: {
        factory_request_goal_issue_numbers: {
          goal_final: "7303",
        },
      },
    },
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    currentGoalIssueNumber: "2210",
  }), /missing_factory_request_goal_issue_number:goal_capability/);
});

test("factory request helper resolves prerequisite targets from approved features", () => {
  const targets = resolveFactoryRequestPrerequisiteTargets({
    approvedFeatures: [
      {
        feature_id: "F-cap",
        source_feature: {
          feature_id: "F-cap",
          issue_set_id: "set_capability",
          goal_id: "goal_capability",
        },
      },
      {
        feature_id: "F-pol",
        source_feature: {
          feature_id: "F-pol",
          issue_set_id: "set_policy",
          goal_id: "goal_policy",
        },
      },
    ],
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    goalIssueMap: {
      goal_capability: "7301",
      goal_policy: "7302",
      goal_final: "2210",
    },
    currentGoalIssueNumber: "2210",
  });

  assert.deepEqual(targets.map((entry) => ({
    goal_id: entry.goal_id,
    goal_issue_number: entry.goal_issue_number,
    issue_set_id: entry.issue_set_id,
    feature_ids: entry.features.map((feature) => feature.feature_id),
  })), [
    {
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "set_capability",
      feature_ids: ["F-cap"],
    },
    {
      goal_id: "goal_policy",
      goal_issue_number: "7302",
      issue_set_id: "set_policy",
      feature_ids: ["F-pol"],
    },
  ]);
});

test("factory request helper resolves final-instantiation targets from approved features", () => {
  const targets = resolveFactoryRequestFinalInstantiationTargets({
    approvedFeatures: [
      {
        feature_id: "F-cap",
        source_feature: {
          feature_id: "F-cap",
          issue_set_id: "set_capability",
          goal_id: "goal_capability",
        },
      },
      {
        feature_id: "F-final",
        source_feature: {
          feature_id: "F-final",
          issue_set_id: "set_final",
          goal_id: "goal_final",
        },
      },
    ],
    factoryRequestGoalGraph: {
      ...makeFactoryRequestGraph(),
      goal_issue_sets: [
        {
          issue_set_id: "set_capability",
          goal_ids: ["goal_capability"],
          feature_ids: ["F-cap"],
        },
        {
          issue_set_id: "set_policy",
          goal_ids: ["goal_policy"],
          feature_ids: ["F-pol"],
        },
        {
          issue_set_id: "set_final",
          goal_ids: ["goal_final"],
          feature_ids: ["F-final"],
        },
      ],
    },
    goalIssueMap: {
      goal_capability: "7301",
      goal_policy: "7302",
      goal_final: "2210",
    },
    currentGoalIssueNumber: "2210",
  });

  assert.deepEqual(targets.map((entry) => ({
    goal_id: entry.goal_id,
    goal_issue_number: entry.goal_issue_number,
    issue_set_id: entry.issue_set_id,
    feature_ids: entry.features.map((feature) => feature.feature_id),
  })), [
    {
      goal_id: "goal_final",
      goal_issue_number: "2210",
      issue_set_id: "set_final",
      feature_ids: ["F-final"],
    },
  ]);
});

test("factory request helper returns no final-instantiation targets when no final features exist", () => {
  const targets = resolveFactoryRequestFinalInstantiationTargets({
    approvedFeatures: [
      {
        feature_id: "F-cap",
        source_feature: {
          feature_id: "F-cap",
          issue_set_id: "set_capability",
          goal_id: "goal_capability",
        },
      },
    ],
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    goalIssueMap: {
      goal_capability: "7301",
      goal_policy: "7302",
      goal_final: "2210",
    },
    currentGoalIssueNumber: "2210",
  });

  assert.deepEqual(targets, []);
});

test("factory request helper fails closed when final features exist but final metadata is missing", () => {
  assert.throws(() => resolveFactoryRequestFinalInstantiationTargets({
    approvedFeatures: [
      {
        feature_id: "F-final",
        source_feature: {
          feature_id: "F-final",
          issue_set_id: "set_final",
          goal_id: "goal_final",
        },
      },
    ],
    factoryRequestGoalGraph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [{ goal_id: "goal_capability", issue_set_id: "set_capability" }],
      final_instantiation_goal: { goal_id: "goal_final", issue_set_id: "" },
      goal_edges: [{ from_goal_id: "goal_capability", to_goal_id: "goal_final" }],
      goal_issue_sets: [
        {
          issue_set_id: "set_capability",
          goal_ids: ["goal_capability"],
          feature_ids: ["F-cap"],
        },
        {
          issue_set_id: "set_final",
          goal_ids: ["goal_final"],
          feature_ids: ["F-final"],
        },
      ],
    },
    goalIssueMap: {
      goal_capability: "7301",
      goal_final: "2210",
    },
    currentGoalIssueNumber: "2210",
  }), /missing_factory_request_final_issue_set_id:goal_final/);
});

test("factory request helper normalizes prerequisite materialization rows", () => {
  const rows = normalizeFactoryRequestPrerequisiteMaterialization([
    {
      goal_id: "goal_policy",
      goal_issue_number: "7302",
      issue_set_id: "set_policy",
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
    },
    {
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "set_capability",
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
    },
  ]);

  assert.deepEqual(rows, [
    {
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "set_capability",
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
    },
    {
      goal_id: "goal_policy",
      goal_issue_number: "7302",
      issue_set_id: "set_policy",
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
    },
  ]);
});

test("factory request helper normalizes issue set and goal issue number ledgers", () => {
  assert.deepEqual(normalizeIssueSetMap({
    set_policy: {
      issue_set_id: "set_policy",
      goal_ids: ["goal_policy"],
      goal_issue_numbers: ["7302"],
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/911"],
    },
    set_capability: {
      issue_set_id: "set_capability",
      goal_ids: ["goal_capability"],
      goal_issue_numbers: ["7301"],
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/910"],
    },
  }), {
    set_capability: {
      issue_set_id: "set_capability",
      title: "",
      goal_ids: ["goal_capability"],
      goal_issue_numbers: ["7301"],
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/910"],
    },
    set_policy: {
      issue_set_id: "set_policy",
      title: "",
      goal_ids: ["goal_policy"],
      goal_issue_numbers: ["7302"],
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/911"],
    },
  });

  assert.deepEqual(normalizePrerequisiteGoalIssueNumbers([7302, "7301", "ignore"]), [7301, 7302]);
  assert.equal(normalizeFinalInstantiationGoalIssueNumber("2210"), 2210);
  assert.equal(normalizeFinalInstantiationGoalIssueNumber(""), null);
});

test("factory request helper builds full materialization ledger", () => {
  const ledger = buildFactoryRequestMaterializationLedger({
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    goalIssueMap: {
      goal_capability: "7301",
      goal_policy: "7302",
      goal_final: "2210",
    },
    created: [
      {
        feature_id: "F-cap",
        issue_number: 910,
        issue_url: "https://github.com/recallnet/astrochicken/issues/910",
        source_goal_id: "goal_capability",
        source_issue_set_id: "set_capability",
        parent_goal_issue_number: "7301",
      },
      {
        feature_id: "F-pol",
        issue_number: 911,
        issue_url: "https://github.com/recallnet/astrochicken/issues/911",
        source_goal_id: "goal_policy",
        source_issue_set_id: "set_policy",
        parent_goal_issue_number: "7302",
      },
    ],
    planPacketId: "plan-2210",
  });

  assert.deepEqual(ledger.goal_issue_map, {
    goal_capability: "7301",
    goal_final: "2210",
    goal_policy: "7302",
  });
  assert.deepEqual(ledger.prerequisite_goal_issue_numbers, [7301, 7302]);
  assert.equal(ledger.final_instantiation_goal_issue_number, 2210);
  assert.deepEqual(ledger.issue_set_map, {
    set_capability: {
      issue_set_id: "set_capability",
      title: "",
      goal_ids: ["goal_capability"],
      goal_issue_numbers: ["7301"],
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/910"],
    },
    set_final: {
      issue_set_id: "set_final",
      title: "",
      goal_ids: ["goal_final"],
      goal_issue_numbers: ["2210"],
      feature_ids: [],
      created_issue_numbers: [],
      created_issue_urls: [],
    },
    set_policy: {
      issue_set_id: "set_policy",
      title: "",
      goal_ids: ["goal_policy"],
      goal_issue_numbers: ["7302"],
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/911"],
    },
  });
  assert.deepEqual(ledger.goal_feature_issue_map, {
    goal_capability: [{
      feature_id: "F-cap",
      issue_number: 910,
      issue_url: "https://github.com/recallnet/astrochicken/issues/910",
      issue_set_id: "set_capability",
      parent_goal_issue_number: "7301",
    }],
    goal_policy: [{
      feature_id: "F-pol",
      issue_number: 911,
      issue_url: "https://github.com/recallnet/astrochicken/issues/911",
      issue_set_id: "set_policy",
      parent_goal_issue_number: "7302",
    }],
  });
  assert.deepEqual(ledger.feature_materialization_markers, [
    "plan-2210::feature::F-cap",
    "plan-2210::feature::F-pol",
    "plan-2210::goal::goal_capability::feature::F-cap",
    "plan-2210::goal::goal_policy::feature::F-pol",
  ]);
});

test("factory request helper syncs goal blockedBy edges deterministically", () => {
  const calls = [];
  const edges = resolveAndSyncGoalBlockedByEdges({
    repo: "recallnet/astrochicken",
    factoryRequestGoalGraph: makeFactoryRequestGraph(),
    goalIssueMap: {
      goal_capability: "7301",
      goal_policy: "7302",
      goal_final: "2210",
    },
    syncBlockedByFn: ({ issueNumber, blockedByRaw }) => {
      calls.push({ issueNumber: Number(issueNumber), blockedBy: JSON.parse(blockedByRaw) });
      return { synced: true, added: 1, removed: 0 };
    },
  });

  assert.deepEqual(edges, [
    { issue_number: 2210, blocked_by: [7301, 7302] },
  ]);
  assert.deepEqual(calls, [
    { issueNumber: 2210, blockedBy: [7301, 7302] },
  ]);
});
