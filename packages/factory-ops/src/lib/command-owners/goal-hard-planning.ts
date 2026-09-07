import { existsSync, readFileSync } from "node:fs";

import { runGhCli } from "@hatch/github-adapter";

import {
  GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
  classifyGoalExecutionPath,
  transitionGoalExecutionPathPlanningState,
} from "./goal-execution-path.ts";
import {
  FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION,
  buildFactoryRequestGoalGraph,
  normalizeFactoryRequestGoalGraph,
  parseOptionalObject,
} from "../../commands/goal-hard-planning-factory-request-goal-graph.ts";
import { parseJson, trim } from "../cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  ensureFactoryLabels,
  getFactoryLabelName,
} from "../factory-label-contract.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  makePacketId,
  persistNamedPacket,
} from "../packet-core.ts";

export const HARD_PLAN_PACKET_SCHEMA_VERSION = "hard_plan_packet/v1";
export const HARD_PLAN_PACKET_TYPE = "hard_plan_packet";

const HARD_PLAN_ARTIFACT_MARKER = "<!-- goal-run:hard-plan-artifact -->";
const HARD_PLAN_READY_REMOVED_MARKER = "<!-- goal-run:hard-plan-ready-removed -->";

function parseJsonObject(raw = "") {
  const parsed = parseJson(String(raw || ""), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseJsonArray(raw = "") {
  const parsed = parseJson(String(raw || ""), []);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeIssueNumber(goalIssueNumber = "") {
  const value = trim(goalIssueNumber);
  if (!value) throw new Error("missing_goal_issue_number");
  return value;
}

const GOAL_REQUEST_TYPE_STANDARD = "standard";
const GOAL_REQUEST_TYPE_FACTORY_REQUEST = "factory_request";

const EXPLICIT_GOAL_REQUEST_TYPE_KEYS = ["goal_request_type", "request_type"];

const FACTORY_REQUEST_PLAN_BUCKET_KEYS = [
  "reusable_capability_gaps",
  "reusable_policy_profile_gaps",
  "factory_instance_wiring",
  "domain_specific_residues",
];

const FACTORY_REQUEST_PLAN_BUCKET_ALIASES = new Map([
  ["reusable_capability_gaps", "reusable_capability_gaps"],
  ["reusable_capability_gap", "reusable_capability_gaps"],
  ["reusable_capabilities", "reusable_capability_gaps"],
  ["reusable_policy_profile_gaps", "reusable_policy_profile_gaps"],
  ["reusable_policy_profile_gap", "reusable_policy_profile_gaps"],
  ["reusable_policy_gaps", "reusable_policy_profile_gaps"],
  ["factory_instance_wiring", "factory_instance_wiring"],
  ["instance_wiring", "factory_instance_wiring"],
  ["factory_wiring", "factory_instance_wiring"],
  ["domain_specific_residues", "domain_specific_residues"],
  ["domain_specific_residue", "domain_specific_residues"],
  ["domain_residues", "domain_specific_residues"],
]);

const FACTORY_REQUEST_BUCKET_TEXT_KEYS = [
  "factory_request_bucket_text",
  "factoryRequestBucketText",
  "bucket_text",
  "bucketText",
  "bucket_notes",
  "bucketNotes",
];

const UI_REFINEMENT_REQUIRED_METADATA_KEYS = [
  "visual_risk_class",
  "hotspot_files",
  "scope_limit_minutes",
  "refinement_strategy",
  "scenario_sources",
];

// Keep these phrases centralized so downstream validators and docs reuse the same deterministic contract.
const FACTORY_REQUEST_HEURISTIC_PATTERNS = [
  /new managed factory/i,
  /stand up (?:a |an )?(?:new )?(?:managed )?factory/i,
  /managed factory client/i,
  /\bfactory client\b/i,
  /\bmanaged[- ]client shape\b/i,
];

function normalizeGoalRequestType(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === GOAL_REQUEST_TYPE_FACTORY_REQUEST) return GOAL_REQUEST_TYPE_FACTORY_REQUEST;
  if (normalized === GOAL_REQUEST_TYPE_STANDARD) return GOAL_REQUEST_TYPE_STANDARD;
  return "";
}

function stripBulletPrefix(value = "") {
  return trim(String(value || "").replace(/^[-*•]\s+/, ""));
}

function normalizeTextList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const out = [];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.unshift(...entry);
      continue;
    }

    if (entry && typeof entry === "object") {
      const objectEntry = entry;
      if (Array.isArray(objectEntry.items)) {
        queue.unshift(...objectEntry.items);
        continue;
      }
      if (Array.isArray(objectEntry.bullets)) {
        queue.unshift(...objectEntry.bullets);
        continue;
      }
      const serialized = trim(JSON.stringify(objectEntry));
      if (serialized) out.push(serialized);
      continue;
    }

    const normalized = trim(entry);
    if (!normalized) continue;
    for (const rawLine of normalized.split(/\r?\n/g)) {
      const line = stripBulletPrefix(rawLine);
      if (line) out.push(line);
    }
  }

  return [...new Set(out)];
}

function normalizeFactoryRequestBucket(value = "") {
  const normalized = trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return FACTORY_REQUEST_PLAN_BUCKET_ALIASES.get(normalized) || "";
}

function extractFactoryRequestBucket(feature = {}) {
  const candidates = [
    feature?.factory_request_bucket,
    feature?.factoryRequestBucket,
    feature?.bucket,
    feature?.bucket_name,
    feature?.bucketName,
    feature?.metadata?.factory_request_bucket,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeFactoryRequestBucket(candidate);
    if (normalized) return normalized;
  }

  return "";
}

function buildFactoryRequestFeatureRecord(feature = {}, bucket = "", index = 0) {
  const fallbackIndex = index + 1;
  const featureId = trim(feature?.feature_id || feature?.id || feature?.slug) || `feature-${fallbackIndex}`;
  const featureName = trim(feature?.name || feature?.title || feature?.summary) || `Feature ${fallbackIndex}`;
  const summary = trim(feature?.summary || feature?.scope || feature?.description);

  const bucketTextCandidates = [];
  for (const key of FACTORY_REQUEST_BUCKET_TEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(feature, key)) {
      bucketTextCandidates.push(feature[key]);
    }
  }
  bucketTextCandidates.push(feature?.summary, feature?.scope);

  const hasUiRefinementSignal = featureHasUiRefinementSignal(feature);
  const missingUiRefinementMetadata = collectUiRefinementMissingMetadata(feature);
  if (hasUiRefinementSignal) {
    bucketTextCandidates.push("UI refinement metadata required: visual_risk_class, hotspot_files, scope_limit_minutes, refinement_strategy, scenario_sources");
    if (missingUiRefinementMetadata.length > 0) {
      bucketTextCandidates.push(`UI refinement metadata missing: ${missingUiRefinementMetadata.join(", ")}`);
    }
  }

  const bucketText = normalizeTextList(bucketTextCandidates);

  return {
    feature_id: featureId,
    name: featureName,
    summary,
    factory_request_bucket: bucket,
    factory_request_bucket_text: bucketText,
    source_feature: feature,
  };
}

function buildEmptyFactoryRequestPlan() {
  return {
    reusable_capability_gaps: [],
    reusable_policy_profile_gaps: [],
    factory_instance_wiring: [],
    domain_specific_residues: [],
  };
}

function buildFactoryRequestPlan(approvedFeatures = []) {
  const plan = buildEmptyFactoryRequestPlan();
  const normalizationWarnings = [];

  const features = Array.isArray(approvedFeatures) ? approvedFeatures : [];
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) continue;

    const bucket = extractFactoryRequestBucket(feature);
    if (!bucket) {
      normalizationWarnings.push(`missing_factory_request_bucket:index=${index}`);
      continue;
    }

    plan[bucket].push(buildFactoryRequestFeatureRecord(feature, bucket, index));
  }

  normalizationWarnings.push(...collectUiRefinementNormalizationWarnings(features));

  const rawBucketText = {};
  for (const key of FACTORY_REQUEST_PLAN_BUCKET_KEYS) {
    rawBucketText[key] = plan[key]
      .flatMap((entry) => normalizeTextList(entry?.factory_request_bucket_text || []));
  }

  return {
    ...plan,
    raw_bucket_text: rawBucketText,
    normalization_warnings: normalizationWarnings,
  };
}

function hasFactoryRequestReusableGapCoverage(plan = {}) {
  return Array.isArray(plan?.reusable_capability_gaps)
    && plan.reusable_capability_gaps.length > 0
    && Array.isArray(plan?.reusable_policy_profile_gaps)
    && plan.reusable_policy_profile_gaps.length > 0;
}

function hasFactoryRequestPlanBuckets(plan = {}) {
  return FACTORY_REQUEST_PLAN_BUCKET_KEYS.every((key) => Array.isArray(plan?.[key]));
}

function hasFactoryRequestBespokeWork(plan = {}) {
  return (Array.isArray(plan?.factory_instance_wiring) && plan.factory_instance_wiring.length > 0)
    || (Array.isArray(plan?.domain_specific_residues) && plan.domain_specific_residues.length > 0);
}

function normalizeFactoryRequestPlanShape(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  const normalized = buildEmptyFactoryRequestPlan();
  for (const key of FACTORY_REQUEST_PLAN_BUCKET_KEYS) {
    normalized[key] = Array.isArray(source[key])
      ? source[key].filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      : [];
  }

  const rawBucketTextSource = source?.raw_bucket_text && typeof source.raw_bucket_text === "object" && !Array.isArray(source.raw_bucket_text)
    ? source.raw_bucket_text
    : {};

  const rawBucketText = {};
  for (const key of FACTORY_REQUEST_PLAN_BUCKET_KEYS) {
    rawBucketText[key] = normalizeTextList(rawBucketTextSource[key]);
  }

  return {
    ...normalized,
    raw_bucket_text: rawBucketText,
    normalization_warnings: Array.isArray(source?.normalization_warnings)
      ? source.normalization_warnings.map((entry) => trim(entry)).filter(Boolean)
      : [],
  };
}

function hasExplicitFactoryRequestBucketMetadata(feature = {}) {
  return Boolean(extractFactoryRequestBucket(feature));
}

function featureHasUiRefinementSignal(feature = {}) {
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) return false;

  const domain = trim(feature?.domain).toLowerCase();
  if (domain === "ui-refinement") return true;

  const visualRisk = trim(feature?.visual_risk_class || feature?.visualRiskClass);
  if (visualRisk) return true;

  const hotspots = normalizeTextList(feature?.hotspot_files ?? feature?.hotspotFiles);
  if (hotspots.length > 0) return true;

  const sources = normalizeTextList(feature?.scenario_sources ?? feature?.scenarioSources);
  if (sources.length > 0) return true;

  return false;
}

function getFeatureMetadataValue(feature = {}, key = "") {
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) return undefined;

  const aliases = {
    visual_risk_class: ["visual_risk_class", "visualRiskClass"],
    hotspot_files: ["hotspot_files", "hotspotFiles"],
    scope_limit_minutes: ["scope_limit_minutes", "scopeLimitMinutes"],
    refinement_strategy: ["refinement_strategy", "refinementStrategy"],
    scenario_sources: ["scenario_sources", "scenarioSources"],
  };

  const candidates = aliases[key] || [key];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(feature, candidate)) {
      return feature[candidate];
    }
  }

  return undefined;
}

function collectUiRefinementMissingMetadata(feature = {}) {
  const missing = [];
  for (const key of UI_REFINEMENT_REQUIRED_METADATA_KEYS) {
    const value = getFeatureMetadataValue(feature, key);
    if (key === "hotspot_files" || key === "scenario_sources") {
      if (normalizeTextList(value).length === 0) missing.push(key);
      continue;
    }
    if (key === "scope_limit_minutes") {
      const parsed = Number(trim(value));
      if (!Number.isFinite(parsed) || parsed <= 0) missing.push(key);
      continue;
    }
    if (!trim(value)) missing.push(key);
  }

  return missing;
}

function collectUiRefinementNormalizationWarnings(approvedFeatures = []) {
  const warnings = [];
  const features = Array.isArray(approvedFeatures) ? approvedFeatures : [];

  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    if (!featureHasUiRefinementSignal(feature)) continue;

    const featureId = trim(feature?.id || feature?.feature_id || feature?.slug) || `index_${index}`;
    const missing = collectUiRefinementMissingMetadata(feature);
    if (missing.length === 0) continue;

    warnings.push(`ui_refinement_missing_metadata:feature=${featureId}:missing=${missing.join("|")}`);
  }

  return warnings;
}

function hasUiRefinementMetadataWarning(warnings = []) {
  const entries = Array.isArray(warnings) ? warnings : [];
  return entries.some((entry) => trim(entry).startsWith("ui_refinement_missing_metadata:"));
}

export function determineGoalRequestType(goalIssue = {}, goalContext = {}) {
  const normalizedGoalContext = goalContext && typeof goalContext === "object" && !Array.isArray(goalContext)
    ? goalContext
    : {};

  for (const key of EXPLICIT_GOAL_REQUEST_TYPE_KEYS) {
    const explicitType = normalizeGoalRequestType(normalizedGoalContext?.[key]);
    if (explicitType) return explicitType;
  }

  const normalizedGoalIssue = goalIssue && typeof goalIssue === "object" && !Array.isArray(goalIssue)
    ? goalIssue
    : {};
  const goalText = [
    trim(normalizedGoalIssue?.title),
    trim(normalizedGoalIssue?.body),
  ].filter(Boolean).join("\n");

  if (FACTORY_REQUEST_HEURISTIC_PATTERNS.some((pattern) => pattern.test(goalText))) {
    return GOAL_REQUEST_TYPE_FACTORY_REQUEST;
  }

  return GOAL_REQUEST_TYPE_STANDARD;
}

function buildHardPlanPacket({
  goalIssueNumber = "",
  goalIssueRaw = "",
  goalContextRaw = "",
  approvedFeaturesRaw = "",
  factoryRequestGoalGraphRaw = "",
  reviewNotes = "",
  factoryId = "mothership",
  runId = "",
  pipeline = "goal_hard_plan",
  nodeId = "persist_hard_plan_packet",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const approvedFeatures = parseJsonArray(approvedFeaturesRaw)
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));

  const parsedGoalIssue = parseJsonObject(goalIssueRaw);
  const parsedGoalContext = parseJsonObject(goalContextRaw);
  const parsedFactoryRequestGoalGraph = parseOptionalObject(factoryRequestGoalGraphRaw);
  const goalRequestType = determineGoalRequestType(parsedGoalIssue, parsedGoalContext);
  const factoryRequestPlan = goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
    ? buildFactoryRequestPlan(approvedFeatures)
    : null;
  const factoryRequestGoalGraph = goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
    ? buildFactoryRequestGoalGraph({
        goalContext: {
          ...parsedGoalContext,
          ...(Object.keys(parsedFactoryRequestGoalGraph).length > 0
            ? { factory_request_goal_graph: parsedFactoryRequestGoalGraph }
            : {}),
        },
        approvedFeatures,
        factoryRequestPlan: factoryRequestPlan || buildEmptyFactoryRequestPlan(),
        normalizeFactoryRequestPlanShape,
        normalizeTextList,
      })
    : null;

  const normalizedGoalIssueNumber = normalizeIssueNumber(goalIssueNumber);
  const normalizedFactoryId = trim(factoryId) || "mothership";
  const normalizedRunId = trim(runId);
  const normalizedPipeline = trim(pipeline);
  const normalizedNodeId = trim(nodeId);
  const normalizedTargetRepo = trim(targetRepo);
  const normalizedControlPlaneRepo = trim(controlPlaneRepo);

  const packetId = makePacketId({
    packetType: HARD_PLAN_PACKET_TYPE,
    identity: {
      goal_issue_number: normalizedGoalIssueNumber,
      factory_id: normalizedFactoryId,
      run_id: normalizedRunId,
      pipeline: normalizedPipeline,
      node_id: normalizedNodeId,
      approved_feature_count: approvedFeatures.length,
      review_notes: trim(reviewNotes),
      goal_request_type: goalRequestType,
    },
  });

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: HARD_PLAN_PACKET_SCHEMA_VERSION,
      packetType: HARD_PLAN_PACKET_TYPE,
      packetId,
      factoryId: normalizedFactoryId,
      runId: normalizedRunId,
      pipeline: normalizedPipeline,
      nodeId: normalizedNodeId,
      targetRepo: normalizedTargetRepo,
      controlPlaneRepo: normalizedControlPlaneRepo,
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "goal.hard_plan_review",
      handoffKind: "goal_hard_plan_review",
      resourceRefs: {
        goal_issue_number: normalizedGoalIssueNumber,
        target_repo: normalizedTargetRepo,
      },
      inspectionCommands: [
        "Review the hard planning artifact linked on the goal issue before re-adding ready.",
      ],
      executionCommands: [
        "When ready is re-applied, transition planning_state to approved and resume goal_run.",
      ],
      verifyCommands: [
        "Confirm planning artifact remains linked and ready was intentionally re-applied by a reviewer.",
      ],
      expectedOutcomes: [
        "Hard-path planning is review-gated and resumable without re-planning.",
      ],
      preserveWork: {
        preserve_work_required: true,
        goal_issue_number: normalizedGoalIssueNumber,
      },
      operatorPrompt: "Use this packet as the canonical hard-plan artifact for review and resume decisions.",
    }),
    goal_issue_number: normalizedGoalIssueNumber,
    goal_request_type: goalRequestType,
    goal_issue: parsedGoalIssue,
    goal_context: parsedGoalContext,
    approved_features: approvedFeatures,
    ...(factoryRequestPlan
      ? {
          factory_request_plan: {
            reusable_capability_gaps: factoryRequestPlan.reusable_capability_gaps,
            reusable_policy_profile_gaps: factoryRequestPlan.reusable_policy_profile_gaps,
            factory_instance_wiring: factoryRequestPlan.factory_instance_wiring,
            domain_specific_residues: factoryRequestPlan.domain_specific_residues,
            raw_bucket_text: factoryRequestPlan.raw_bucket_text,
            normalization_warnings: factoryRequestPlan.normalization_warnings,
          },
        }
      : {}),
    ...(factoryRequestGoalGraph
      ? {
          factory_request_goal_graph: factoryRequestGoalGraph,
        }
      : {}),
    review_notes: trim(reviewNotes),
  };
}

export function persistHardPlanningArtifact({
  repoRoot = ".",
  goalIssueNumber = "",
  goalIssueRaw = "",
  goalContextRaw = "",
  approvedFeaturesRaw = "[]",
  factoryRequestGoalGraphRaw = "",
  reviewNotes = "",
  factoryId = "mothership",
  runId = "",
  pipeline = "goal_hard_plan",
  nodeId = "persist_hard_plan_packet",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const packet = buildHardPlanPacket({
    goalIssueNumber,
    goalIssueRaw,
    goalContextRaw,
    approvedFeaturesRaw,
    factoryRequestGoalGraphRaw,
    reviewNotes,
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persisted = persistNamedPacket({
    repo: repoRoot,
    packet,
  });

  return {
    hard_plan_packet_path: persisted.packet_path,
    hard_plan_packet_id: packet.packet_id,
    hard_plan_packet_type: packet.packet_type,
    hard_plan_packet_schema_version: packet.schema_version,
    goal_request_type: trim(packet.goal_request_type),
  };
}

export function validatePlanningArtifact({ packetPath = "" } = {}) {
  const normalizedPacketPath = trim(packetPath);
  if (!normalizedPacketPath) throw new Error("missing_packet_path");
  if (!existsSync(normalizedPacketPath)) throw new Error(`planning_artifact_missing:${normalizedPacketPath}`);

  let packet;
  try {
    packet = JSON.parse(readFileSync(normalizedPacketPath, "utf8"));
  } catch (error) {
    throw new Error(`planning_artifact_unreadable:${String(error?.message || error)}`);
  }

  const errors = [];
  if (trim(packet?.schema_version) !== HARD_PLAN_PACKET_SCHEMA_VERSION) {
    errors.push(`invalid_schema_version:${trim(packet?.schema_version) || "(empty)"}`);
  }
  if (trim(packet?.packet_type) !== HARD_PLAN_PACKET_TYPE) {
    errors.push(`invalid_packet_type:${trim(packet?.packet_type) || "(empty)"}`);
  }
  if (!trim(packet?.packet_id)) errors.push("missing_required_field:packet_id");
  if (!trim(packet?.goal_issue_number)) errors.push("missing_required_field:goal_issue_number");
  if (!trim(packet?.handoff_owner)) errors.push("missing_required_field:handoff_owner");
  if (!trim(packet?.handoff_kind)) errors.push("missing_required_field:handoff_kind");
  if (!Array.isArray(packet?.inspection_commands)) errors.push("missing_required_field:inspection_commands");
  if (!Array.isArray(packet?.execution_commands)) errors.push("missing_required_field:execution_commands");
  if (!Array.isArray(packet?.verify_commands)) errors.push("missing_required_field:verify_commands");
  if (!Array.isArray(packet?.expected_outcomes) || packet.expected_outcomes.length === 0) {
    errors.push("missing_required_field:expected_outcomes");
  }
  if (!packet?.resource_refs || typeof packet.resource_refs !== "object" || Array.isArray(packet.resource_refs)) {
    errors.push("missing_required_field:resource_refs");
  }
  if (!packet?.preserve_work || typeof packet.preserve_work !== "object" || Array.isArray(packet.preserve_work)) {
    errors.push("missing_required_field:preserve_work");
  }
  if (!Array.isArray(packet?.approved_features)) {
    errors.push("missing_required_field:approved_features");
  } else if (packet.approved_features.length === 0) {
    errors.push("approved_features_empty");
  }

  const approvedFeatures = Array.isArray(packet?.approved_features) ? packet.approved_features : [];
  if (hasUiRefinementMetadataWarning(collectUiRefinementNormalizationWarnings(approvedFeatures))) {
    errors.push("ui_refinement_metadata_missing");
  }

  const rawGoalRequestType = trim(packet?.goal_request_type);
  const normalizedGoalRequestType = normalizeGoalRequestType(rawGoalRequestType);
  if (rawGoalRequestType && !normalizedGoalRequestType) {
    errors.push("invalid_goal_request_type");
  }
  const goalRequestType = normalizedGoalRequestType || GOAL_REQUEST_TYPE_STANDARD;

  if (goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST) {
    const hasPersistedFactoryRequestPlan = packet?.factory_request_plan
      && typeof packet.factory_request_plan === "object"
      && !Array.isArray(packet.factory_request_plan);

    // Factory-request hard plans must ship a deterministic novelty map contract.
    // We fail closed when reusable buckets are absent or empty so planners cannot
    // jump directly to bespoke factory wiring.
    if (!hasPersistedFactoryRequestPlan) {
      errors.push("missing_reuse_buckets");
    } else {
      const factoryRequestPlan = normalizeFactoryRequestPlanShape(packet.factory_request_plan);
      const hasAllBucketArrays = hasFactoryRequestPlanBuckets(factoryRequestPlan);
      if (!hasAllBucketArrays) {
        errors.push("missing_reuse_buckets");
      }

      const hasReusableCoverage = hasFactoryRequestReusableGapCoverage(factoryRequestPlan);
      if (!hasReusableCoverage) {
        errors.push(hasFactoryRequestBespokeWork(factoryRequestPlan)
          ? "bypassed_reuse_analysis"
          : "missing_reuse_buckets");
      }

    }

    if (approvedFeatures.length > 0 && approvedFeatures.some((feature) => !hasExplicitFactoryRequestBucketMetadata(feature))) {
      errors.push("factory_request_bucket_metadata_missing");
    }

    const goalGraphRaw = packet?.factory_request_goal_graph;
    if (!goalGraphRaw || typeof goalGraphRaw !== "object" || Array.isArray(goalGraphRaw)) {
      errors.push("missing_factory_request_goal_graph");
    } else {
      const { errors: goalGraphErrors } = normalizeFactoryRequestGoalGraph(goalGraphRaw, {
        approvedFeatures,
        normalizeTextList,
      });
      errors.push(...goalGraphErrors.map((entry) => `factory_request_goal_graph_${entry}`));
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid_planning_artifact:${errors.join(",")}`);
  }

  return {
    planning_artifact_valid: "true",
    planning_artifact_error: "",
    planning_artifact_path: normalizedPacketPath,
    planning_packet_id: trim(packet.packet_id),
    goal_issue_number: trim(packet.goal_issue_number),
    approved_feature_count: String(packet.approved_features.length),
  };
}

function hasPlanningArtifactComment({ comments = [], planningArtifactPath = "" } = {}) {
  const normalizedPath = trim(planningArtifactPath);
  if (!normalizedPath) return false;
  return (Array.isArray(comments) ? comments : []).some((entry) => {
    const body = String(entry?.body || "");
    return body.includes(HARD_PLAN_ARTIFACT_MARKER)
      && body.includes(`planning_artifact_path=${normalizedPath}`);
  });
}

function loadPlanningArtifactPacket(planningArtifactPath = "") {
  const normalizedPath = trim(planningArtifactPath);
  if (!normalizedPath || !existsSync(normalizedPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(normalizedPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatFactoryRequestPlanBucketItems(plan = {}, key = "") {
  const fromRawBucketText = normalizeTextList(plan?.raw_bucket_text?.[key]);
  if (fromRawBucketText.length > 0) return fromRawBucketText;

  const entries = Array.isArray(plan?.[key]) ? plan[key] : [];
  const fromEntries = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const title = trim(entry?.name || entry?.title || entry?.feature_id || entry?.id);
    const detail = trim(entry?.summary || entry?.scope || entry?.description);
    const combined = title && detail
      ? `${title}: ${detail}`
      : (title || detail);
    if (combined) fromEntries.push(combined);
  }

  return [...new Set(fromEntries)];
}

function buildFactoryRequestPlanCommentSections(plan = {}) {
  const reusableCapability = formatFactoryRequestPlanBucketItems(plan, "reusable_capability_gaps");
  const reusablePolicy = formatFactoryRequestPlanBucketItems(plan, "reusable_policy_profile_gaps");
  const instanceWiring = formatFactoryRequestPlanBucketItems(plan, "factory_instance_wiring");
  const domainResidues = formatFactoryRequestPlanBucketItems(plan, "domain_specific_residues");

  const formatBulletList = (items = []) => (
    items.length > 0
      ? items.map((entry) => `- ${entry}`)
      : ["- (none provided)"]
  );

  const uiRefinementWarnings = normalizeTextList(
    Array.isArray(plan?.normalization_warnings)
      ? plan.normalization_warnings.filter((entry) => trim(entry).startsWith("ui_refinement_missing_metadata:"))
      : [],
  );

  return [
    "",
    "### Reusable platform work",
    "Reusable prerequisites that must be delivered at shared capability/policy layers before instance wiring.",
    "",
    "**Reusable capability gaps**",
    ...formatBulletList(reusableCapability),
    "",
    "**Reusable policy/profile gaps**",
    ...formatBulletList(reusablePolicy),
    "",
    "### Target factory instantiation",
    "Factory-local instantiation work that should follow reusable prerequisite delivery.",
    "",
    "**Factory-instance wiring**",
    ...formatBulletList(instanceWiring),
    "",
    "**Domain-specific residues**",
    ...formatBulletList(domainResidues),
    ...(uiRefinementWarnings.length > 0
      ? [
          "",
          "### UI/refinement metadata findings",
          "Missing required visual-refinement metadata detected during plan normalization.",
          ...formatBulletList(uiRefinementWarnings),
        ]
      : []),
  ];
}

function buildFactoryRequestGoalTopologicalOrder(nodes = [], edges = []) {
  const nodeById = new Map(nodes.map((entry) => [entry.goal_id, entry]));
  const indegree = new Map(nodes.map((entry) => [entry.goal_id, 0]));
  const adjacency = new Map(nodes.map((entry) => [entry.goal_id, []]));

  for (const edge of edges) {
    const from = trim(edge?.from_goal_id);
    const to = trim(edge?.to_goal_id);
    if (!nodeById.has(from) || !nodeById.has(to)) continue;

    const neighbors = adjacency.get(from) || [];
    neighbors.push(to);
    adjacency.set(from, neighbors);

    indegree.set(to, (indegree.get(to) || 0) + 1);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([goalId]) => goalId)
    .sort((left, right) => left.localeCompare(right));

  const ordered = [];
  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const nextDegree = (indegree.get(neighbor) || 0) - 1;
      indegree.set(neighbor, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighbor);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== nodes.length) {
    return [...nodes]
      .sort((left, right) => left.goal_id.localeCompare(right.goal_id));
  }

  return ordered
    .map((goalId) => nodeById.get(goalId))
    .filter(Boolean);
}

function buildFactoryRequestGoalGraphCommentSections(goalGraph = {}) {
  const graph = goalGraph && typeof goalGraph === "object" && !Array.isArray(goalGraph)
    ? goalGraph
    : {};

  const { normalized, errors } = normalizeFactoryRequestGoalGraph(graph, {
    normalizeTextList,
  });

  const finalGoal = normalized?.final_instantiation_goal || {};
  const finalGoalId = trim(finalGoal.goal_id);

  const graphNodes = [
    ...(Array.isArray(normalized?.prerequisite_goals) ? normalized.prerequisite_goals : []),
    ...(finalGoalId ? [finalGoal] : []),
  ].filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && trim(entry.goal_id));

  const orderedGoals = buildFactoryRequestGoalTopologicalOrder(
    graphNodes,
    Array.isArray(normalized?.goal_edges) ? normalized.goal_edges : [],
  );

  const issueSetByGoalId = new Map();
  for (const issueSet of Array.isArray(normalized?.goal_issue_sets) ? normalized.goal_issue_sets : []) {
    for (const goalId of normalizeTextList(issueSet?.goal_ids)) {
      if (!issueSetByGoalId.has(goalId)) {
        issueSetByGoalId.set(goalId, trim(issueSet?.issue_set_id));
      }
    }
  }

  const bulletOrFallback = (items = [], fallback = "- (none provided)") => (
    items.length > 0 ? items.map((entry) => `- ${entry}`) : [fallback]
  );

  const orderedGoalLines = orderedGoals.map((goal) => {
    const goalId = trim(goal.goal_id);
    const goalTitle = trim(goal.title) || goalId;
    const issueSetId = trim(goal.issue_set_id) || issueSetByGoalId.get(goalId) || "";
    const issueSetSuffix = issueSetId ? ` (issue_set_id=${issueSetId})` : "";
    const finalSuffix = goalId === finalGoalId ? " [FINAL]" : "";
    const typeLabel = trim(goal.goal_kind) || "unknown";
    return `${goalId}${finalSuffix} — ${goalTitle}${issueSetSuffix} [type=${typeLabel}]`;
  });

  const edgeLines = (Array.isArray(normalized?.goal_edges) ? normalized.goal_edges : [])
    .map((edge) => {
      const fromGoalId = trim(edge?.from_goal_id);
      const toGoalId = trim(edge?.to_goal_id);
      if (!fromGoalId || !toGoalId) return "";
      return `${fromGoalId} → ${toGoalId}`;
    })
    .filter(Boolean);

  const issueSetLines = (Array.isArray(normalized?.goal_issue_sets) ? normalized.goal_issue_sets : [])
    .map((issueSet) => {
      const issueSetId = trim(issueSet?.issue_set_id);
      if (!issueSetId) return "";
      const title = trim(issueSet?.title) || issueSetId;
      const goals = normalizeTextList(issueSet?.goal_ids);
      const goalList = goals.length > 0 ? goals.join(",") : "none";
      return `${title} (issue_set_id=${issueSetId}, goals=${goalList})`;
    })
    .filter(Boolean);

  return [
    "",
    "### Prerequisite goal graph",
    `schema_version=${trim(normalized?.schema_version) || FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION}`,
    ...(errors.length > 0
      ? [
          `render_warning=goal_graph_normalization_errors:${errors.join(",")}`,
        ]
      : []),
    "",
    "**Goal order (topological)**",
    ...bulletOrFallback(orderedGoalLines),
    "",
    "**Final goal callout**",
    ...bulletOrFallback(
      finalGoalId
        ? [`${finalGoalId} (re-apply ready only after prerequisites are reviewed)`]
        : [],
    ),
    "",
    "**blockedBy edges (prerequisite → dependent)**",
    ...bulletOrFallback(edgeLines),
    "",
    "**Goal issue sets**",
    ...bulletOrFallback(issueSetLines),
  ];
}

export function attachPlanningArtifacts({
  repo = "",
  goalIssueNumber = "",
  planningArtifactPath = "",
  planningPacketId = "",
  runId = "",
  summary = "",
  ghExec = runGhCli,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedIssueNumber = normalizeIssueNumber(goalIssueNumber);
  const normalizedArtifactPath = trim(planningArtifactPath);
  if (!normalizedRepo) throw new Error("missing_repo");
  if (!normalizedArtifactPath) throw new Error("missing_planning_artifact_path");

  const planningArtifactPacket = loadPlanningArtifactPacket(normalizedArtifactPath);
  const goalRequestType = normalizeGoalRequestType(planningArtifactPacket?.goal_request_type)
    || GOAL_REQUEST_TYPE_STANDARD;
  const factoryRequestPlan = goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
    ? normalizeFactoryRequestPlanShape(planningArtifactPacket?.factory_request_plan)
    : null;
  const factoryRequestGoalGraph = goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
    ? parseOptionalObject(planningArtifactPacket?.factory_request_goal_graph)
    : null;

  const body = [
    HARD_PLAN_ARTIFACT_MARKER,
    "Hard-path planning completed. Human review is required before execution can resume.",
    `planning_artifact_path=${normalizedArtifactPath}`,
    `planning_packet_id=${trim(planningPacketId)}`,
    `run_id=${trim(runId)}`,
    trim(summary) ? `planning_summary=${trim(summary)}` : "",
    goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
      ? "Factory-request plan detected; review reusable platform prerequisites before target-factory instantiation."
      : "",
    ...(goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
      ? buildFactoryRequestPlanCommentSections(factoryRequestPlan || buildEmptyFactoryRequestPlan())
      : []),
    ...(goalRequestType === GOAL_REQUEST_TYPE_FACTORY_REQUEST
      ? buildFactoryRequestGoalGraphCommentSections(factoryRequestGoalGraph || {})
      : []),
    "Re-apply the ready label after reviewing this artifact to resume goal execution.",
  ].filter(Boolean).join("\n");

  const posted = ghExec([
    "issue",
    "comment",
    normalizedIssueNumber,
    "--repo",
    normalizedRepo,
    "--body",
    body,
  ]);

  return {
    planning_attachment_posted: posted.ok ? "true" : "false",
    planning_attachment_reason: posted.ok ? "attached" : "comment_failed",
    planning_artifact_path: normalizedArtifactPath,
    planning_packet_id: trim(planningPacketId),
    run_id: trim(runId),
  };
}

function hasReadyRemovedComment({ comments = [], planningArtifactPath = "" } = {}) {
  const normalizedPath = trim(planningArtifactPath);
  if (!normalizedPath) return false;
  return (Array.isArray(comments) ? comments : []).some((entry) => {
    const body = String(entry?.body || "");
    return body.includes(HARD_PLAN_READY_REMOVED_MARKER)
      && body.includes(`planning_artifact_path=${normalizedPath}`);
  });
}

export function markGoalPlanned({
  repoRoot = ".",
  repo = "",
  goalIssueNumber = "",
  goalExecutionPath = "",
  goalRoutingStateRaw = "{}",
  planningArtifactPath = "",
  factoryId = "mothership",
  runId = "",
  pipeline = "goal_hard_plan",
  nodeId = "mark_planned",
  targetRepo = "",
  controlPlaneRepo = "",
  ghExec = runGhCli,
} = {}) {
  const normalizedRepo = trim(repo);
  const normalizedIssueNumber = normalizeIssueNumber(goalIssueNumber);
  const normalizedArtifactPath = trim(planningArtifactPath);
  if (!normalizedRepo) throw new Error("missing_repo");
  if (!normalizedArtifactPath) throw new Error("missing_planning_artifact_path");

  ensureFactoryLabels({
    repo: normalizedRepo,
    factoryId,
    keys: [FACTORY_LABEL_KEYS.READY, FACTORY_LABEL_KEYS.AWAITING_HUMAN],
    ghExec,
  });

  const labelEdit = ghExec(buildIssueLabelEditArgs({
    repo: normalizedRepo,
    issueNumber: normalizedIssueNumber,
    factoryId,
    addKeys: [FACTORY_LABEL_KEYS.AWAITING_HUMAN],
    removeKeys: [FACTORY_LABEL_KEYS.READY],
  }));

  let readyCommentPosted = "false";
  if (labelEdit?.ok) {
    const readyCommentBody = [
      HARD_PLAN_READY_REMOVED_MARKER,
      "Hard-path planning is complete. The ready label was removed to enforce human review.",
      `planning_artifact_path=${normalizedArtifactPath}`,
      "After review, re-apply the ready label to resume from the approved planning state.",
    ].join("\n");

    const commented = ghExec([
      "issue",
      "comment",
      normalizedIssueNumber,
      "--repo",
      normalizedRepo,
      "--body",
      readyCommentBody,
    ]);
    readyCommentPosted = commented.ok ? "true" : "false";
  }

  const parsedRoutingState = parseJson(goalRoutingStateRaw, {});
  const normalizedGoalExecutionPath = trim(goalExecutionPath || parsedRoutingState?.goal_execution_path).toLowerCase() || "hard";
  let transition;
  try {
    transition = transitionGoalExecutionPathPlanningState({
      repo: repoRoot,
      goalIssueNumber: normalizedIssueNumber,
      factoryId,
      nextPlanningState: "pending_review",
      planningArtifactPath: normalizedArtifactPath,
      goalExecutionPath: normalizedGoalExecutionPath,
      goalRoutingStateRaw,
      classifiedBy: "goal.hard_plan.mark_planned",
      classificationReason: "Hard-path planning completed; waiting for human review and ready re-apply.",
      classificationSignalsRaw: JSON.stringify({
        transition: "planning_completed_pending_review",
        pipeline: trim(pipeline),
        node_id: trim(nodeId),
        run_id: trim(runId),
        planning_artifact_path: normalizedArtifactPath,
        goal_execution_path: normalizedGoalExecutionPath,
        goal_routing_state: parsedRoutingState,
      }),
      pipeline,
      nodeId,
      targetRepo: trim(targetRepo),
      controlPlaneRepo: trim(controlPlaneRepo),
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.startsWith(`missing_goal_execution_path_packet:${normalizedIssueNumber}`)) {
      throw error;
    }

    classifyGoalExecutionPath({
      repo: repoRoot,
      goalIssueNumber: normalizedIssueNumber,
      executionPath: normalizedGoalExecutionPath || "hard",
      routingContractVersion: GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
      classificationVersion: "goal_hard_plan/v1",
      decompositionState: "required",
      planningState: "pending_review",
      planningArtifactPath: normalizedArtifactPath,
      classifiedBy: "goal.hard_plan.mark_planned",
      classificationReason: "Initialize missing execution-path packet during hard-plan hold transition.",
      classificationSignalsRaw: JSON.stringify({
        transition: "seed_pending_review",
        pipeline: trim(pipeline),
        node_id: trim(nodeId),
        run_id: trim(runId),
        planning_artifact_path: normalizedArtifactPath,
        goal_execution_path: normalizedGoalExecutionPath,
        goal_routing_state: parsedRoutingState,
      }),
      factoryId,
      pipeline,
      nodeId,
      targetRepo: trim(targetRepo),
      controlPlaneRepo: trim(controlPlaneRepo),
    });

    transition = transitionGoalExecutionPathPlanningState({
      repo: repoRoot,
      goalIssueNumber: normalizedIssueNumber,
      factoryId,
      nextPlanningState: "pending_review",
      planningArtifactPath: normalizedArtifactPath,
      goalExecutionPath: normalizedGoalExecutionPath,
      goalRoutingStateRaw,
      classifiedBy: "goal.hard_plan.mark_planned",
      classificationReason: "Hard-path planning completed; waiting for human review and ready re-apply.",
      classificationSignalsRaw: JSON.stringify({
        transition: "planning_completed_pending_review",
        pipeline: trim(pipeline),
        node_id: trim(nodeId),
        run_id: trim(runId),
        planning_artifact_path: normalizedArtifactPath,
        goal_execution_path: normalizedGoalExecutionPath,
        goal_routing_state: parsedRoutingState,
      }),
      pipeline,
      nodeId,
      targetRepo: trim(targetRepo),
      controlPlaneRepo: trim(controlPlaneRepo),
    });
  }

  const normalizedTransitionArtifactPath = trim(transition.planning_artifact_path);
  return {
    goal_issue_number: normalizedIssueNumber,
    goal_execution_path: normalizedGoalExecutionPath,
    goal_routing_state: {
      decomposition_state: trim(transition.decomposition_state),
      planning_state: trim(transition.planning_state),
      ...(normalizedTransitionArtifactPath ? { planning_artifact_path: normalizedTransitionArtifactPath } : {}),
    },
    decomposition_state: trim(transition.decomposition_state),
    planning_state: trim(transition.planning_state),
    ...(normalizedTransitionArtifactPath ? { planning_artifact_path: normalizedTransitionArtifactPath } : {}),
    goal_execution_path_packet_id: trim(transition.packet_id),
    goal_execution_path_packet_path: trim(transition.packet_path),
    ready_label_removed: labelEdit.ok ? "true" : "false",
    ready_removed_comment_posted: readyCommentPosted,
  };
}
