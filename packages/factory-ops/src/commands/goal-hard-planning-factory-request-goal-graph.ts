import { parseJson, trim } from "../lib/cli-helpers.ts";

export const FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION = "factory_request_goal_graph/v1";
const FACTORY_REQUEST_GOAL_KIND_PREREQUISITE = "prerequisite";
const FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION = "final_instantiation";

const FACTORY_REQUEST_GOAL_KIND_ALIASES = new Map([
  ["prerequisite", FACTORY_REQUEST_GOAL_KIND_PREREQUISITE],
  ["prereq", FACTORY_REQUEST_GOAL_KIND_PREREQUISITE],
  ["dependency", FACTORY_REQUEST_GOAL_KIND_PREREQUISITE],
  ["final_instantiation", FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION],
  ["final", FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION],
  ["instantiation", FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION],
  ["factory_instantiation", FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION],
]);

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function parseOptionalObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  const parsed = parseJson(String(value || ""), null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseOptionalArray(value) {
  if (Array.isArray(value)) return value;
  const parsed = parseJson(String(value || ""), null);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeFactoryRequestGoalKind(value = "") {
  const normalized = trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return FACTORY_REQUEST_GOAL_KIND_ALIASES.get(normalized) || "";
}

function normalizeFactoryRequestGoalNode(rawNode = {}, defaultGoalKind = "") {
  const node = asPlainObject(rawNode);
  return {
    goal_id: trim(node.goal_id || node.goalId || node.id || node.slug),
    goal_kind: normalizeFactoryRequestGoalKind(node.goal_kind || node.goalKind || defaultGoalKind),
    title: trim(node.title || node.goal_title || node.goalTitle || node.name || node.summary),
    issue_set_id: trim(
      node.issue_set_id
      || node.issueSetId
      || node.goal_issue_set_id
      || node.goalIssueSetId
      || node.issue_set
      || node.issueSet,
    ),
  };
}

function normalizeFactoryRequestGoalEdge(rawEdge = {}) {
  const edge = asPlainObject(rawEdge);
  return {
    from_goal_id: trim(
      edge.from_goal_id
      || edge.fromGoalId
      || edge.from
      || edge.source_goal_id
      || edge.sourceGoalId
      || edge.source,
    ),
    to_goal_id: trim(
      edge.to_goal_id
      || edge.toGoalId
      || edge.to
      || edge.target_goal_id
      || edge.targetGoalId
      || edge.target,
    ),
  };
}

function extractFactoryRequestGoalGraphCandidate({ goalContext = {}, approvedFeatures = [] } = {}) {
  const candidates = [];

  const normalizedGoalContext = asPlainObject(goalContext);
  for (const key of ["factory_request_goal_graph", "factoryRequestGoalGraph", "goal_graph", "goalGraph"]) {
    if (Object.prototype.hasOwnProperty.call(normalizedGoalContext, key)) {
      const candidate = parseOptionalObject(normalizedGoalContext[key]);
      if (Object.keys(candidate).length > 0) candidates.push(candidate);
    }
  }

  for (const feature of Array.isArray(approvedFeatures) ? approvedFeatures : []) {
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) continue;
    for (const key of ["factory_request_goal_graph", "factoryRequestGoalGraph", "goal_graph", "goalGraph"]) {
      if (!Object.prototype.hasOwnProperty.call(feature, key)) continue;
      const candidate = parseOptionalObject(feature[key]);
      if (Object.keys(candidate).length > 0) candidates.push(candidate);
    }
  }

  return candidates[0] || {};
}

function extractFactoryRequestGoalNodes(rawGraph = {}) {
  const normalizedGraph = asPlainObject(rawGraph);

  const explicitGoalLists = [
    parseOptionalArray(normalizedGraph.goals),
    parseOptionalArray(normalizedGraph.goal_nodes),
    parseOptionalArray(normalizedGraph.goalNodes),
    parseOptionalArray(normalizedGraph.nodes),
  ];

  const nodes = [];
  for (const list of explicitGoalLists) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        nodes.push({ node: entry, defaultGoalKind: "" });
      }
    }
  }

  for (const entry of parseOptionalArray(normalizedGraph.prerequisite_goals || normalizedGraph.prerequisiteGoals)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      nodes.push({ node: entry, defaultGoalKind: FACTORY_REQUEST_GOAL_KIND_PREREQUISITE });
    }
  }

  const finalGoalRaw = parseOptionalObject(
    normalizedGraph.final_instantiation_goal
    || normalizedGraph.finalInstantiationGoal,
  );
  if (Object.keys(finalGoalRaw).length > 0) {
    nodes.push({
      node: finalGoalRaw,
      defaultGoalKind: FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION,
    });
  }

  return nodes;
}

function extractFactoryRequestGoalEdges(rawGraph = {}) {
  const normalizedGraph = asPlainObject(rawGraph);

  const edges = [];
  for (const list of [
    parseOptionalArray(normalizedGraph.goal_edges),
    parseOptionalArray(normalizedGraph.goalEdges),
    parseOptionalArray(normalizedGraph.edges),
  ]) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        edges.push(normalizeFactoryRequestGoalEdge(entry));
      }
    }
  }

  return edges;
}

function normalizeFactoryRequestGoalIssueSet(rawIssueSet = {}, { normalizeTextList }) {
  const issueSet = asPlainObject(rawIssueSet);
  return {
    issue_set_id: trim(issueSet.issue_set_id || issueSet.issueSetId || issueSet.id),
    title: trim(issueSet.title || issueSet.name || issueSet.issue_set_title || issueSet.issueSetTitle),
    goal_ids: normalizeTextList(issueSet.goal_ids || issueSet.goalIds || issueSet.goals || issueSet.goal_id || issueSet.goalId),
    feature_ids: normalizeTextList(
      issueSet.feature_ids
      || issueSet.featureIds
      || issueSet.features
      || issueSet.approved_features
      || issueSet.approvedFeatures,
    ),
  };
}

function buildFactoryRequestGoalGraphFromPlan(factoryRequestPlan = {}, { normalizeFactoryRequestPlanShape }) {
  const plan = normalizeFactoryRequestPlanShape(factoryRequestPlan);

  const prerequisiteGoals = [];
  const goalIssueSets = [];
  const goalEdges = [];

  if (plan.reusable_capability_gaps.length > 0) {
    prerequisiteGoals.push({
      goal_id: "prerequisite_reusable_capability_gaps",
      goal_kind: FACTORY_REQUEST_GOAL_KIND_PREREQUISITE,
      title: "Ship reusable capability gaps",
      issue_set_id: "issue_set_reusable_capability_gaps",
    });
    goalIssueSets.push({
      issue_set_id: "issue_set_reusable_capability_gaps",
      title: "Reusable capability gaps",
      goal_ids: ["prerequisite_reusable_capability_gaps"],
      feature_ids: [...new Set(plan.reusable_capability_gaps.map((entry) => trim(entry?.feature_id)).filter(Boolean))],
    });
  }

  if (plan.reusable_policy_profile_gaps.length > 0) {
    prerequisiteGoals.push({
      goal_id: "prerequisite_reusable_policy_profile_gaps",
      goal_kind: FACTORY_REQUEST_GOAL_KIND_PREREQUISITE,
      title: "Ship reusable policy/profile gaps",
      issue_set_id: "issue_set_reusable_policy_profile_gaps",
    });
    goalIssueSets.push({
      issue_set_id: "issue_set_reusable_policy_profile_gaps",
      title: "Reusable policy/profile gaps",
      goal_ids: ["prerequisite_reusable_policy_profile_gaps"],
      feature_ids: [...new Set(plan.reusable_policy_profile_gaps.map((entry) => trim(entry?.feature_id)).filter(Boolean))],
    });
  }

  const finalInstantiationGoal = {
    goal_id: "final_factory_instantiation",
    goal_kind: FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION,
    title: "Instantiate target factory",
    issue_set_id: "issue_set_final_factory_instantiation",
  };

  goalIssueSets.push({
    issue_set_id: "issue_set_final_factory_instantiation",
    title: "Factory instantiation and domain residues",
    goal_ids: ["final_factory_instantiation"],
    feature_ids: [...new Set([
      ...plan.factory_instance_wiring.map((entry) => trim(entry?.feature_id)).filter(Boolean),
      ...plan.domain_specific_residues.map((entry) => trim(entry?.feature_id)).filter(Boolean),
    ])],
  });

  for (const prerequisiteGoal of prerequisiteGoals) {
    goalEdges.push({
      from_goal_id: prerequisiteGoal.goal_id,
      to_goal_id: finalInstantiationGoal.goal_id,
    });
  }

  return {
    schema_version: FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION,
    prerequisite_goals: prerequisiteGoals,
    final_instantiation_goal: finalInstantiationGoal,
    goal_edges: goalEdges,
    goal_issue_sets: goalIssueSets,
  };
}

function detectFactoryRequestGoalGraphCycle(goalIds = [], edges = []) {
  const adjacency = new Map(goalIds.map((goalId) => [goalId, []]));
  for (const edge of edges) {
    const from = trim(edge?.from_goal_id);
    const to = trim(edge?.to_goal_id);
    if (!from || !to) continue;
    const next = adjacency.get(from) || [];
    next.push(to);
    adjacency.set(from, next);
  }

  const visited = new Set();
  const inStack = new Set();

  const dfs = (goalId) => {
    if (inStack.has(goalId)) return true;
    if (visited.has(goalId)) return false;

    visited.add(goalId);
    inStack.add(goalId);

    for (const neighbor of adjacency.get(goalId) || []) {
      if (dfs(neighbor)) return true;
    }

    inStack.delete(goalId);
    return false;
  };

  return goalIds.some((goalId) => dfs(goalId));
}

function hasPathBetweenGoals(adjacency = new Map(), fromGoalId = "", toGoalId = "") {
  const source = trim(fromGoalId);
  const target = trim(toGoalId);
  if (!source || !target) return false;
  if (source === target) return true;

  const queue = [source];
  const visited = new Set(queue);

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (neighbor === target) return true;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return false;
}

export function normalizeFactoryRequestGoalGraph(
  rawGraph = {},
  { approvedFeatures = [], normalizeTextList = (value) => value } = {},
) {
  const normalizedGraph = asPlainObject(rawGraph);
  const errors = [];

  const rawNodes = extractFactoryRequestGoalNodes(normalizedGraph);
  const normalizedNodes = rawNodes.map(({ node, defaultGoalKind = "" }) =>
    normalizeFactoryRequestGoalNode(node, defaultGoalKind));

  if (normalizedNodes.length === 0) {
    errors.push("missing_goal_nodes");
  }

  const nodeById = new Map();
  for (let index = 0; index < normalizedNodes.length; index += 1) {
    const node = normalizedNodes[index];
    if (!node.goal_id) {
      errors.push(`missing_goal_id:index=${index}`);
      continue;
    }
    if (!node.goal_kind) {
      errors.push(`invalid_goal_kind:${node.goal_id}`);
      continue;
    }
    if (!node.title) {
      errors.push(`missing_goal_title:${node.goal_id}`);
      continue;
    }
    if (!node.issue_set_id) {
      errors.push(`missing_issue_set_id:${node.goal_id}`);
      continue;
    }
    if (nodeById.has(node.goal_id)) {
      errors.push(`duplicate_goal_id:${node.goal_id}`);
      continue;
    }

    nodeById.set(node.goal_id, node);
  }

  const goals = [...nodeById.values()].sort((left, right) => left.goal_id.localeCompare(right.goal_id));
  const prerequisiteGoals = goals
    .filter((node) => node.goal_kind === FACTORY_REQUEST_GOAL_KIND_PREREQUISITE)
    .sort((left, right) => left.goal_id.localeCompare(right.goal_id));
  const finalGoals = goals.filter((node) => node.goal_kind === FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION);

  if (finalGoals.length !== 1) {
    errors.push(`final_instantiation_goal_count:${finalGoals.length}`);
  }

  const goalIds = goals.map((node) => node.goal_id);

  const rawEdges = extractFactoryRequestGoalEdges(normalizedGraph);
  const uniqueEdgeIds = new Set();
  const goalEdges = [];
  for (const edge of rawEdges) {
    const fromGoalId = trim(edge.from_goal_id);
    const toGoalId = trim(edge.to_goal_id);
    if (!fromGoalId || !toGoalId) {
      errors.push("malformed_goal_edge");
      continue;
    }
    if (!nodeById.has(fromGoalId) || !nodeById.has(toGoalId)) {
      errors.push(`unknown_goal_edge_reference:${fromGoalId}->${toGoalId}`);
      continue;
    }
    if (fromGoalId === toGoalId) {
      errors.push(`self_goal_edge:${fromGoalId}`);
      continue;
    }
    const edgeId = `${fromGoalId}->${toGoalId}`;
    if (uniqueEdgeIds.has(edgeId)) continue;
    uniqueEdgeIds.add(edgeId);
    goalEdges.push({ from_goal_id: fromGoalId, to_goal_id: toGoalId });
  }

  if (prerequisiteGoals.length > 0 && goalEdges.length === 0) {
    errors.push("goal_edges_empty");
  }

  if (goalEdges.length > 0 && prerequisiteGoals.length === 0) {
    errors.push("missing_prerequisite_goals");
  }

  const finalInstantiationGoal = finalGoals[0] || null;
  if (goalEdges.length > 0 && detectFactoryRequestGoalGraphCycle(goalIds, goalEdges)) {
    errors.push("goal_graph_cycle_detected");
  }

  const adjacency = new Map(goalIds.map((goalId) => [goalId, []]));
  for (const edge of goalEdges) {
    const next = adjacency.get(edge.from_goal_id) || [];
    next.push(edge.to_goal_id);
    adjacency.set(edge.from_goal_id, next);
  }

  if (finalInstantiationGoal) {
    for (const prerequisiteGoal of prerequisiteGoals) {
      if (!hasPathBetweenGoals(adjacency, prerequisiteGoal.goal_id, finalInstantiationGoal.goal_id)) {
        errors.push(`prerequisite_not_ordered_to_final:${prerequisiteGoal.goal_id}`);
      }
    }

    for (const edge of goalEdges) {
      if (edge.from_goal_id === finalInstantiationGoal.goal_id) {
        errors.push(`invalid_final_outgoing_edge:${edge.from_goal_id}->${edge.to_goal_id}`);
      }
    }
  }

  const issueSetById = new Map();

  const rawIssueSets = parseOptionalArray(normalizedGraph.goal_issue_sets || normalizedGraph.goalIssueSets);
  for (const rawIssueSet of rawIssueSets) {
    const normalizedIssueSet = normalizeFactoryRequestGoalIssueSet(rawIssueSet, { normalizeTextList });
    if (!normalizedIssueSet.issue_set_id) {
      errors.push("missing_issue_set_id_record");
      continue;
    }

    const existing = issueSetById.get(normalizedIssueSet.issue_set_id) || {
      issue_set_id: normalizedIssueSet.issue_set_id,
      title: "",
      goal_ids: [],
      feature_ids: [],
    };

    issueSetById.set(normalizedIssueSet.issue_set_id, {
      issue_set_id: normalizedIssueSet.issue_set_id,
      title: normalizedIssueSet.title || existing.title,
      goal_ids: [...new Set([...existing.goal_ids, ...normalizedIssueSet.goal_ids])],
      feature_ids: [...new Set([...existing.feature_ids, ...normalizedIssueSet.feature_ids])],
    });
  }

  for (const node of goals) {
    const existing = issueSetById.get(node.issue_set_id) || {
      issue_set_id: node.issue_set_id,
      title: "",
      goal_ids: [],
      feature_ids: [],
    };
    issueSetById.set(node.issue_set_id, {
      issue_set_id: node.issue_set_id,
      title: existing.title || node.title,
      goal_ids: [...new Set([...existing.goal_ids, node.goal_id])],
      feature_ids: existing.feature_ids,
    });
  }

  for (const feature of Array.isArray(approvedFeatures) ? approvedFeatures : []) {
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) continue;

    const featureId = trim(feature.feature_id || feature.id || feature.slug);
    if (!featureId) continue;

    const issueSetId = trim(
      feature.issue_set_id
      || feature.issueSetId
      || feature.goal_issue_set_id
      || feature.goalIssueSetId,
    );
    const goalId = trim(feature.goal_id || feature.goalId);

    let targetIssueSetId = issueSetId;
    if (!targetIssueSetId && goalId && nodeById.has(goalId)) {
      targetIssueSetId = trim(nodeById.get(goalId)?.issue_set_id);
    }
    if (!targetIssueSetId) continue;

    const existing = issueSetById.get(targetIssueSetId) || {
      issue_set_id: targetIssueSetId,
      title: "",
      goal_ids: [],
      feature_ids: [],
    };

    issueSetById.set(targetIssueSetId, {
      issue_set_id: targetIssueSetId,
      title: existing.title || trim(feature.issue_set_title || feature.issueSetTitle) || targetIssueSetId,
      goal_ids: existing.goal_ids,
      feature_ids: [...new Set([...existing.feature_ids, featureId])],
    });
  }

  const goalIssueSets = [...issueSetById.values()]
    .map((issueSet) => ({
      issue_set_id: issueSet.issue_set_id,
      title: trim(issueSet.title) || issueSet.issue_set_id,
      goal_ids: [...new Set(issueSet.goal_ids.map((entry) => trim(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
      feature_ids: [...new Set(issueSet.feature_ids.map((entry) => trim(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.issue_set_id.localeCompare(right.issue_set_id));

  return {
    normalized: {
      schema_version: FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION,
      prerequisite_goals: prerequisiteGoals,
      final_instantiation_goal: finalInstantiationGoal || {
        goal_id: "",
        goal_kind: FACTORY_REQUEST_GOAL_KIND_FINAL_INSTANTIATION,
        title: "",
        issue_set_id: "",
      },
      goal_edges: goalEdges.sort((left, right) => {
        const from = left.from_goal_id.localeCompare(right.from_goal_id);
        return from !== 0 ? from : left.to_goal_id.localeCompare(right.to_goal_id);
      }),
      goal_issue_sets: goalIssueSets,
    },
    errors,
  };
}

export function buildFactoryRequestGoalGraph({
  goalContext = {},
  approvedFeatures = [],
  factoryRequestPlan = {},
  normalizeFactoryRequestPlanShape,
  normalizeTextList,
} = {}) {
  const explicitGoalGraph = extractFactoryRequestGoalGraphCandidate({ goalContext, approvedFeatures });
  const candidateGoalGraph = Object.keys(explicitGoalGraph).length > 0
    ? explicitGoalGraph
    : buildFactoryRequestGoalGraphFromPlan(factoryRequestPlan, { normalizeFactoryRequestPlanShape });

  const { normalized, errors } = normalizeFactoryRequestGoalGraph(candidateGoalGraph, {
    approvedFeatures,
    normalizeTextList,
  });

  if (errors.length > 0) {
    throw new Error(`invalid_factory_request_goal_graph:${errors.join(",")}`);
  }

  return normalized;
}
