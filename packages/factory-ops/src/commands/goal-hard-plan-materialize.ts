import { readFileSync, existsSync } from "node:fs";

import { createGitHubIssueFromSpec } from "./common-create-issue.ts";
import { resolveGhRepo } from "./common-resolve-gh-repo.ts";
import { readGoalExecutionPath } from "./goal-execution-path.ts";
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
} from "./goal-hard-plan-materialize-factory-request.ts";
import { normalizeFactoryRequestGoalGraph } from "./goal-hard-planning-factory-request-goal-graph.ts";
import { addSubIssue } from "./goal-sub-issues.ts";
import { resolveFeatureDependencies } from "./triage-resolve-feature-dependencies.ts";
import { syncBlockedBy } from "./triage-sync-blocked-by.ts";
import { parseJson, trim, gh } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  getFactoryLabelNames,
} from "../lib/factory-label-contract.ts";
import {
  buildGoalDecompositionPacket,
  persistGoalDecompositionPacket,
} from "../lib/goal-decomposition-packet.ts";
import {
  buildGoalHardPlanMaterializationPacket,
  getLatestGoalHardPlanMaterializationPacket,
  persistGoalHardPlanMaterializationPacket,
} from "../lib/goal-hard-plan-materialization-packet.ts";
import { appendRationaleFeature } from "../lib/goal-rationale-doc.ts";
import { listPersistedFactoryPackets } from "../lib/packet-core.ts";

const HARD_PLAN_MARKER = "<!-- goal-run:hard-plan-artifact -->";

function normalizeTextList(value) {
  return [...new Set((Array.isArray(value) ? value.flat(Infinity) : [value])
    .map((entry) => trim(entry))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function parseObject(raw = "") {
  const parsed = parseJson(String(raw || ""), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function readJsonFile(path = "") {
  const normalized = trim(path);
  if (!normalized) throw new Error("missing_planning_artifact_path");
  if (!existsSync(normalized)) throw new Error(`planning_artifact_missing:${normalized}`);

  try {
    return parseObject(readFileSync(normalized, "utf8"));
  } catch (error) {
    throw new Error(`planning_artifact_unreadable:${String(error?.message || error)}`);
  }
}

function normalizeGoalIssueNumber(value = "") {
  const normalized = trim(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error("invalid_goal_issue_number");
  }
  return normalized;
}

function normalizePlanningState(value = "") {
  return trim(value).toLowerCase();
}

function normalizeDependencyList(feature = {}) {
  const candidates = [
    feature?.dependencies,
    feature?.blocked_by,
    feature?.blockedBy,
  ];

  const values = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const normalized = trim(entry);
      if (normalized) values.push(normalized);
    }
  }

  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeAcceptanceCriteria(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => trim(entry))
    .filter(Boolean))];
}

function normalizeFeature(feature = {}, index = 0) {
  const fallbackIndex = index + 1;
  const featureId = trim(
    feature?.feature_id
    || feature?.id
    || feature?.slug
    || feature?.name,
  ) || `feature-${fallbackIndex}`;

  const title = trim(
    feature?.name
    || feature?.title
    || feature?.summary,
  ) || `Feature ${fallbackIndex}`;

  const summary = trim(
    feature?.summary
    || feature?.description
    || feature?.scope,
  ) || "No summary provided in approved hard-plan artifact.";

  const scope = trim(feature?.scope);
  const domain = trim(feature?.domain);
  const dependencies = normalizeDependencyList(feature);
  const acceptanceCriteria = normalizeAcceptanceCriteria(feature?.acceptance_criteria || feature?.acceptanceCriteria);

  return {
    feature_id: featureId,
    title,
    summary,
    scope,
    domain,
    work_item_kind: trim(feature?.work_item_kind || feature?.workItemKind),
    dependencies,
    acceptance_criteria: acceptanceCriteria,
    source_feature: feature,
  };
}

function topoSortFeatures(features = []) {
  const byId = new Map();
  for (const feature of features) {
    byId.set(feature.feature_id, feature);
  }

  for (const feature of features) {
    for (const dependency of feature.dependencies) {
      if (!byId.has(dependency)) {
        throw new Error(`unresolved_feature_dependency:${feature.feature_id}->${dependency}`);
      }
    }
  }

  const inDegree = new Map();
  const adjacency = new Map();

  for (const feature of features) {
    inDegree.set(feature.feature_id, feature.dependencies.length);
    adjacency.set(feature.feature_id, []);
  }

  for (const feature of features) {
    for (const dependency of feature.dependencies) {
      const dependents = adjacency.get(dependency) || [];
      dependents.push(feature.feature_id);
      adjacency.set(dependency, dependents);
    }
  }

  const queue = [...features
    .filter((feature) => (inDegree.get(feature.feature_id) || 0) === 0)
    .map((feature) => feature.feature_id)]
    .sort((left, right) => left.localeCompare(right));

  const ordered = [];
  while (queue.length > 0) {
    const currentId = queue.shift();
    ordered.push(byId.get(currentId));

    const dependents = [...(adjacency.get(currentId) || [])].sort((left, right) => left.localeCompare(right));
    for (const dependentId of dependents) {
      const next = (inDegree.get(dependentId) || 0) - 1;
      inDegree.set(dependentId, next);
      if (next === 0) {
        queue.push(dependentId);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== features.length) {
    throw new Error("feature_dependency_cycle_detected");
  }

  return ordered;
}

function normalizeApprovedFeatures(rawFeatures = []) {
  const normalized = (Array.isArray(rawFeatures) ? rawFeatures : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => normalizeFeature(entry, index));

  if (normalized.length === 0) {
    throw new Error("approved_features_empty");
  }

  const unique = new Map();
  for (const feature of normalized) {
    if (unique.has(feature.feature_id)) {
      throw new Error(`duplicate_feature_id:${feature.feature_id}`);
    }
    unique.set(feature.feature_id, feature);
  }

  const sortedById = [...unique.values()].sort((left, right) => left.feature_id.localeCompare(right.feature_id));
  return topoSortFeatures(sortedById);
}

function buildIssueBody({
  feature = {},
  goalIssueNumber = "",
  planPacketId = "",
  planningArtifactPath = "",
  goalId = "",
  issueSetId = "",
} = {}) {
  const acceptanceCriteria = feature.acceptance_criteria.length > 0
    ? feature.acceptance_criteria
    : ["Implement the feature deterministically and verify with focused tests."];

  return [
    `# Summary`,
    feature.summary,
    "",
    feature.scope ? "# Scope" : "",
    feature.scope || "",
    feature.domain ? "# Domain" : "",
    feature.domain || "",
    "# Acceptance Criteria",
    ...acceptanceCriteria.map((entry) => `- ${entry}`),
    "",
    "# Traceability",
    `- parent_goal_issue: #${goalIssueNumber}`,
    `- hard_plan_packet_id: ${planPacketId}`,
    `- planning_artifact_path: ${planningArtifactPath}`,
    `- source_feature_id: ${feature.feature_id}`,
    issueSetId ? `- source_issue_set_id: ${issueSetId}` : "",
    goalId ? `- source_goal_id: ${goalId}` : "",
    HARD_PLAN_MARKER,
  ].filter(Boolean).join("\n");
}

function buildIssueSpec({
  feature = {},
  goalIssueNumber = "",
  planPacketId = "",
  planningArtifactPath = "",
  goalId = "",
  issueSetId = "",
  factoryId = "mothership",
} = {}) {
  const labels = getFactoryLabelNames(factoryId, [
    FACTORY_LABEL_KEYS.FEATURE,
    FACTORY_LABEL_KEYS.READY,
  ]).join(",");

  return {
    issue_title: feature.title,
    issue_body: buildIssueBody({
      feature,
      goalIssueNumber,
      planPacketId,
      planningArtifactPath,
      goalId,
      issueSetId,
    }),
    issue_labels: labels,
  };
}

function parsePlanningArtifact({ planningArtifactPath = "", planPacketId = "", goalNumber = "" } = {}) {
  const packet = readJsonFile(planningArtifactPath);
  const packetType = trim(packet?.packet_type).toLowerCase();
  const schemaVersion = trim(packet?.schema_version).toLowerCase();
  const packetGoalIssueNumber = normalizeGoalIssueNumber(packet?.goal_issue_number || packet?.goal_number || goalNumber);
  const normalizedGoalNumber = trim(goalNumber);
  const packetPlanningState = normalizePlanningState(
    packet?.planning_state
      || packet?.goal_routing_state?.planning_state
      || "",
  );

  if (!(packetType === "hard_plan_packet" || packetType === "goal_hard_plan_packet")) {
    throw new Error(`invalid_planning_packet_type:${packetType || "(empty)"}`);
  }

  if (!schemaVersion) {
    throw new Error("missing_planning_packet_schema_version");
  }

  if (packetPlanningState && packetPlanningState !== "approved") {
    throw new Error(`planning_state_not_approved:${packetPlanningState}`);
  }

  if (normalizedGoalNumber && packetGoalIssueNumber !== normalizedGoalNumber) {
    throw new Error(`goal_issue_number_mismatch:${packetGoalIssueNumber}!=${normalizedGoalNumber}`);
  }

  if (trim(planPacketId) && trim(packet?.packet_id) && trim(packet.packet_id) !== trim(planPacketId)) {
    throw new Error(`plan_packet_id_mismatch:${trim(packet.packet_id)}!=${trim(planPacketId)}`);
  }

  const goalIssue = packet?.goal_issue && typeof packet.goal_issue === "object" && !Array.isArray(packet.goal_issue)
    ? packet.goal_issue
    : {};
  const goalContext = packet?.goal_context && typeof packet.goal_context === "object" && !Array.isArray(packet.goal_context)
    ? packet.goal_context
    : {};
  const approvedFeatures = normalizeApprovedFeatures(packet?.approved_features);
  const rationale = appendRationaleFeature({
    approvedFeaturesRaw: JSON.stringify(approvedFeatures.map((entry) => entry.source_feature)),
    goalIssueRaw: JSON.stringify(goalIssue),
    executionPath: packet?.execution_path || packet?.goal_execution_path || packet?.goal_routing_state?.goal_execution_path || "hard",
    understandingRisk: packet?.understanding_risk || goalContext?.understanding_risk || "",
    rationaleRequired: packet?.rationale_required,
    classificationSignals: packet?.classification_signals,
  });
  const approvedFeaturesWithRationale = normalizeApprovedFeatures(parseJson(rationale.approved_features, []));
  const graphApprovedFeatures = approvedFeaturesWithRationale.filter((entry) => !isRationaleFeature(entry));

  const goalRequestType = trim(packet?.goal_request_type).toLowerCase();
  const goalContextGraph = goalContext?.factory_request_goal_graph
    && typeof goalContext.factory_request_goal_graph === "object"
    && !Array.isArray(goalContext.factory_request_goal_graph)
    ? goalContext.factory_request_goal_graph
    : {};
  const goalGraphRaw = packet?.factory_request_goal_graph
    && typeof packet.factory_request_goal_graph === "object"
    && !Array.isArray(packet.factory_request_goal_graph)
    ? packet.factory_request_goal_graph
    : goalContextGraph;

  let factoryRequestGoalGraph = null;
  if (goalRequestType === "factory_request" || Object.keys(goalGraphRaw).length > 0) {
    if (Object.keys(goalGraphRaw).length === 0) {
      throw new Error("missing_factory_request_goal_graph");
    }

    const { normalized, errors } = normalizeFactoryRequestGoalGraph(goalGraphRaw, {
      approvedFeatures: graphApprovedFeatures.map((entry) => entry.source_feature),
      normalizeTextList,
    });

    if (errors.length > 0) {
      throw new Error(`invalid_factory_request_goal_graph:${errors.join(",")}`);
    }

    factoryRequestGoalGraph = normalized;
  }

  return {
    packet,
    plan_packet_id: trim(packet?.packet_id) || trim(planPacketId),
    goal_issue_number: packetGoalIssueNumber,
    goal_issue: goalIssue,
    goal_context: goalContext,
    approved_features: approvedFeaturesWithRationale,
    goal_request_type: goalRequestType || "standard",
    factory_request_goal_graph: factoryRequestGoalGraph,
  };
}


function normalizeIssueNumberFromUrl(url = "") {
  const match = trim(url).match(/\/issues\/(\d+)(?:\/|$)/);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function createIssuesFromFeatures({
  repo = "",
  features = [],
  goalIssueNumber = "",
  goalId = "",
  issueSetId = "",
  planPacketId = "",
  planningArtifactPath = "",
  factoryId = "mothership",
  createIssueFn = createGitHubIssueFromSpec,
} = {}) {
  const created = [];

  for (const feature of features) {
    const issueSpec = buildIssueSpec({
      feature,
      goalIssueNumber,
      planPacketId,
      planningArtifactPath,
      goalId,
      issueSetId,
      factoryId,
    });

    const out = createIssueFn({
      repo,
      issueSpecRaw: JSON.stringify(issueSpec),
    });

    if (!out?.ok) {
      throw new Error(`issue_create_failed:${feature.feature_id}:${trim(out?.error || out?.stderr || "unknown")}`);
    }

    const issueUrl = trim(out?.issue_url);
    const issueNumber = Number.parseInt(trim(out?.created_issue_number), 10)
      || normalizeIssueNumberFromUrl(issueUrl)
      || 0;

    if (!issueNumber || !issueUrl) {
      throw new Error(`issue_create_invalid_response:${feature.feature_id}`);
    }

    created.push({
      feature_id: feature.feature_id,
      issue_number: issueNumber,
      issue_url: issueUrl,
      blocked_by_feature_ids: [...feature.dependencies],
      issue_spec: issueSpec,
      source_goal_id: trim(goalId),
      source_issue_set_id: trim(issueSetId),
      parent_goal_issue_number: normalizeOptionalIssueNumber(goalIssueNumber),
    });
  }

  return {
    created,
  };
}

function isRationaleFeature(feature = {}) {
  return trim(feature?.work_item_kind || feature?.source_feature?.work_item_kind).toLowerCase() === "rationale_doc";
}

function linkSubIssues({
  repo = "",
  goalIssueNumber = "",
  created = [],
  addSubIssueFn = addSubIssue,
} = {}) {
  const links = [];

  for (const entry of created) {
    const out = addSubIssueFn({
      repo,
      parentNumber: goalIssueNumber,
      childNumber: entry.issue_number,
    });

    if (!out?.ok) {
      throw new Error(`add_sub_issue_failed:${entry.issue_number}:${trim(out?.error || "unknown")}`);
    }

    links.push({ parent: Number(goalIssueNumber), child: entry.issue_number });
  }

  return links;
}

function buildFeatureIssueMapForDependencyResolution({ created = [] } = {}) {
  return created
    .map((entry) => ({
      issue_number: entry.issue_number,
      issue_url: trim(entry.issue_url),
      feature: {
        id: entry.feature_id,
        dependencies: Array.isArray(entry.blocked_by_feature_ids) ? entry.blocked_by_feature_ids : [],
      },
    }))
    .sort((left, right) => Number(left.issue_number) - Number(right.issue_number));
}

function resolveAndSyncBlockedByEdges({
  repo = "",
  created = [],
  syncBlockedByFn = syncBlockedBy,
  resolveFeatureDependenciesFn = resolveFeatureDependencies,
} = {}) {
  const featureIssueMap = buildFeatureIssueMapForDependencyResolution({ created });
  const resolved = resolveFeatureDependenciesFn({
    featureIssueMapRaw: JSON.stringify(featureIssueMap),
    repo,
    syncBlockedByFn,
    applySync: false,
    failOnUnresolvedRefs: true,
  });

  const byIssue = new Map((Array.isArray(resolved.dependencies) ? resolved.dependencies : []).map((entry) => [
    Number(entry.issue_number),
    Array.isArray(entry.blocked_by)
      ? [...new Set(entry.blocked_by.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))].sort((left, right) => left - right)
      : [],
  ]));

  const allEdges = created
    .map((entry) => ({
      issue_number: Number(entry.issue_number),
      blocked_by: byIssue.get(Number(entry.issue_number)) || [],
    }))
    .filter((entry) => Number.isFinite(entry.issue_number) && entry.issue_number > 0)
    .sort((left, right) => left.issue_number - right.issue_number);

  for (const edge of allEdges) {
    const out = syncBlockedByFn({
      repo,
      issueNumber: edge.issue_number,
      blockedByRaw: JSON.stringify(edge.blocked_by),
    });

    if (out?.ok === false || out?.synced === false) {
      throw new Error(`sync_blocked_by_failed:${edge.issue_number}`);
    }
  }

  return allEdges;
}

function persistMaterializationLedger({
  repoRoot = ".",
  factoryId = "mothership",
  runId = "",
  goalIssueNumber = "",
  goalIssue = {},
  goalContext = {},
  planPacketId = "",
  planningArtifactPath = "",
  approvedFeatures = [],
  created = [],
  blockedByEdges = [],
  goalBlockedByEdges = [],
  goalIssueMap = {},
  issueSetMap = {},
  prerequisiteGoalIssueNumbers = [],
  finalInstantiationGoalIssueNumber = null,
  goalFeatureIssueMap = {},
  featureMaterializationMarkers = [],
  factoryRequestPrerequisiteMaterialization = [],
  pipeline = "goal_hard_plan_materialize",
  nodeId = "materialize_hard_plan",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const decompositionPacket = buildGoalDecompositionPacket({
    goalIssueRaw: JSON.stringify(goalIssue && Object.keys(goalIssue).length > 0
      ? goalIssue
      : { number: Number(goalIssueNumber), title: `Goal ${goalIssueNumber}` }),
    goalContextRaw: JSON.stringify(goalContext && Object.keys(goalContext).length > 0 ? goalContext : {}),
    goalIssueNumber,
    approvedFeaturesRaw: JSON.stringify(approvedFeatures.map((entry) => entry.source_feature)),
    issueUrlsRaw: JSON.stringify(created.map((entry) => entry.issue_url)),
    factoryId,
    runId: "",
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persistedDecomposition = persistGoalDecompositionPacket({
    repo: repoRoot,
    packet: decompositionPacket,
  });

  const packet = buildGoalHardPlanMaterializationPacket({
    goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    decompositionPacketId: persistedDecomposition.packet_ref.packet_id,
    decompositionPacketPath: persistedDecomposition.packet_path,
    approvedFeatureIds: approvedFeatures.map((entry) => entry.feature_id),
    approvedFeatures: approvedFeatures.map((entry) => entry.source_feature),
    createdIssueNumbers: created.map((entry) => entry.issue_number),
    createdIssueUrls: created.map((entry) => entry.issue_url),
    featureIssueMap: created,
    blockedByEdges,
    goalBlockedByEdges,
    goalIssueMap,
    issueSetMap,
    prerequisiteGoalIssueNumbers,
    finalInstantiationGoalIssueNumber,
    goalFeatureIssueMap,
    featureMaterializationMarkers,
    materializationState: "completed",
    factoryRequestPrerequisiteMaterialization,
    factoryId,
    runId: "",
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persistedMaterialization = persistGoalHardPlanMaterializationPacket({
    repo: repoRoot,
    packet,
  });

  return {
    materialization_packet_path: persistedMaterialization.packet_path,
    materialization_packet_id: persistedMaterialization.packet_ref.packet_id,
    decomposition_packet_path: persistedDecomposition.packet_path,
    decomposition_packet_id: persistedDecomposition.packet_ref.packet_id,
  };
}

function buildReplayOutput({ existing = null, holdCleanup = {} } = {}) {
  const packet = existing?.packet || {};
  const featureIssueMap = Array.isArray(packet.feature_issue_map) ? packet.feature_issue_map : [];
  const createdIssueNumbers = featureIssueMap.map((entry) => Number(entry.issue_number));
  const issueUrls = featureIssueMap.map((entry) => trim(entry.issue_url)).filter(Boolean);
  const approvedFeatures = Array.isArray(packet.approved_features)
    ? packet.approved_features.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
  const factoryRequestPrerequisiteMaterialization = normalizeFactoryRequestPrerequisiteMaterialization(
    packet.factory_request_prerequisite_materialization,
  );
  const goalIssueNumber = trim(packet.goal_issue_number);
  const goalIssueMap = normalizeGoalIssueMap(packet.goal_issue_map);
  const issueSetMap = normalizeIssueSetMap(packet.issue_set_map);
  const prerequisiteGoalIssueNumbers = normalizePrerequisiteGoalIssueNumbers(packet.prerequisite_goal_issue_numbers);
  const finalInstantiationGoalIssueNumber = normalizeFinalInstantiationGoalIssueNumber(
    packet.final_instantiation_goal_issue_number,
  );
  const goalFeatureIssueMap = packet.goal_feature_issue_map && typeof packet.goal_feature_issue_map === "object" && !Array.isArray(packet.goal_feature_issue_map)
    ? packet.goal_feature_issue_map
    : {};
  const featureMaterializationMarkers = normalizeTextList(packet.feature_materialization_markers);

  return {
    goal_issue_number: goalIssueNumber,
    goal_issue: {
      number: Number.parseInt(goalIssueNumber, 10) || Number(goalIssueNumber) || 0,
      title: `Goal ${goalIssueNumber}`,
    },
    goal_context: {},
    approved_features: approvedFeatures,
    plan_packet_id: trim(packet.plan_packet_id),
    planning_artifact_path: trim(packet.planning_artifact_path),
    decomposition_packet_id: trim(packet.decomposition_packet_id),
    decomposition_packet_path: trim(packet.decomposition_packet_path),
    materialization_state: trim(packet.materialization_state) || "completed",
    already_completed: "true",
    issue_urls: issueUrls,
    created_issue_numbers: createdIssueNumbers,
    feature_issue_map: featureIssueMap,
    blocked_by_edges: Array.isArray(packet.blocked_by_edges) ? packet.blocked_by_edges : [],
    goal_blocked_by_edges: Array.isArray(packet.goal_blocked_by_edges) ? packet.goal_blocked_by_edges : [],
    goal_issue_map: goalIssueMap,
    issue_set_map: issueSetMap,
    prerequisite_goal_issue_numbers: prerequisiteGoalIssueNumbers,
    final_instantiation_goal_issue_number: finalInstantiationGoalIssueNumber,
    goal_feature_issue_map: goalFeatureIssueMap,
    feature_materialization_markers: featureMaterializationMarkers,
    factory_request_prerequisite_materialization: factoryRequestPrerequisiteMaterialization,
    traceability_chain: {
      goal_issue_number: goalIssueNumber,
      plan_packet_id: trim(packet.plan_packet_id),
      decomposition_packet_id: trim(packet.decomposition_packet_id),
      issue_numbers: createdIssueNumbers,
    },
    reused_packet_id: trim(packet.packet_id),
    reused_packet_path: trim(existing?.packet_path),
    ...holdCleanup,
  };
}

function ensureHardGoalApprovedState({
  repoRoot = ".",
  goalIssueNumber = "",
  factoryId = "mothership",
} = {}) {
  const current = readGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber,
    factoryId,
  });

  const currentPlanningState = trim(current?.planning_state).toLowerCase();
  if (currentPlanningState !== "approved") {
    throw new Error(`invalid_planning_state_for_materialization:${currentPlanningState || "(empty)"}`);
  }

  return {
    planning_state: "approved",
    goal_execution_path_packet_id: trim(current?.goal_execution_path_packet_id),
    goal_execution_path_packet_path: trim(current?.goal_execution_path_packet_path),
  };
}

function clearAwaitingHumanHold({
  repo = "",
  goalIssueNumber = "",
  factoryId = "mothership",
  ghExec = gh,
  raiseOnFailure = true,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedGoalIssueNumber = normalizeGoalIssueNumber(goalIssueNumber);
  if (!normalizedRepo) throw new Error("missing_repo");

  let labelEdit;
  try {
    labelEdit = ghExec(buildIssueLabelEditArgs({
      repo: normalizedRepo,
      issueNumber: normalizedGoalIssueNumber,
      factoryId,
      removeKeys: [FACTORY_LABEL_KEYS.AWAITING_HUMAN],
    }));
  } catch (error) {
    const reason = trim(error?.message || error || "unknown");
    if (raiseOnFailure) {
      throw new Error(`clear_awaiting_human_failed:${reason}`);
    }
    return {
      awaiting_human_label_removed: "false",
      awaiting_human_label_remove_error: reason || "unknown",
    };
  }

  if (!labelEdit?.ok) {
    const reason = trim(labelEdit?.stderr || labelEdit?.error || labelEdit?.stdout || "unknown");
    if (raiseOnFailure) {
      throw new Error(`clear_awaiting_human_failed:${reason}`);
    }
    return {
      awaiting_human_label_removed: "false",
      awaiting_human_label_remove_error: reason || "unknown",
    };
  }

  return {
    awaiting_human_label_removed: "true",
  };
}

export function materializeApprovedHardPlan({
  repoRoot = ".",
  repo = "",
  goalNumber = "",
  planPacketId = "",
  planningArtifactPath = "",
  factoryId = "mothership",
  runId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  createIssueFn = createGitHubIssueFromSpec,
  addSubIssueFn = addSubIssue,
  syncBlockedByFn = syncBlockedBy,
  resolveFeatureDependenciesFn = resolveFeatureDependencies,
  ghExecFn = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedGoalIssueNumber = normalizeGoalIssueNumber(goalNumber);
  if (!normalizedRepo) throw new Error("missing_repo");

  const parsed = parsePlanningArtifact({
    planningArtifactPath,
    planPacketId,
    goalNumber: normalizedGoalIssueNumber,
  });

  const normalizedPlanPacketId = trim(parsed.plan_packet_id);
  if (!normalizedPlanPacketId) throw new Error("missing_plan_packet_id");

  const existing = getLatestGoalHardPlanMaterializationPacket({
    repo: repoRoot,
    factoryId,
    goalIssueNumber: normalizedGoalIssueNumber,
    planPacketId: normalizedPlanPacketId,
  });

  if (existing?.packet) {
    const holdCleanup = clearAwaitingHumanHold({
      repo: normalizedRepo,
      goalIssueNumber: normalizedGoalIssueNumber,
      factoryId,
      ghExec: ghExecFn,
      raiseOnFailure: false,
    });
    return buildReplayOutput({ existing, holdCleanup });
  }

  const created = [];
  const rationaleFeatures = parsed.approved_features.filter((entry) => isRationaleFeature(entry));
  const executionFeatures = parsed.approved_features.filter((entry) => !isRationaleFeature(entry));
  const factoryRequestPrerequisiteMaterialization = [];
  const goalIssueMap = buildFactoryRequestGoalIssueMap({
    packet: parsed.packet,
    factoryRequestGoalGraph: parsed.factory_request_goal_graph,
    currentGoalIssueNumber: normalizedGoalIssueNumber,
  });

  const prerequisiteTargets = resolveFactoryRequestPrerequisiteTargets({
    packet: parsed.packet,
    approvedFeatures: executionFeatures,
    factoryRequestGoalGraph: parsed.factory_request_goal_graph,
    goalIssueMap,
    currentGoalIssueNumber: normalizedGoalIssueNumber,
  });

  const finalInstantiationTargets = resolveFactoryRequestFinalInstantiationTargets({
    approvedFeatures: executionFeatures,
    factoryRequestGoalGraph: parsed.factory_request_goal_graph,
    goalIssueMap,
    currentGoalIssueNumber: normalizedGoalIssueNumber,
  });

  if (prerequisiteTargets.length > 0) {
    for (const target of prerequisiteTargets) {
      const targetBatch = createIssuesFromFeatures({
        repo: normalizedRepo,
        features: target.features,
        goalIssueNumber: target.goal_issue_number,
        goalId: target.goal_id,
        issueSetId: target.issue_set_id,
        planPacketId: normalizedPlanPacketId,
        planningArtifactPath: trim(planningArtifactPath),
        factoryId,
        createIssueFn,
      });

      linkSubIssues({
        repo: normalizedRepo,
        goalIssueNumber: target.goal_issue_number,
        created: targetBatch.created,
        addSubIssueFn,
      });

      created.push(...targetBatch.created);
      factoryRequestPrerequisiteMaterialization.push({
        goal_id: target.goal_id,
        goal_issue_number: target.goal_issue_number,
        issue_set_id: target.issue_set_id,
        feature_ids: target.features.map((entry) => entry.feature_id),
        created_issue_numbers: targetBatch.created.map((entry) => entry.issue_number),
      });
    }

    for (const target of finalInstantiationTargets) {
      const targetBatch = createIssuesFromFeatures({
        repo: normalizedRepo,
        features: target.features,
        goalIssueNumber: target.goal_issue_number,
        goalId: target.goal_id,
        issueSetId: target.issue_set_id,
        planPacketId: normalizedPlanPacketId,
        planningArtifactPath: trim(planningArtifactPath),
        factoryId,
        createIssueFn,
      });

      linkSubIssues({
        repo: normalizedRepo,
        goalIssueNumber: target.goal_issue_number,
        created: targetBatch.created,
        addSubIssueFn,
      });

      created.push(...targetBatch.created);
    }

    if (rationaleFeatures.length > 0) {
      const rationaleBatch = createIssuesFromFeatures({
        repo: normalizedRepo,
        features: rationaleFeatures,
        goalIssueNumber: normalizedGoalIssueNumber,
        planPacketId: normalizedPlanPacketId,
        planningArtifactPath: trim(planningArtifactPath),
        factoryId,
        createIssueFn,
      });

      linkSubIssues({
        repo: normalizedRepo,
        goalIssueNumber: normalizedGoalIssueNumber,
        created: rationaleBatch.created,
        addSubIssueFn,
      });

      created.push(...rationaleBatch.created);
    }
  } else {
    const defaultBatch = createIssuesFromFeatures({
      repo: normalizedRepo,
      features: executionFeatures,
      goalIssueNumber: normalizedGoalIssueNumber,
      planPacketId: normalizedPlanPacketId,
      planningArtifactPath: trim(planningArtifactPath),
      factoryId,
      createIssueFn,
    });

    linkSubIssues({
      repo: normalizedRepo,
      goalIssueNumber: normalizedGoalIssueNumber,
      created: defaultBatch.created,
      addSubIssueFn,
    });

    created.push(...defaultBatch.created);

    if (rationaleFeatures.length > 0) {
      const rationaleBatch = createIssuesFromFeatures({
        repo: normalizedRepo,
        features: rationaleFeatures,
        goalIssueNumber: normalizedGoalIssueNumber,
        planPacketId: normalizedPlanPacketId,
        planningArtifactPath: trim(planningArtifactPath),
        factoryId,
        createIssueFn,
      });

      linkSubIssues({
        repo: normalizedRepo,
        goalIssueNumber: normalizedGoalIssueNumber,
        created: rationaleBatch.created,
        addSubIssueFn,
      });

      created.push(...rationaleBatch.created);
    }
  }

  const appliedBlockedByEdges = resolveAndSyncBlockedByEdges({
    repo: normalizedRepo,
    created,
    syncBlockedByFn,
    resolveFeatureDependenciesFn,
  });

  const appliedGoalBlockedByEdges = resolveAndSyncGoalBlockedByEdges({
    repo: normalizedRepo,
    factoryRequestGoalGraph: parsed.factory_request_goal_graph,
    goalIssueMap,
    syncBlockedByFn,
  });

  const factoryRequestLedger = buildFactoryRequestMaterializationLedger({
    factoryRequestGoalGraph: parsed.factory_request_goal_graph,
    goalIssueMap,
    created,
    planPacketId: normalizedPlanPacketId,
  });

  const persisted = persistMaterializationLedger({
    repoRoot,
    factoryId,
    runId,
    goalIssueNumber: normalizedGoalIssueNumber,
    goalIssue: parsed.goal_issue,
    goalContext: parsed.goal_context,
    planPacketId: normalizedPlanPacketId,
    planningArtifactPath: trim(planningArtifactPath),
    approvedFeatures: parsed.approved_features,
    created,
    blockedByEdges: appliedBlockedByEdges,
    goalBlockedByEdges: appliedGoalBlockedByEdges,
    goalIssueMap,
    issueSetMap: factoryRequestLedger.issue_set_map,
    prerequisiteGoalIssueNumbers: factoryRequestLedger.prerequisite_goal_issue_numbers,
    finalInstantiationGoalIssueNumber: factoryRequestLedger.final_instantiation_goal_issue_number,
    goalFeatureIssueMap: factoryRequestLedger.goal_feature_issue_map,
    featureMaterializationMarkers: factoryRequestLedger.feature_materialization_markers,
    factoryRequestPrerequisiteMaterialization,
    targetRepo,
    controlPlaneRepo,
  });

  const planningState = ensureHardGoalApprovedState({
    repoRoot,
    goalIssueNumber: normalizedGoalIssueNumber,
    factoryId,
  });

  const holdCleanup = clearAwaitingHumanHold({
    repo: normalizedRepo,
    goalIssueNumber: normalizedGoalIssueNumber,
    factoryId,
    ghExec: ghExecFn,
  });

  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_issue: {
      number: Number.parseInt(normalizedGoalIssueNumber, 10),
      title: `Goal ${normalizedGoalIssueNumber}`,
    },
    goal_context: parsed.goal_context,
    approved_features: parsed.approved_features.map((entry) => entry.source_feature),
    plan_packet_id: normalizedPlanPacketId,
    planning_artifact_path: trim(planningArtifactPath),
    decomposition_packet_id: persisted.decomposition_packet_id,
    decomposition_packet_path: persisted.decomposition_packet_path,
    materialization_state: "completed",
    already_completed: "false",
    issue_urls: created.map((entry) => entry.issue_url),
    created_issue_numbers: created.map((entry) => entry.issue_number),
    feature_issue_map: created.map((entry) => ({
      feature_id: entry.feature_id,
      issue_number: entry.issue_number,
      issue_url: entry.issue_url,
      blocked_by_feature_ids: entry.blocked_by_feature_ids,
      source_goal_id: entry.source_goal_id,
      source_issue_set_id: entry.source_issue_set_id,
      parent_goal_issue_number: entry.parent_goal_issue_number,
    })),
    blocked_by_edges: appliedBlockedByEdges,
    goal_blocked_by_edges: appliedGoalBlockedByEdges,
    goal_issue_map: factoryRequestLedger.goal_issue_map,
    issue_set_map: factoryRequestLedger.issue_set_map,
    prerequisite_goal_issue_numbers: factoryRequestLedger.prerequisite_goal_issue_numbers,
    final_instantiation_goal_issue_number: factoryRequestLedger.final_instantiation_goal_issue_number,
    goal_feature_issue_map: factoryRequestLedger.goal_feature_issue_map,
    feature_materialization_markers: factoryRequestLedger.feature_materialization_markers,
    factory_request_prerequisite_materialization: normalizeFactoryRequestPrerequisiteMaterialization(
      factoryRequestPrerequisiteMaterialization,
    ),
    traceability_chain: {
      goal_issue_number: normalizedGoalIssueNumber,
      plan_packet_id: normalizedPlanPacketId,
      decomposition_packet_id: persisted.decomposition_packet_id,
      issue_numbers: created.map((entry) => entry.issue_number),
    },
    ...persisted,
    ...planningState,
    ...holdCleanup,
  };
}

function parseArgv(argv = []) {
  const parsed = {
    repoRoot: ".",
    repo: "",
    goalNumber: "",
    planPacket: "",
    planningArtifactPath: "",
    factoryId: "mothership",
    runId: "",
    targetRepo: "",
    controlPlaneRepo: "",
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = trim(args[index]);
    if (!entry.startsWith("--")) continue;

    const key = entry.replace(/^--/, "");
    const value = trim(args[index + 1]);
    if (value && !value.startsWith("--")) index += 1;

    if (key === "repo-root") parsed.repoRoot = value || ".";
    else if (key === "repo") parsed.repo = value;
    else if (key === "goal-number") parsed.goalNumber = value;
    else if (key === "plan-packet") parsed.planPacket = value;
    else if (key === "planning-artifact-path") parsed.planningArtifactPath = value;
    else if (key === "factory-id") parsed.factoryId = value || "mothership";
    else if (key === "run-id") parsed.runId = value;
    else if (key === "target-repo") parsed.targetRepo = value;
    else if (key === "control-plane-repo") parsed.controlPlaneRepo = value;
  }

  return parsed;
}

function isDirectRun() {
  const invoked = process.argv[1] || "";
  return invoked.endsWith("goal-hard-plan-materialize.mjs");
}

function findLatestMaterializationByGoal({ repo = "", factoryId = "", goalIssueNumber = "" } = {}) {
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId,
    packetTypes: ["goal_hard_plan_materialization_packet"],
    durableOnly: true,
  });
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  return packets.find((entry) => trim(entry?.packet?.goal_issue_number) === normalizedGoalIssueNumber) || null;
}

if (isDirectRun()) {
  const flags = parseArgv(process.argv.slice(2));
  const repoRoot = flags.repoRoot || ".";
  const goalNumber = trim(flags.goalNumber);
  const factoryId = trim(flags.factoryId) || "mothership";

  let planningArtifactPath = trim(flags.planningArtifactPath);
  let planPacket = trim(flags.planPacket);

  if ((!planningArtifactPath || !planPacket) && goalNumber) {
    const existing = findLatestMaterializationByGoal({
      repo: repoRoot,
      factoryId,
      goalIssueNumber: goalNumber,
    });
    if (existing?.packet) {
      planningArtifactPath = planningArtifactPath || trim(existing.packet.planning_artifact_path);
      planPacket = planPacket || trim(existing.packet.plan_packet_id);
    }
  }

  try {
    const out = materializeApprovedHardPlan({
      repoRoot,
      repo: resolveGhRepo(flags.repo),
      goalNumber,
      planPacketId: planPacket,
      planningArtifactPath,
      factoryId,
      runId: flags.runId,
      targetRepo: flags.targetRepo,
      controlPlaneRepo: flags.controlPlaneRepo,
      createIssueFn: createGitHubIssueFromSpec,
      addSubIssueFn: addSubIssue,
      syncBlockedByFn: syncBlockedBy,
    });
    process.stdout.write(JSON.stringify(out));
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
