import { trim } from "../lib/cli-helpers.ts";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeOptionalIssueNumber(value = "") {
  const normalized = trim(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizeTextList(value) {
  return [...new Set((Array.isArray(value) ? value.flat(Infinity) : [value])
    .map((entry) => trim(entry))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function getFeatureIssueSetId(feature = {}) {
  const source = feature?.source_feature;
  if (!isPlainObject(source)) return "";
  return trim(
    source.issue_set_id
    || source.issueSetId
    || source.goal_issue_set_id
    || source.goalIssueSetId,
  );
}

function getFeatureGoalId(feature = {}) {
  const source = feature?.source_feature;
  if (!isPlainObject(source)) return "";
  return trim(source.goal_id || source.goalId);
}

function addGoalIssueNumberHint(hints = new Map(), goalId = "", rawIssueNumber = "") {
  const normalizedGoalId = trim(goalId);
  const normalizedIssueNumber = normalizeOptionalIssueNumber(rawIssueNumber);
  if (!normalizedGoalId || !normalizedIssueNumber) return;
  if (!hints.has(normalizedGoalId)) {
    hints.set(normalizedGoalId, normalizedIssueNumber);
  }
}

function collectFactoryRequestGoalIssueNumberHints(packet = {}) {
  const hints = new Map();

  const graph = isPlainObject(packet?.factory_request_goal_graph)
    ? packet.factory_request_goal_graph
    : {};

  const nodeCandidates = [
    ...(Array.isArray(graph.goals) ? graph.goals : []),
    ...(Array.isArray(graph.prerequisite_goals) ? graph.prerequisite_goals : []),
    ...(isPlainObject(graph.final_instantiation_goal) ? [graph.final_instantiation_goal] : []),
  ];

  for (const node of nodeCandidates) {
    if (!isPlainObject(node)) continue;
    addGoalIssueNumberHint(
      hints,
      node.goal_id || node.goalId || node.id,
      node.goal_issue_number
      || node.goalIssueNumber
      || node.goal_number
      || node.goalNumber
      || node.issue_number
      || node.issueNumber
      || node.number,
    );
  }

  const context = isPlainObject(packet?.goal_context) ? packet.goal_context : {};
  const mappingCandidates = [
    packet?.factory_request_goal_issue_numbers,
    packet?.factoryRequestGoalIssueNumbers,
    context?.factory_request_goal_issue_numbers,
    context?.factoryRequestGoalIssueNumbers,
    context?.goal_issue_numbers,
    context?.goalIssueNumbers,
  ];

  for (const candidate of mappingCandidates) {
    if (!isPlainObject(candidate)) continue;
    for (const [goalId, issueNumber] of Object.entries(candidate)) {
      addGoalIssueNumberHint(hints, goalId, issueNumber);
    }
  }

  const listCandidates = [
    packet?.factory_request_materialized_goals,
    packet?.factoryRequestMaterializedGoals,
    context?.factory_request_materialized_goals,
    context?.factoryRequestMaterializedGoals,
    context?.prerequisite_goals,
  ];

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      if (!isPlainObject(entry)) continue;
      addGoalIssueNumberHint(
        hints,
        entry.goal_id || entry.goalId || entry.id,
        entry.goal_issue_number
        || entry.goalIssueNumber
        || entry.goal_number
        || entry.goalNumber
        || entry.issue_number
        || entry.issueNumber
        || entry.number,
      );
    }
  }

  return hints;
}

export function normalizeGoalIssueMap(goalIssueMap = {}) {
  if (!isPlainObject(goalIssueMap)) return {};
  const entries = Object.entries(goalIssueMap)
    .map(([goalId, issueNumber]) => [trim(goalId), normalizeOptionalIssueNumber(issueNumber)])
    .filter(([goalId, issueNumber]) => goalId && issueNumber)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeIssueNumberList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0))]
    .sort((left, right) => left - right);
}

export function normalizePrerequisiteGoalIssueNumbers(value = []) {
  return normalizeIssueNumberList(value);
}

export function normalizeFinalInstantiationGoalIssueNumber(value = "") {
  const normalized = Number.parseInt(normalizeOptionalIssueNumber(value), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

export function normalizeIssueSetMap(issueSetMap = {}) {
  if (!isPlainObject(issueSetMap)) return {};

  const entries = Object.entries(issueSetMap)
    .map(([issueSetId, payload]) => {
      const normalizedIssueSetId = trim(issueSetId) || trim(payload?.issue_set_id);
      if (!normalizedIssueSetId) return null;

      const goalIssueNumbers = (Array.isArray(payload?.goal_issue_numbers)
        ? payload.goal_issue_numbers
        : [payload?.goal_issue_numbers])
        .map((entry) => normalizeOptionalIssueNumber(entry))
        .filter(Boolean)
        .sort((left, right) => Number(left) - Number(right));

      return [normalizedIssueSetId, {
        issue_set_id: normalizedIssueSetId,
        title: trim(payload?.title),
        goal_ids: normalizeTextList(payload?.goal_ids),
        goal_issue_numbers: [...new Set(goalIssueNumbers)],
        feature_ids: normalizeTextList(payload?.feature_ids),
        created_issue_numbers: normalizeIssueNumberList(payload?.created_issue_numbers),
        created_issue_urls: normalizeTextList(payload?.created_issue_urls),
      }];
    })
    .filter(Boolean)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function collectFactoryRequestGoalIds(factoryRequestGoalGraph = null) {
  if (!factoryRequestGoalGraph || !isPlainObject(factoryRequestGoalGraph)) return [];

  const goalIds = [
    ...(Array.isArray(factoryRequestGoalGraph.prerequisite_goals)
      ? factoryRequestGoalGraph.prerequisite_goals.map((entry) => trim(entry?.goal_id))
      : []),
    trim(factoryRequestGoalGraph?.final_instantiation_goal?.goal_id),
  ].filter(Boolean);

  return [...new Set(goalIds)].sort((left, right) => left.localeCompare(right));
}

export function buildFactoryRequestGoalIssueMap({
  packet = {},
  factoryRequestGoalGraph = null,
  currentGoalIssueNumber = "",
} = {}) {
  if (!factoryRequestGoalGraph) return {};

  const goalIds = collectFactoryRequestGoalIds(factoryRequestGoalGraph);
  if (goalIds.length === 0) {
    throw new Error("factory_request_goal_ids_empty");
  }

  const finalGoalId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.goal_id);
  if (!finalGoalId) {
    throw new Error("missing_factory_request_final_goal_id");
  }

  const hints = collectFactoryRequestGoalIssueNumberHints(packet);
  const currentIssueNumber = normalizeOptionalIssueNumber(currentGoalIssueNumber);
  if (!currentIssueNumber) {
    throw new Error("invalid_current_goal_issue_number_for_factory_request");
  }

  const resolved = {};
  for (const goalId of goalIds) {
    if (goalId === finalGoalId) {
      resolved[goalId] = currentIssueNumber;
      continue;
    }

    const issueNumber = hints.get(goalId) || "";
    if (!issueNumber) {
      throw new Error(`missing_factory_request_goal_issue_number:${goalId}`);
    }

    resolved[goalId] = issueNumber;
  }

  return normalizeGoalIssueMap(resolved);
}

export function resolveFactoryRequestPrerequisiteTargets({
  approvedFeatures = [],
  factoryRequestGoalGraph = null,
  goalIssueMap = {},
  currentGoalIssueNumber = "",
} = {}) {
  if (!factoryRequestGoalGraph) return [];

  const prerequisiteGoals = Array.isArray(factoryRequestGoalGraph.prerequisite_goals)
    ? factoryRequestGoalGraph.prerequisite_goals
      .filter((entry) => isPlainObject(entry))
      .map((entry) => ({
        goal_id: trim(entry.goal_id),
        issue_set_id: trim(entry.issue_set_id),
      }))
      .filter((entry) => entry.goal_id)
    : [];

  if (prerequisiteGoals.length === 0) {
    throw new Error("factory_request_prerequisite_goals_empty");
  }

  const issueSetByGoalId = new Map(prerequisiteGoals.map((entry) => [entry.goal_id, entry.issue_set_id]));

  const featureIdsByIssueSet = new Map();
  for (const issueSet of Array.isArray(factoryRequestGoalGraph.goal_issue_sets)
    ? factoryRequestGoalGraph.goal_issue_sets
    : []) {
    const issueSetId = trim(issueSet?.issue_set_id);
    if (!issueSetId) continue;
    featureIdsByIssueSet.set(issueSetId, new Set(normalizeTextList(issueSet?.feature_ids)));
    for (const goalId of normalizeTextList(issueSet?.goal_ids)) {
      if (!issueSetByGoalId.has(goalId)) continue;
      if (!issueSetByGoalId.get(goalId)) issueSetByGoalId.set(goalId, issueSetId);
    }
  }

  const featuresById = new Map();
  const featuresByIssueSet = new Map();

  for (const feature of approvedFeatures) {
    featuresById.set(feature.feature_id, feature);

    let issueSetId = getFeatureIssueSetId(feature);
    const goalId = getFeatureGoalId(feature);
    if (!issueSetId && goalId) {
      issueSetId = issueSetByGoalId.get(goalId) || "";
    }
    if (!issueSetId) {
      for (const [candidateIssueSetId, featureIds] of featureIdsByIssueSet.entries()) {
        if (!featureIds.has(feature.feature_id)) continue;
        issueSetId = candidateIssueSetId;
        break;
      }
    }
    if (!issueSetId) continue;

    const existing = featuresByIssueSet.get(issueSetId) || [];
    existing.push(feature);
    featuresByIssueSet.set(issueSetId, existing);
  }

  const normalizedGoalIssueMap = normalizeGoalIssueMap(goalIssueMap);
  const targets = [];

  for (const goal of prerequisiteGoals) {
    const issueSetId = goal.issue_set_id || issueSetByGoalId.get(goal.goal_id) || "";
    if (!issueSetId) {
      throw new Error(`missing_prerequisite_goal_issue_set:${goal.goal_id}`);
    }

    let features = (featuresByIssueSet.get(issueSetId) || []).slice();
    if (features.length === 0) {
      const byFeatureIds = [...(featureIdsByIssueSet.get(issueSetId) || [])]
        .map((featureId) => featuresById.get(featureId))
        .filter(Boolean);
      features = byFeatureIds;
    }

    if (features.length === 0) {
      throw new Error(`unresolved_prerequisite_goal_issue_set:${goal.goal_id}:${issueSetId}`);
    }

    let goalIssueNumber = normalizedGoalIssueMap[goal.goal_id] || "";
    if (!goalIssueNumber && prerequisiteGoals.length === 1) {
      goalIssueNumber = normalizeOptionalIssueNumber(currentGoalIssueNumber);
    }

    if (!goalIssueNumber) {
      throw new Error(`missing_prerequisite_goal_issue_number:${goal.goal_id}`);
    }

    targets.push({
      goal_id: goal.goal_id,
      goal_issue_number: goalIssueNumber,
      issue_set_id: issueSetId,
      features,
    });
  }

  return targets.sort((left, right) => Number(left.goal_issue_number) - Number(right.goal_issue_number));
}

export function resolveFactoryRequestFinalInstantiationTargets({
  approvedFeatures = [],
  factoryRequestGoalGraph = null,
  goalIssueMap = {},
  currentGoalIssueNumber = "",
} = {}) {
  if (!factoryRequestGoalGraph) return [];

  const finalGoalId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.goal_id);
  const finalIssueSetId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.issue_set_id);

  const issueSetByGoalId = new Map();
  const featureIdsByIssueSet = new Map();
  const finalIssueSetCandidates = new Set();

  if (finalIssueSetId) {
    finalIssueSetCandidates.add(finalIssueSetId);
  }

  for (const issueSet of Array.isArray(factoryRequestGoalGraph.goal_issue_sets)
    ? factoryRequestGoalGraph.goal_issue_sets
    : []) {
    const issueSetId = trim(issueSet?.issue_set_id);
    if (!issueSetId) continue;

    featureIdsByIssueSet.set(issueSetId, new Set(normalizeTextList(issueSet?.feature_ids)));

    for (const goalId of normalizeTextList(issueSet?.goal_ids)) {
      issueSetByGoalId.set(goalId, issueSetId);
      if (finalGoalId && goalId === finalGoalId) {
        finalIssueSetCandidates.add(issueSetId);
      }
    }
  }

  const finalFeatures = [];
  for (const feature of approvedFeatures) {
    const featureId = trim(feature?.feature_id);
    const featureIssueSetId = getFeatureIssueSetId(feature);
    const featureGoalId = getFeatureGoalId(feature);
    const mappedIssueSetId = featureIssueSetId || (featureGoalId ? issueSetByGoalId.get(featureGoalId) || "" : "");

    let matchesFinal = false;
    if (finalGoalId && featureGoalId === finalGoalId) {
      matchesFinal = true;
    }
    if (!matchesFinal && finalIssueSetId && featureIssueSetId === finalIssueSetId) {
      matchesFinal = true;
    }
    if (!matchesFinal && mappedIssueSetId && finalIssueSetCandidates.has(mappedIssueSetId)) {
      matchesFinal = true;
    }
    if (!matchesFinal && featureId) {
      for (const candidateIssueSetId of finalIssueSetCandidates) {
        if ((featureIdsByIssueSet.get(candidateIssueSetId) || new Set()).has(featureId)) {
          matchesFinal = true;
          break;
        }
      }
    }

    if (matchesFinal) {
      finalFeatures.push(feature);
    }
  }

  if (finalFeatures.length === 0) {
    return [];
  }

  if (!finalGoalId) {
    throw new Error("missing_factory_request_final_goal_id");
  }

  if (!finalIssueSetId) {
    throw new Error(`missing_factory_request_final_issue_set_id:${finalGoalId}`);
  }

  const normalizedGoalIssueMap = normalizeGoalIssueMap(goalIssueMap);
  const goalIssueNumber = normalizedGoalIssueMap[finalGoalId]
    || normalizeOptionalIssueNumber(currentGoalIssueNumber);

  if (!goalIssueNumber) {
    throw new Error(`missing_final_instantiation_goal_issue_number:${finalGoalId}`);
  }

  return [{
    goal_id: finalGoalId,
    goal_issue_number: goalIssueNumber,
    issue_set_id: finalIssueSetId,
    features: [...finalFeatures]
      .sort((left, right) => String(trim(left?.feature_id)).localeCompare(String(trim(right?.feature_id)))),
  }];
}

export function normalizeFactoryRequestPrerequisiteMaterialization(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((entry) => {
      const goalId = trim(entry?.goal_id);
      const goalIssueNumber = normalizeOptionalIssueNumber(entry?.goal_issue_number);
      const issueSetId = trim(entry?.issue_set_id);
      const featureIds = normalizeTextList(entry?.feature_ids);
      const createdIssueNumbers = [...new Set((Array.isArray(entry?.created_issue_numbers) ? entry.created_issue_numbers : [])
        .map((value) => Number.parseInt(String(value || "").trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0))]
        .sort((left, right) => left - right);
      if (!goalId || !goalIssueNumber || !issueSetId) return null;
      return {
        goal_id: goalId,
        goal_issue_number: goalIssueNumber,
        issue_set_id: issueSetId,
        feature_ids: featureIds,
        created_issue_numbers: createdIssueNumbers,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.goal_issue_number) - Number(right.goal_issue_number));
}

function normalizeCreatedFeatureIssueEntries(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((entry) => {
      const featureId = trim(entry?.feature_id);
      const issueNumber = Number.parseInt(String(entry?.issue_number || "").trim(), 10);
      const issueUrl = trim(entry?.issue_url);
      const sourceGoalId = trim(entry?.source_goal_id);
      const sourceIssueSetId = trim(entry?.source_issue_set_id);
      const parentGoalIssueNumber = normalizeOptionalIssueNumber(entry?.parent_goal_issue_number);
      if (!featureId || !Number.isFinite(issueNumber) || issueNumber <= 0 || !issueUrl) return null;
      return {
        feature_id: featureId,
        issue_number: issueNumber,
        issue_url: issueUrl,
        source_goal_id: sourceGoalId,
        source_issue_set_id: sourceIssueSetId,
        parent_goal_issue_number: parentGoalIssueNumber,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.issue_number - right.issue_number);
}

function collectGoalToIssueSetMaps(factoryRequestGoalGraph = null) {
  const issueSetByGoalId = new Map();
  const goalIdsByIssueSetId = new Map();

  for (const goal of Array.isArray(factoryRequestGoalGraph?.prerequisite_goals)
    ? factoryRequestGoalGraph.prerequisite_goals
    : []) {
    const goalId = trim(goal?.goal_id);
    const issueSetId = trim(goal?.issue_set_id);
    if (!goalId || !issueSetId) continue;
    issueSetByGoalId.set(goalId, issueSetId);
    const existing = goalIdsByIssueSetId.get(issueSetId) || new Set();
    existing.add(goalId);
    goalIdsByIssueSetId.set(issueSetId, existing);
  }

  const finalGoalId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.goal_id);
  const finalIssueSetId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.issue_set_id);
  if (finalGoalId && finalIssueSetId) {
    issueSetByGoalId.set(finalGoalId, finalIssueSetId);
    const existing = goalIdsByIssueSetId.get(finalIssueSetId) || new Set();
    existing.add(finalGoalId);
    goalIdsByIssueSetId.set(finalIssueSetId, existing);
  }

  for (const issueSet of Array.isArray(factoryRequestGoalGraph?.goal_issue_sets)
    ? factoryRequestGoalGraph.goal_issue_sets
    : []) {
    const issueSetId = trim(issueSet?.issue_set_id);
    if (!issueSetId) continue;
    const existing = goalIdsByIssueSetId.get(issueSetId) || new Set();
    for (const goalId of normalizeTextList(issueSet?.goal_ids)) {
      issueSetByGoalId.set(goalId, issueSetId);
      existing.add(goalId);
    }
    goalIdsByIssueSetId.set(issueSetId, existing);
  }

  return { issueSetByGoalId, goalIdsByIssueSetId };
}

function resolveGoalIdForCreatedFeature({ entry = {}, factoryRequestGoalGraph = null, issueSetByGoalId = new Map() } = {}) {
  const sourceGoalId = trim(entry?.source_goal_id);
  if (sourceGoalId) return sourceGoalId;

  const sourceIssueSetId = trim(entry?.source_issue_set_id);
  if (sourceIssueSetId) {
    const goals = [...issueSetByGoalId.entries()]
      .filter(([, issueSetId]) => issueSetId === sourceIssueSetId)
      .map(([goalId]) => goalId)
      .sort((left, right) => left.localeCompare(right));
    return goals[0] || "";
  }

  const featureId = trim(entry?.feature_id);
  if (!featureId || !factoryRequestGoalGraph) return "";

  for (const issueSet of Array.isArray(factoryRequestGoalGraph.goal_issue_sets)
    ? factoryRequestGoalGraph.goal_issue_sets
    : []) {
    const featureIds = new Set(normalizeTextList(issueSet?.feature_ids));
    if (!featureIds.has(featureId)) continue;
    const goalIds = normalizeTextList(issueSet?.goal_ids);
    if (goalIds.length > 0) return goalIds[0];
  }

  return "";
}

function resolveIssueSetIdForCreatedFeature({ entry = {}, issueSetByGoalId = new Map() } = {}) {
  const sourceIssueSetId = trim(entry?.source_issue_set_id);
  if (sourceIssueSetId) return sourceIssueSetId;

  const sourceGoalId = trim(entry?.source_goal_id);
  if (sourceGoalId) return issueSetByGoalId.get(sourceGoalId) || "";

  return "";
}

export function buildFactoryRequestMaterializationLedger({
  factoryRequestGoalGraph = null,
  goalIssueMap = {},
  created = [],
  planPacketId = "",
} = {}) {
  const normalizedGoalIssueMap = normalizeGoalIssueMap(goalIssueMap);
  if (!factoryRequestGoalGraph) {
    return {
      goal_issue_map: normalizedGoalIssueMap,
      issue_set_map: {},
      prerequisite_goal_issue_numbers: [],
      final_instantiation_goal_issue_number: null,
      goal_feature_issue_map: {},
      feature_materialization_markers: [],
    };
  }

  const finalGoalId = trim(factoryRequestGoalGraph?.final_instantiation_goal?.goal_id);
  if (!finalGoalId) {
    throw new Error("missing_factory_request_final_goal_id");
  }

  const { issueSetByGoalId, goalIdsByIssueSetId } = collectGoalToIssueSetMaps(factoryRequestGoalGraph);
  const normalizedCreated = normalizeCreatedFeatureIssueEntries(created);
  const issueSetMap = {};

  for (const issueSet of Array.isArray(factoryRequestGoalGraph.goal_issue_sets)
    ? factoryRequestGoalGraph.goal_issue_sets
    : []) {
    const issueSetId = trim(issueSet?.issue_set_id);
    if (!issueSetId) continue;
    const goalIds = normalizeTextList(issueSet?.goal_ids);
    issueSetMap[issueSetId] = {
      issue_set_id: issueSetId,
      title: trim(issueSet?.title || issueSet?.name),
      goal_ids: goalIds,
      goal_issue_numbers: goalIds
        .map((goalId) => normalizeOptionalIssueNumber(normalizedGoalIssueMap[goalId]))
        .filter(Boolean),
      feature_ids: normalizeTextList(issueSet?.feature_ids),
      created_issue_numbers: [],
      created_issue_urls: [],
    };
  }

  const goalFeatureIssueMap = {};
  const markers = new Set();
  const normalizedPlanPacketId = trim(planPacketId);

  for (const entry of normalizedCreated) {
    const goalId = resolveGoalIdForCreatedFeature({
      entry,
      factoryRequestGoalGraph,
      issueSetByGoalId,
    });
    const issueSetId = resolveIssueSetIdForCreatedFeature({ entry, issueSetByGoalId });

    if (goalId) {
      const existing = goalFeatureIssueMap[goalId] || [];
      existing.push({
        feature_id: entry.feature_id,
        issue_number: entry.issue_number,
        issue_url: entry.issue_url,
        issue_set_id: issueSetId,
        parent_goal_issue_number: entry.parent_goal_issue_number || normalizeOptionalIssueNumber(normalizedGoalIssueMap[goalId]),
      });
      goalFeatureIssueMap[goalId] = existing;
    }

    if (issueSetId) {
      const existing = issueSetMap[issueSetId] || {
        issue_set_id: issueSetId,
        title: "",
        goal_ids: [...(goalIdsByIssueSetId.get(issueSetId) || [])].sort((left, right) => left.localeCompare(right)),
        goal_issue_numbers: [],
        feature_ids: [],
        created_issue_numbers: [],
        created_issue_urls: [],
      };
      existing.feature_ids = normalizeTextList([...existing.feature_ids, entry.feature_id]);
      existing.created_issue_numbers = normalizeIssueNumberList([...existing.created_issue_numbers, entry.issue_number]);
      existing.created_issue_urls = normalizeTextList([...existing.created_issue_urls, entry.issue_url]);
      if (existing.goal_issue_numbers.length === 0) {
        existing.goal_issue_numbers = existing.goal_ids
          .map((goalId) => normalizeOptionalIssueNumber(normalizedGoalIssueMap[goalId]))
          .filter(Boolean);
      }
      issueSetMap[issueSetId] = existing;
    }

    if (normalizedPlanPacketId) {
      markers.add(`${normalizedPlanPacketId}::feature::${entry.feature_id}`);
      if (goalId) {
        markers.add(`${normalizedPlanPacketId}::goal::${goalId}::feature::${entry.feature_id}`);
      }
    }
  }

  const normalizedGoalFeatureIssueMap = Object.fromEntries(
    Object.entries(goalFeatureIssueMap)
      .map(([goalId, rows]) => [trim(goalId), (Array.isArray(rows) ? rows : [])
        .filter((entry) => trim(entry?.feature_id))
        .sort((left, right) => {
          const issueDiff = Number(left.issue_number) - Number(right.issue_number);
          if (issueDiff !== 0) return issueDiff;
          return String(left.feature_id).localeCompare(String(right.feature_id));
        })])
      .filter(([goalId, rows]) => goalId && rows.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  const prerequisiteGoalIssueNumbers = normalizePrerequisiteGoalIssueNumbers(
    (Array.isArray(factoryRequestGoalGraph?.prerequisite_goals) ? factoryRequestGoalGraph.prerequisite_goals : [])
      .map((goal) => {
        const goalId = trim(goal?.goal_id);
        const mapped = normalizeOptionalIssueNumber(normalizedGoalIssueMap[goalId]);
        if (!mapped) {
          throw new Error(`missing_prerequisite_goal_issue_number:${goalId}`);
        }
        return mapped;
      }),
  );

  const finalInstantiationGoalIssueNumber = normalizeFinalInstantiationGoalIssueNumber(
    normalizeOptionalIssueNumber(normalizedGoalIssueMap[finalGoalId]),
  );

  return {
    goal_issue_map: normalizedGoalIssueMap,
    issue_set_map: normalizeIssueSetMap(issueSetMap),
    prerequisite_goal_issue_numbers: prerequisiteGoalIssueNumbers,
    final_instantiation_goal_issue_number: finalInstantiationGoalIssueNumber,
    goal_feature_issue_map: normalizedGoalFeatureIssueMap,
    feature_materialization_markers: [...markers].sort((left, right) => left.localeCompare(right)),
  };
}

export function resolveAndSyncGoalBlockedByEdges({
  repo = "",
  factoryRequestGoalGraph = null,
  goalIssueMap = {},
  syncBlockedByFn,
} = {}) {
  if (!factoryRequestGoalGraph) return [];

  const normalizedGoalIssueMap = normalizeGoalIssueMap(goalIssueMap);
  const goalEdges = Array.isArray(factoryRequestGoalGraph.goal_edges)
    ? factoryRequestGoalGraph.goal_edges
    : [];

  if (goalEdges.length === 0) {
    throw new Error("factory_request_goal_edges_empty");
  }

  const blockedByByIssue = new Map();

  for (const edge of goalEdges) {
    const fromGoalId = trim(edge?.from_goal_id);
    const toGoalId = trim(edge?.to_goal_id);
    if (!fromGoalId || !toGoalId) {
      throw new Error("invalid_factory_request_goal_edge");
    }

    const blockerIssueNumber = normalizeOptionalIssueNumber(normalizedGoalIssueMap[fromGoalId]);
    const targetIssueNumber = normalizeOptionalIssueNumber(normalizedGoalIssueMap[toGoalId]);
    if (!blockerIssueNumber || !targetIssueNumber) {
      throw new Error(`missing_factory_request_goal_edge_issue_mapping:${fromGoalId}->${toGoalId}`);
    }

    const existing = blockedByByIssue.get(targetIssueNumber) || new Set();
    existing.add(Number.parseInt(blockerIssueNumber, 10));
    blockedByByIssue.set(targetIssueNumber, existing);
  }

  const appliedEdges = [...blockedByByIssue.entries()]
    .map(([issueNumber, blockers]) => ({
      issue_number: Number.parseInt(issueNumber, 10),
      blocked_by: [...blockers]
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right),
    }))
    .filter((entry) => Number.isFinite(entry.issue_number) && entry.issue_number > 0)
    .sort((left, right) => left.issue_number - right.issue_number);

  for (const edge of appliedEdges) {
    const out = syncBlockedByFn({
      repo,
      issueNumber: edge.issue_number,
      blockedByRaw: JSON.stringify(edge.blocked_by),
    });

    if (out?.ok === false || out?.synced === false) {
      throw new Error(`sync_goal_blocked_by_failed:${edge.issue_number}`);
    }
  }

  return appliedEdges;
}
