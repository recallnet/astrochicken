import { trim, parseJson } from "../cli-helpers.ts";

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(true|1|yes)$/i.test(String(value).trim());
}

function toNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
}

function normalizePipeline(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeComplexityClass(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "low") return "low";
  if (normalized === "medium" || normalized === "high") return "high";
  return "unknown";
}

function toTelemetryStringMap(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
}

function normalizeFeatureList(features) {
  const parsed = parseJson(features, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item === "object");
}

function flattenTelemetry(telemetry = {}) {
  const pipeline = String(telemetry["hatch.ceremony.pipeline"] || "");
  const skipped = String(telemetry["hatch.ceremony.skipped"] || "false");
  const skipReason = String(telemetry["hatch.ceremony.skip_reason"] || "");
  const reason = String(telemetry["hatch.ceremony.reason"] || "");

  return {
    hatch_ceremony_pipeline: pipeline,
    hatch_ceremony_skipped: skipped,
    hatch_ceremony_skip_reason: skipReason,
    hatch_ceremony_reason: reason,
  };
}

function inferCriteriaCounts(features = []) {
  const counts = [];
  let hasMissing = false;

  for (const feature of features) {
    const criteria = feature?.acceptance_criteria;
    if (!Array.isArray(criteria)) {
      hasMissing = true;
      counts.push(-1);
      continue;
    }
    counts.push(criteria.length);
  }

  return {
    counts,
    hasMissing,
  };
}

function inferIssueJudgeMetadata({ issueSpec, feature } = {}) {
  const spec = parseJson(issueSpec, {});
  const f = parseJson(feature, {});

  const criteriaFromFeature = Array.isArray(f?.acceptance_criteria)
    ? f.acceptance_criteria.length
    : null;
  const criteriaFromSpec = Array.isArray(spec?.acceptance_criteria)
    ? spec.acceptance_criteria.length
    : null;

  const dependencyFromFeature = Array.isArray(f?.dependencies)
    ? f.dependencies.length
    : null;
  const dependencyFromSpec = Array.isArray(spec?.dependencies)
    ? spec.dependencies.length
    : null;

  const conservativeCount = ({ fromSpec, fromFeature }) => {
    const specCount = toNonNegativeInteger(fromSpec);
    const featureCount = toNonNegativeInteger(fromFeature);
    if (specCount === null) return featureCount;
    if (featureCount === null) return specCount;
    return Math.max(specCount, featureCount);
  };

  const domainSet = new Set();
  const addDomain = (value) => {
    const text = String(value || "").trim();
    if (text) domainSet.add(text);
  };

  if (Array.isArray(f?.domains)) {
    for (const domain of f.domains) addDomain(domain);
  } else {
    addDomain(f?.domain);
  }

  if (Array.isArray(spec?.domains)) {
    for (const domain of spec.domains) addDomain(domain);
  } else {
    addDomain(spec?.domain);
  }

  const acceptanceCriteriaCount = conservativeCount({
    fromSpec: criteriaFromSpec,
    fromFeature: criteriaFromFeature,
  });
  const dependencyCount = conservativeCount({
    fromSpec: dependencyFromSpec,
    fromFeature: dependencyFromFeature,
  });
  const domainCount = domainSet.size > 0 ? domainSet.size : null;

  return {
    acceptanceCriteriaCount,
    dependencyCount,
    domainCount,
  };
}

export function buildCeremonyTelemetry({
  pipeline = "unknown",
  skipped = false,
  skipReason = "",
  reason = "",
  extra = {},
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "unknown");
  const skippedFlag = skipped ? "true" : "false";
  const normalizedSkipReason = String(skipReason || "").trim() || `${pipelineName}.full_ceremony`;
  const normalizedReason = String(reason || "").trim() || normalizedSkipReason;

  return {
    ...toTelemetryStringMap(extra),
    ceremony_pipeline: pipelineName,
    ceremony_skipped: skippedFlag,
    ceremony_skip_reason: normalizedSkipReason,
    ceremony_reason: normalizedReason,
    "hatch.ceremony.pipeline": pipelineName,
    "hatch.ceremony.skipped": skippedFlag,
    "hatch.ceremony.skip_reason": normalizedSkipReason,
    "hatch.ceremony.reason": normalizedReason,
  };
}

export function shouldSkipGoalReview({
  goalCount,
  skipReviewSingleGoal = false,
  pipeline = "goal_batch",
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "goal_batch");
  const enabled = toBoolean(skipReviewSingleGoal, false);
  const count = toNonNegativeInteger(goalCount);

  const buildResult = ({ skip, reason, goalCountValue }) => {
    const telemetry = buildCeremonyTelemetry({
      pipeline: pipelineName,
      skipped: skip,
      skipReason: skip ? reason : `${pipelineName}.full_review`,
      reason,
    });

    return {
      skip,
      reason,
      goal_count: goalCountValue,
      telemetry,
      ...flattenTelemetry(telemetry),
    };
  };

  if (!enabled) {
    return buildResult({
      skip: false,
      reason: `${pipelineName}.skip_disabled`,
      goalCountValue: count ?? -1,
    });
  }

  if (count === null) {
    return buildResult({
      skip: false,
      reason: `${pipelineName}.missing_goal_count`,
      goalCountValue: -1,
    });
  }

  if (count === 1) {
    return buildResult({
      skip: true,
      reason: `${pipelineName}.single_goal`,
      goalCountValue: count,
    });
  }

  return buildResult({
    skip: false,
    reason: count === 0 ? `${pipelineName}.no_goals` : `${pipelineName}.multiple_goals`,
    goalCountValue: count,
  });
}

export function decomposeAutoApproveDecision({
  features,
  decomposeAutoApprove = false,
  maxFeatures = 2,
  maxCriteriaPerFeature = 2,
  pipeline = "goal_intake_decompose",
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "goal_intake_decompose");
  const enabled = toBoolean(decomposeAutoApprove, false);
  const featureList = normalizeFeatureList(features);
  const maxFeaturesLimit = toNonNegativeInteger(maxFeatures) ?? 2;
  const maxCriteriaLimit = toNonNegativeInteger(maxCriteriaPerFeature) ?? 2;
  const featureCount = featureList.length;
  const { counts, hasMissing } = inferCriteriaCounts(featureList);

  const hasAnyFeature = featureCount > 0;
  const exceedsFeatureCount = featureCount > maxFeaturesLimit;
  const exceedsCriteriaCount = counts.some((count) => count > maxCriteriaLimit);
  const hasEmptyCriteria = counts.some((count) => count === 0);
  const isLowComplexity = hasAnyFeature && !hasMissing && !hasEmptyCriteria && !exceedsFeatureCount && !exceedsCriteriaCount;

  let reason = "";
  if (!enabled) reason = "decompose.auto_approve_disabled";
  else if (!hasAnyFeature) reason = "decompose.missing_features";
  else if (hasMissing) reason = "decompose.criteria_metadata_missing";
  else if (hasEmptyCriteria) reason = "decompose.empty_criteria";
  else if (exceedsFeatureCount) reason = "decompose.feature_count_exceeds_threshold";
  else if (exceedsCriteriaCount) reason = "decompose.criteria_exceeds_threshold";
  else reason = "decompose.auto_approve";

  const autoApprove = enabled && isLowComplexity;
  const complexityClass = hasAnyFeature
    ? (isLowComplexity ? "low" : (hasMissing ? "unknown" : "high"))
    : "unknown";

  const telemetry = buildCeremonyTelemetry({
    pipeline: pipelineName,
    skipped: autoApprove,
    skipReason: autoApprove ? "decompose.auto_approve" : `${pipelineName}.full_review`,
    reason,
    extra: {
      decompose_complexity: complexityClass,
    },
  });

  return {
    skip: autoApprove,
    auto_approve: autoApprove,
    approved: autoApprove,
    approved_features: featureList,
    factory_request_goal_graph: {},
    review_notes: autoApprove ? "Auto-approved by complexity-floor heuristics." : "",
    reason,
    decompose_complexity: complexityClass,
    feature_count: featureCount,
    criteria_counts: counts,
    telemetry,
    ...flattenTelemetry(telemetry),
  };
}

export function shouldSkipIssueJudge({
  issueSpec,
  feature,
  skipTrivialJudge = false,
  pipeline = "write_issue_item",
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "write_issue_item");
  const enabled = toBoolean(skipTrivialJudge, false);
  const metadata = inferIssueJudgeMetadata({ issueSpec, feature });

  const acceptanceCriteriaCount = toNonNegativeInteger(metadata.acceptanceCriteriaCount);
  const dependencyCount = toNonNegativeInteger(metadata.dependencyCount);
  const domainCount = toNonNegativeInteger(metadata.domainCount);
  const metadataMissing = acceptanceCriteriaCount === null || dependencyCount === null || domainCount === null;

  const isTrivial = !metadataMissing
    && acceptanceCriteriaCount <= 2
    && dependencyCount === 0
    && domainCount === 1;

  let reason = "";
  if (!enabled) reason = "write_issue.skip_disabled";
  else if (metadataMissing) reason = "write_issue.metadata_missing";
  else if (acceptanceCriteriaCount > 2) reason = "write_issue.criteria_exceeds_threshold";
  else if (dependencyCount > 0) reason = "write_issue.dependencies_present";
  else if (domainCount !== 1) reason = "write_issue.multi_domain";
  else reason = "write_issue.trivial_spec";

  const skip = enabled && isTrivial;

  const telemetry = buildCeremonyTelemetry({
    pipeline: pipelineName,
    skipped: skip,
    skipReason: skip ? "write_issue.trivial_spec" : `${pipelineName}.full_judge`,
    reason,
  });

  return {
    skip,
    reason,
    acceptance_criteria_count: acceptanceCriteriaCount ?? -1,
    dependency_count: dependencyCount ?? -1,
    domain_count: domainCount ?? -1,
    telemetry,
    ...flattenTelemetry(telemetry),
  };
}

export function classifyMilestoneIssueComplexity({
  complexityClass,
  milestoneParallelLowEnabled = false,
  pipeline = "milestone_execute",
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "milestone_execute");
  const enabled = toBoolean(milestoneParallelLowEnabled, false);
  const normalizedClass = normalizeComplexityClass(complexityClass);

  const runParallelBatch = enabled && normalizedClass === "low";
  let reason = "milestone.high_sequential";
  if (runParallelBatch) {
    reason = "milestone.low_parallel_batch";
  } else if (normalizedClass === "unknown") {
    reason = "milestone.sequential_fallback_unknown";
  }

  const telemetry = buildCeremonyTelemetry({
    pipeline: pipelineName,
    skipped: runParallelBatch,
    skipReason: reason,
    reason,
  });

  return {
    complexity_class: normalizedClass,
    run_parallel_batch: runParallelBatch,
    reason,
    telemetry,
    ...flattenTelemetry(telemetry),
  };
}

export function buildMilestoneParallelBatch({
  issues,
  maxParallel = 3,
  pipeline = "milestone_execute",
} = {}) {
  const pipelineName = normalizePipeline(pipeline, "milestone_execute");
  const list = parseJson(issues, []);
  const entries = Array.isArray(list) ? list : [];
  const limitRaw = toNonNegativeInteger(maxParallel);
  const limit = Math.min(Math.max(limitRaw === null ? 3 : limitRaw, 1), 3);

  const batch = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const issueNumber = String(item.issue_number ?? item.number ?? "").trim();
    if (!issueNumber) continue;

    const issueTitle = String(item.issue_title ?? item.title ?? "");
    const className = normalizeComplexityClass(item.complexity_class);
    if (className !== "low") break;

    const payload = {
      issue_number: issueNumber,
      issue_title: issueTitle,
      complexity_class: className,
    };

    batch.push(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"));

    if (batch.length >= limit) break;
  }

  const reason = batch.length > 0
    ? "milestone.low_parallel_batch"
    : "milestone.parallel_batch_empty";

  const telemetry = buildCeremonyTelemetry({
    pipeline: pipelineName,
    skipped: batch.length > 0,
    skipReason: reason,
    reason,
    extra: {
      max_parallel: limit,
    },
  });

  return {
    batch_issues: batch,
    batch_size: batch.length,
    reason,
    telemetry,
    ...flattenTelemetry(telemetry),
  };
}
