import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Command, Option } from "clipanion";

import {
  createGitHubIssueFromSpec,
  updateGitHubIssueFromSpec,
} from "../../../commands/common-create-issue.ts";
import { addSubIssue, listGoalSubIssues } from "../../../commands/goal-sub-issues.ts";
import {
  applySuggestionStatusUpdates,
  DEFAULT_LEARNING_LOG_JSON_PATH,
} from "../../analysis/learning-log.ts";
import { prepareLensCandidateEntries } from "../../analysis/lens-candidates.ts";
import * as cliTransport from "../../cli-helpers.ts";

const CANDIDATE_LABELS = ["daily-lens", "daily-lens-candidate"];

const CANDIDATE_SCHEMA = "daily_lens_candidate.v1";
const REPORT_SCHEMA = "daily_lens_report_followup.v1";

const CANDIDATE_METADATA_MARKER = "DL-Candidate-Metadata:";
const REPORT_METADATA_MARKER = "DL-Report-Candidate-Metadata:";
const LEGACY_CANDIDATE_METADATA_MARKER = "DAILY_LENS_CANDIDATE_METADATA";

const CANDIDATE_GENERATED_START = "<!-- DL-Candidate-Generated:START -->";
const CANDIDATE_GENERATED_END = "<!-- DL-Candidate-Generated:END -->";

const CANDIDATE_METADATA_REGEX = /<!--\s*DL-Candidate-Metadata:\s*(\{[\s\S]*?\})\s*-->/;
const LEGACY_CANDIDATE_METADATA_REGEX = /<!--\s*DAILY_LENS_CANDIDATE_METADATA\s+(\{[\s\S]*?\})\s*-->/;
const REPORT_METADATA_REGEX = /<!--\s*DL-Report-Candidate-Metadata:\s*(\{[\s\S]*?\})\s*-->/;
const GENERATED_BLOCK_REGEX = /<!--\s*DL-Candidate-Generated:START\s*-->\n?([\s\S]*?)\n?<!--\s*DL-Candidate-Generated:END\s*-->/;

let runtimeOverrides = {};

function asString(value) {
  return String(value ?? "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseIssueNumberFromUrl(issueUrl = "") {
  const match = asString(issueUrl).match(/\/issues\/(\d+)$/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function resolveRuntime() {
  return {
    readFile: runtimeOverrides.readFile || ((filePath) => readFileSync(filePath, "utf8")),
    listGoalSubIssues: runtimeOverrides.listGoalSubIssues || listGoalSubIssues,
    createIssue: runtimeOverrides.createIssue || createGitHubIssueFromSpec,
    updateIssue: runtimeOverrides.updateIssue || updateGitHubIssueFromSpec,
    addSubIssue: runtimeOverrides.addSubIssue || addSubIssue,
    applySuggestionStatusUpdates: runtimeOverrides.applySuggestionStatusUpdates || applySuggestionStatusUpdates,
    ghJson: runtimeOverrides.ghJson || cliTransport.ghJson,
    ghJsonPaginated: runtimeOverrides.ghJsonPaginated || cliTransport.ghJsonPaginated,
    commentIssue: runtimeOverrides.commentIssue || (({ repo, issueNumber, body }) => cliTransport.gh([
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repo,
      "--body",
      body,
    ])),
  };
}

export function setAnalysisLensFollowupCandidatesRuntimeForTest(overrides = {}) {
  runtimeOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
}

export function resetAnalysisLensFollowupCandidatesRuntimeForTest() {
  runtimeOverrides = {};
}

function parseJsonOrThrow(raw = "", errorCode = "invalid_json") {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${errorCode}: ${String(error?.message || error)}`);
  }
}

function resolveActionEntries(lensPayload = {}) {
  const prepared = prepareLensCandidateEntries(lensPayload);
  return asArray(prepared.entries).map((entry) => ({
    id: asString(entry.suggestion_id),
    title: asString(entry.title || entry.summary),
    summary: asString(entry.summary || entry.title),
    whyNow: asString(entry.why_now),
    successMetric: asString(entry.success_metric),
    recommendation: asString(entry.recommendation),
    implementationHints: "",
    type: asString(entry.type),
    elevation: "",
    evidenceRefs: asArray(entry.evidence).map((evidence) => asString(evidence)).filter(Boolean),
    dependencyHints: asArray(entry.dependency_hints).map((hint) => asString(hint)).filter(Boolean),
    source: asString(entry.candidate_source),
    executionOwner: asString(entry.execution_owner),
  }));
}

function looksLikeSuggestionId(token = "") {
  const normalized = asString(token).toLowerCase();
  if (!normalized) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) return false;
  if (normalized.startsWith("lens-") || normalized.startsWith("sug-")) return true;
  const separatorCount = (normalized.match(/[-._]/g) || []).length;
  return separatorCount >= 2 && normalized.length >= 8;
}

function extractSuggestionIdsFromText(text = "") {
  const matches = String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [];
  return [...new Set(matches.filter((token) => looksLikeSuggestionId(token)))];
}

function extractSupersededSuggestionIds(action = {}) {
  const superseded = new Set();
  const sources = [
    ...asArray(action?.dependencyHints),
    ...asArray(action?.evidenceRefs),
    asString(action?.whyNow),
  ].map((value) => asString(value)).filter(Boolean);

  for (const source of sources) {
    const normalized = source.toLowerCase();
    if (normalized.includes("supersed")) {
      const markerIndex = normalized.indexOf("supersed");
      const suffix = markerIndex >= 0 ? source.slice(markerIndex + "supersed".length) : source;
      for (const suggestionId of extractSuggestionIdsFromText(suffix)) {
        superseded.add(suggestionId);
      }
      continue;
    }

    const shouldScanFullSource = normalized.includes("duplicate coverage")
      || normalized.includes("consolidate");
    if (!shouldScanFullSource) continue;

    for (const suggestionId of extractSuggestionIdsFromText(source)) {
      superseded.add(suggestionId);
    }
  }

  superseded.delete(asString(action?.id).toLowerCase());
  return [...superseded];
}

function mergeEvidenceRefs(left = [], right = []) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...asArray(left), ...asArray(right)]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const key = JSON.stringify(Object.fromEntries(Object.entries(entry).sort(([l], [r]) => l.localeCompare(r))));
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

function buildLearningLogStatusUpdates({
  actions = [],
  candidates = [],
  reportIssueNumber = 0,
  reportIssueUrl = "",
  reportRunId = "",
  publicationSha = "",
  registrySha = "",
} = {}) {
  const candidateByActionId = new Map();
  for (const candidate of asArray(candidates)) {
    const actionId = asString(candidate?.action_id);
    if (!actionId) continue;
    candidateByActionId.set(actionId, candidate);
  }

  const updatesById = new Map();

  const upsertUpdate = ({ id = "", status = "", evidenceRefs = [], impactNotes = "" } = {}) => {
    const normalizedId = asString(id);
    if (!normalizedId) return;
    const normalizedStatus = asString(status);
    const existing = updatesById.get(normalizedId);
    if (!existing) {
      updatesById.set(normalizedId, {
        id: normalizedId,
        status: normalizedStatus,
        evidenceRefs: mergeEvidenceRefs([], evidenceRefs),
        impactNotes: asString(impactNotes),
      });
      return;
    }

    const statusRank = { adopted: 2, dismissed: 1, pending: 0 };
    const existingRank = statusRank[existing.status] ?? 0;
    const nextRank = statusRank[normalizedStatus] ?? 0;
    const nextStatus = nextRank >= existingRank ? normalizedStatus : existing.status;

    updatesById.set(normalizedId, {
      id: normalizedId,
      status: nextStatus,
      evidenceRefs: mergeEvidenceRefs(existing.evidenceRefs, evidenceRefs),
      impactNotes: asString(impactNotes) || existing.impactNotes,
    });
  };

  for (const action of asArray(actions)) {
    const actionId = asString(action?.id);
    if (!actionId) continue;

    const candidate = candidateByActionId.get(actionId);
    const candidateIssueNumber = parsePositiveInt(candidate?.issue_number);
    const candidateIssueUrl = asString(candidate?.issue_url);

    upsertUpdate({
      id: actionId,
      status: "adopted",
      impactNotes: `Promoted to Daily Lens candidate issue #${candidateIssueNumber || "unknown"}.`,
      evidenceRefs: [{
        report_issue_number: String(Number(reportIssueNumber) || 0),
        report_issue_url: asString(reportIssueUrl),
        report_run_id: asString(reportRunId),
        publication_sha: asString(publicationSha),
        registry_sha: asString(registrySha),
        action_id: actionId,
        candidate_issue_number: String(candidateIssueNumber || 0),
        candidate_issue_url: candidateIssueUrl,
      }],
    });

    const supersededIds = extractSupersededSuggestionIds(action);
    for (const supersededId of supersededIds) {
      upsertUpdate({
        id: supersededId,
        status: "dismissed",
        impactNotes: `Superseded by ${actionId}.`,
        evidenceRefs: [{
          report_issue_number: String(Number(reportIssueNumber) || 0),
          action_id: actionId,
          superseded_by_action_id: actionId,
          candidate_issue_number: String(candidateIssueNumber || 0),
        }],
      });
    }
  }

  return [...updatesById.values()]
    .filter((entry) => entry.status === "adopted" || entry.status === "dismissed")
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildGeneratedFields({
  reportIssueNumber,
  action,
  repo = "",
  factoryId = "",
} = {}) {
  return {
    report_issue_number: Number(reportIssueNumber),
    action_id: asString(action?.id),
    title: asString(action?.title),
    summary: asString(action?.summary),
    why_now: asString(action?.whyNow),
    success_metric: asString(action?.successMetric),
    recommendation: asString(action?.recommendation),
    implementation_hints: asString(action?.implementationHints),
    dependency_hints: asArray(action?.dependencyHints).map((entry) => asString(entry)).filter(Boolean),
    evidence_links: asArray(action?.evidenceRefs).map((entry) => asString(entry)).filter(Boolean),
    action_type: asString(action?.type || "task"),
    execution_owner: asString(action?.executionOwner || "supervisor_on_main"),
    elevation: asString(action?.elevation || "unspecified"),
    source_repo: asString(repo),
    factory_id: asString(factoryId),
    candidate_source: asString(action?.source || "suggestions"),
  };
}

function buildCandidateMetadata({
  reportIssueNumber,
  actionId,
  factoryId = "",
  runId = "",
  publicationSha = "",
  generatedFieldsHash = "",
  managedBlockHash = "",
} = {}) {
  return {
    schema: CANDIDATE_SCHEMA,
    schema_version: 1,
    report_issue_number: Number(reportIssueNumber),
    action_id: asString(actionId),
    factory_id: asString(factoryId),
    report_run_id: asString(runId),
    publication_sha: asString(publicationSha),
    generated_fields_hash: asString(generatedFieldsHash),
    managed_block_hash: asString(managedBlockHash),
  };
}

function renderCandidateMetadataComment(metadata = {}) {
  return `<!-- ${CANDIDATE_METADATA_MARKER} ${JSON.stringify(metadata)} -->`;
}

function renderReportMetadataComment(metadata = {}) {
  return `<!-- ${REPORT_METADATA_MARKER} ${JSON.stringify(metadata)} -->`;
}

function renderGeneratedCandidateBlock({
  reportIssueNumber,
  action,
  repo = "",
  factoryId = "",
  runId = "",
  publicationSha = "",
} = {}) {
  const evidenceSection = action.evidenceRefs.length > 0
    ? `\n## Evidence links\n${action.evidenceRefs.map((ref) => `- ${ref}`).join("\n")}`
    : "";
  const recommendationSection = action.recommendation
    ? `\n## Recommendation\n${action.recommendation}`
    : "";
  const whyNowSection = action.whyNow
    ? `\n## Why now\n${action.whyNow}`
    : "\n## Why now\nNot provided.";
  const successMetricSection = action.successMetric
    ? `\n## Success metric\n${action.successMetric}`
    : "\n## Success metric\nNot provided.";
  const dependencySection = action.dependencyHints.length > 0
    ? `\n## Dependency hints\n${action.dependencyHints.map((hint) => `- ${hint}`).join("\n")}`
    : "";
  const executionOwnerSection = `\n## Execution owner\n${asString(action.executionOwner || "supervisor_on_main")}`;
  const implementationSection = action.implementationHints
    ? `\n## Implementation hints\n${action.implementationHints}`
    : "\n## Implementation hints\n- Convert this candidate into execution-ready steps during operator review.";
  const reportUrl = asString(repo) && Number(reportIssueNumber) > 0
    ? `https://github.com/${repo}/issues/${reportIssueNumber}`
    : "";

  return [
    "## Action title",
    action.title || action.summary,
    "\n## Summary",
    action.summary,
    whyNowSection,
    successMetricSection,
    recommendationSection,
    executionOwnerSection,
    implementationSection,
    dependencySection,
    evidenceSection,
    "\n## Provenance",
    `- Origin report: #${reportIssueNumber}${reportUrl ? ` (${reportUrl})` : ""}`,
    `- Action id: ${action.id}`,
    `- Action type: ${action.type || "task"}`,
    `- Execution owner: ${asString(action.executionOwner || "supervisor_on_main")}`,
    `- Elevation: ${action.elevation || "unspecified"}`,
    `- Candidate source: ${action.source || "suggestions"}`,
    `- Factory id: ${asString(factoryId) || "unknown"}`,
    `- Report run id: ${asString(runId) || "n/a"}`,
    `- Publication SHA: ${asString(publicationSha) || "n/a"}`,
  ].join("\n");
}

function buildIssueSpec({
  reportIssueNumber,
  action,
  repo = "",
  factoryId = "",
  runId = "",
  publicationSha = "",
} = {}) {
  const generatedFields = buildGeneratedFields({
    reportIssueNumber,
    action,
    repo,
    factoryId,
  });
  const generatedFieldsHash = sha256(JSON.stringify(generatedFields));
  const generatedBlock = renderGeneratedCandidateBlock({
    reportIssueNumber,
    action,
    repo,
    factoryId,
    runId,
    publicationSha,
  });
  const managedBlockHash = sha256(generatedBlock);

  const metadata = buildCandidateMetadata({
    reportIssueNumber,
    actionId: action.id,
    factoryId,
    runId,
    publicationSha,
    generatedFieldsHash,
    managedBlockHash,
  });

  const issueBody = [
    CANDIDATE_GENERATED_START,
    generatedBlock,
    CANDIDATE_GENERATED_END,
    "",
    "## Operator notes",
    "- Keep this section for human edits, scoping adjustments, and implementation details.",
    "",
    renderCandidateMetadataComment(metadata),
  ].join("\n");

  return {
    issueSpec: {
      issue_title: `Daily Lens follow-up: ${action.summary}`,
      issue_body: issueBody,
      issue_labels: CANDIDATE_LABELS.join(","),
    },
    metadata,
    generatedBlock,
  };
}

function parseCandidateMetadataFromBody(issueBody = "") {
  const rawBody = String(issueBody || "");

  const metadataMatch = rawBody.match(CANDIDATE_METADATA_REGEX) || rawBody.match(LEGACY_CANDIDATE_METADATA_REGEX);
  if (metadataMatch?.[1]) {
    try {
      const parsed = JSON.parse(metadataMatch[1]);
      return {
        schema: asString(parsed?.schema),
        schema_version: parsePositiveInt(parsed?.schema_version),
        report_issue_number: parsePositiveInt(parsed?.report_issue_number),
        action_id: asString(parsed?.action_id),
        factory_id: asString(parsed?.factory_id),
        report_run_id: asString(parsed?.report_run_id || parsed?.run_id),
        publication_sha: asString(parsed?.publication_sha),
        generated_fields_hash: asString(parsed?.generated_fields_hash),
        managed_block_hash: asString(parsed?.managed_block_hash),
      };
    } catch {
      return null;
    }
  }

  const lineMatch = rawBody.match(/Daily Lens report #(\d+)\s*\|\s*action:\s*([^|\n]+)/i);
  if (!lineMatch) return null;
  return {
    schema: CANDIDATE_SCHEMA,
    schema_version: 0,
    report_issue_number: parsePositiveInt(lineMatch[1]),
    action_id: asString(lineMatch[2]),
    factory_id: "",
    report_run_id: "",
    publication_sha: "",
    generated_fields_hash: "",
    managed_block_hash: "",
  };
}

function extractGeneratedBlock(issueBody = "") {
  const rawBody = String(issueBody || "");
  const match = rawBody.match(GENERATED_BLOCK_REGEX);
  return asString(match?.[1] || "");
}

function replaceMetadataComment(issueBody = "", metadataComment = "") {
  const rawBody = String(issueBody || "");
  if (CANDIDATE_METADATA_REGEX.test(rawBody)) {
    return rawBody.replace(CANDIDATE_METADATA_REGEX, metadataComment);
  }
  if (LEGACY_CANDIDATE_METADATA_REGEX.test(rawBody)) {
    return rawBody.replace(LEGACY_CANDIDATE_METADATA_REGEX, metadataComment);
  }
  return `${rawBody.trimEnd()}\n\n${metadataComment}\n`;
}

function mergeIssueBody({ existingBody = "", generatedBlock = "", metadata = {} } = {}) {
  const rawBody = String(existingBody || "");
  const metadataComment = renderCandidateMetadataComment(metadata);

  if (!rawBody.includes(CANDIDATE_GENERATED_START) || !rawBody.includes(CANDIDATE_GENERATED_END)) {
    return [
      CANDIDATE_GENERATED_START,
      generatedBlock,
      CANDIDATE_GENERATED_END,
      "",
      "## Operator notes",
      "- Keep this section for human edits, scoping adjustments, and implementation details.",
      "",
      metadataComment,
    ].join("\n");
  }

  const nextWithManagedBlock = rawBody.replace(
    GENERATED_BLOCK_REGEX,
    `${CANDIDATE_GENERATED_START}\n${generatedBlock}\n${CANDIDATE_GENERATED_END}`,
  );
  return replaceMetadataComment(nextWithManagedBlock, metadataComment);
}

function parseCandidateState(issueBody = "") {
  const metadata = parseCandidateMetadataFromBody(issueBody);
  const generatedBlock = extractGeneratedBlock(issueBody);
  const hasManagedBlock = Boolean(generatedBlock);
  const managedBlockHash = hasManagedBlock ? sha256(generatedBlock) : "";
  const managedBlockEdited = Boolean(
    metadata?.managed_block_hash
    && hasManagedBlock
    && metadata.managed_block_hash !== managedBlockHash,
  );

  return {
    metadata,
    generatedBlock,
    managedBlockEdited,
  };
}

function resolveCandidateIssueUrl({ repo = "", issueNumber = 0, issueUrl = "" } = {}) {
  const normalizedIssueUrl = asString(issueUrl);
  if (normalizedIssueUrl) return normalizedIssueUrl;
  const normalizedRepo = asString(repo);
  const parsedNumber = parsePositiveInt(issueNumber);
  if (!normalizedRepo || parsedNumber <= 0) return "";
  return `https://github.com/${normalizedRepo}/issues/${parsedNumber}`;
}

function loadLensPayload({ analysisPath = "", lensPayloadRaw = "", readFileFn } = {}) {
  const payloadRaw = asString(lensPayloadRaw)
    ? lensPayloadRaw
    : readFileFn(asString(analysisPath));
  return parseJsonOrThrow(payloadRaw, "lens_followup_candidates_invalid_analysis_payload");
}

function listExistingCandidatesByActionId({
  repo,
  reportIssueNumber,
  listGoalSubIssuesFn,
  ghJsonFn,
  ghJsonPaginatedFn,
} = {}) {
  const subIssues = listGoalSubIssuesFn({
    repo,
    goalNumber: reportIssueNumber,
    ghPaginatedFn: ghJsonPaginatedFn,
  });

  const byActionId = new Map();
  for (const subIssue of asArray(subIssues)) {
    const issueNumber = parsePositiveInt(subIssue?.number);
    if (issueNumber <= 0) continue;

    const issue = ghJsonFn([
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      repo,
      "--json",
      "number,url,title,body",
    ], {});

    const issueBody = String(issue?.body || "");
    const hasMetadataMarker = issueBody.includes(CANDIDATE_METADATA_MARKER)
      || issueBody.includes(LEGACY_CANDIDATE_METADATA_MARKER);

    const metadata = parseCandidateMetadataFromBody(issueBody);
    if (hasMetadataMarker && !metadata) {
      throw new Error(`lens_followup_candidates_malformed_candidate_metadata: issue_number=${issueNumber}`);
    }
    if (!metadata) continue;
    if (metadata.report_issue_number <= 0 || !metadata.action_id) {
      throw new Error(`lens_followup_candidates_invalid_candidate_metadata: issue_number=${issueNumber}`);
    }
    if (metadata.report_issue_number !== reportIssueNumber) continue;

    if (byActionId.has(metadata.action_id)) {
      throw new Error(`lens_followup_candidates_duplicate_existing_candidate: action_id=${metadata.action_id}`);
    }

    byActionId.set(metadata.action_id, {
      number: issueNumber,
      url: asString(issue?.url),
      title: asString(issue?.title),
      body: issueBody,
      metadata,
    });
  }

  return byActionId;
}

function upsertReportMetadataBlock(issueBody = "", metadata = {}) {
  const metadataComment = renderReportMetadataComment(metadata);
  const rawBody = String(issueBody || "");
  if (REPORT_METADATA_REGEX.test(rawBody)) {
    return rawBody.replace(REPORT_METADATA_REGEX, metadataComment);
  }
  return `${rawBody.trimEnd()}\n\n${metadataComment}\n`;
}

function updateParentReportIssue({
  runtime,
  repo,
  reportIssueNumber,
  reportRunId = "",
  publicationSha = "",
  factoryId = "",
  registrySha = "",
  actionCount = 0,
  createdCount = 0,
  updatedCount = 0,
  reusedCount = 0,
  reconciledCount = 0,
} = {}) {
  const reportIssue = runtime.ghJson([
    "issue",
    "view",
    String(reportIssueNumber),
    "--repo",
    repo,
    "--json",
    "number,url,title,body",
  ], {});

  const resolvedIssueNumber = parsePositiveInt(reportIssue?.number || reportIssueNumber);
  const issueUrl = resolveCandidateIssueUrl({
    repo,
    issueNumber: resolvedIssueNumber,
    issueUrl: reportIssue?.url,
  });
  if (!issueUrl) {
    throw new Error(`lens_followup_candidates_parent_issue_lookup_failed: report_issue_number=${reportIssueNumber}`);
  }

  const reportMetadata = {
    schema: REPORT_SCHEMA,
    schema_version: 1,
    report_issue_number: resolvedIssueNumber,
    factory_id: asString(factoryId),
    report_run_id: asString(reportRunId),
    publication_sha: asString(publicationSha),
    registry_sha: asString(registrySha),
    generated_at: new Date().toISOString(),
    action_count: Number(actionCount) || 0,
    created_count: Number(createdCount) || 0,
    updated_count: Number(updatedCount) || 0,
    reused_count: Number(reusedCount) || 0,
    reconciled_count: Number(reconciledCount) || 0,
  };

  const issueSpec = {
    issue_title: asString(reportIssue?.title) || `Daily Lens Report #${resolvedIssueNumber}`,
    issue_body: upsertReportMetadataBlock(reportIssue?.body || "", reportMetadata),
  };
  if (Number(createdCount) > 0) {
    issueSpec.issue_labels = "goal";
  }
  const issueSpecRaw = JSON.stringify(issueSpec);
  const updatedReport = runtime.updateIssue({
    repo,
    issueUrl,
    issueSpecRaw,
  });

  if (!updatedReport?.ok) {
    throw new Error(`lens_followup_candidates_parent_issue_update_failed: report_issue_number=${resolvedIssueNumber} error=${asString(updatedReport?.error || updatedReport?.stderr || updatedReport?.status) || "unknown"}`);
  }

  return {
    issue_number: resolvedIssueNumber,
    issue_url: issueUrl,
    metadata: reportMetadata,
  };
}

export async function runAnalysisLensFollowupCandidates({
  repo = "",
  reportIssueNumber = "",
  analysisPath = "",
  lensPayloadRaw = "",
  runId = "",
  publicationSha = "",
  factoryId = "mothership",
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
} = {}) {
  const normalizedRepo = asString(repo);
  const normalizedReportIssueNumber = parsePositiveInt(reportIssueNumber);

  if (!normalizedRepo) {
    throw new Error("missing_repo: --repo is required");
  }
  if (normalizedReportIssueNumber <= 0) {
    throw new Error("missing_report_issue_number: --report-issue-number is required");
  }
  if (!asString(analysisPath) && !asString(lensPayloadRaw)) {
    throw new Error("missing_analysis_payload: --analysis-path or --lens-payload is required");
  }

  const runtime = resolveRuntime();
  const lensPayload = loadLensPayload({
    analysisPath,
    lensPayloadRaw,
    readFileFn: runtime.readFile,
  });

  const actions = resolveActionEntries(lensPayload);
  const registrySha = sha256(JSON.stringify(actions));
  const existingByActionId = listExistingCandidatesByActionId({
    repo: normalizedRepo,
    reportIssueNumber: normalizedReportIssueNumber,
    listGoalSubIssuesFn: runtime.listGoalSubIssues,
    ghJsonFn: runtime.ghJson,
    ghJsonPaginatedFn: runtime.ghJsonPaginated,
  });

  const candidates = [];
  for (const action of actions) {
    const rendered = buildIssueSpec({
      reportIssueNumber: normalizedReportIssueNumber,
      action,
      repo: normalizedRepo,
      factoryId,
      runId,
      publicationSha,
    });

    const existing = existingByActionId.get(action.id);
    if (existing) {
      const existingState = parseCandidateState(existing.body || "");
      const existingGeneratedHash = asString(existingState?.metadata?.generated_fields_hash);
      if (existingGeneratedHash && existingGeneratedHash === rendered.metadata.generated_fields_hash) {
        candidates.push({
          action_id: action.id,
          issue_number: parsePositiveInt(existing.number),
          issue_url: resolveCandidateIssueUrl({ repo: normalizedRepo, issueNumber: existing.number, issueUrl: existing.url }),
          status: "reused",
        });
        continue;
      }

      if (existingState.managedBlockEdited) {
        const commentBody = [
          "Daily Lens rerun detected updated generated fields for this candidate,",
          "but the managed generated block was manually edited.",
          "",
          `- Action id: ${action.id}`,
          `- Report: #${normalizedReportIssueNumber}`,
          `- Report run id: ${asString(runId) || "n/a"}`,
          "",
          "Skipping automatic overwrite to preserve operator edits. Please reconcile manually.",
        ].join("\n");

        const commented = runtime.commentIssue({
          repo: normalizedRepo,
          issueNumber: parsePositiveInt(existing.number),
          body: commentBody,
        });
        if (!commented?.ok) {
          throw new Error(`lens_followup_candidates_reconciliation_comment_failed: action_id=${action.id} issue_number=${existing.number}`);
        }

        candidates.push({
          action_id: action.id,
          issue_number: parsePositiveInt(existing.number),
          issue_url: resolveCandidateIssueUrl({ repo: normalizedRepo, issueNumber: existing.number, issueUrl: existing.url }),
          status: "reconciled",
        });
        continue;
      }

      const issueUrl = resolveCandidateIssueUrl({
        repo: normalizedRepo,
        issueNumber: existing.number,
        issueUrl: existing.url,
      });
      const issueSpecRaw = JSON.stringify({
        ...rendered.issueSpec,
        issue_body: mergeIssueBody({
          existingBody: existing.body || "",
          generatedBlock: rendered.generatedBlock,
          metadata: rendered.metadata,
        }),
      });

      const updated = runtime.updateIssue({
        repo: normalizedRepo,
        issueUrl,
        issueSpecRaw,
      });
      if (!updated?.ok) {
        throw new Error(`lens_followup_candidates_issue_update_failed: action_id=${action.id} issue_url=${issueUrl} error=${asString(updated?.error || updated?.stderr || updated?.status) || "unknown"}`);
      }

      candidates.push({
        action_id: action.id,
        issue_number: parsePositiveInt(existing.number),
        issue_url: issueUrl,
        status: "updated",
      });
      continue;
    }

    const created = runtime.createIssue({
      repo: normalizedRepo,
      issueSpecRaw: JSON.stringify(rendered.issueSpec),
    });
    if (!created?.ok) {
      throw new Error(`lens_followup_candidates_issue_create_failed: action_id=${action.id} error=${asString(created?.error || created?.stderr || created?.status) || "unknown"}`);
    }

    const createdIssueNumber = parsePositiveInt(created?.created_issue_number) || parseIssueNumberFromUrl(created?.issue_url);
    const createdIssueUrl = resolveCandidateIssueUrl({
      repo: normalizedRepo,
      issueNumber: createdIssueNumber,
      issueUrl: created?.issue_url,
    });

    if (createdIssueNumber <= 0 || !createdIssueUrl) {
      throw new Error(`lens_followup_candidates_issue_identity_failed: action_id=${action.id}`);
    }

    const linked = runtime.addSubIssue({
      repo: normalizedRepo,
      parentNumber: normalizedReportIssueNumber,
      childNumber: createdIssueNumber,
    });
    if (!linked?.ok) {
      throw new Error(`lens_followup_candidates_sub_issue_link_failed: action_id=${action.id} parent=${normalizedReportIssueNumber} child=${createdIssueNumber} error=${asString(linked?.error) || "unknown"}`);
    }

    candidates.push({
      action_id: action.id,
      issue_number: createdIssueNumber,
      issue_url: createdIssueUrl,
      status: "created",
    });
  }

  const createdCount = candidates.filter((entry) => entry.status === "created").length;
  const updatedCount = candidates.filter((entry) => entry.status === "updated").length;
  const reusedCount = candidates.filter((entry) => entry.status === "reused").length;
  const reconciledCount = candidates.filter((entry) => entry.status === "reconciled").length;

  const report = updateParentReportIssue({
    runtime,
    repo: normalizedRepo,
    reportIssueNumber: normalizedReportIssueNumber,
    reportRunId: runId,
    publicationSha,
    factoryId,
    registrySha,
    actionCount: actions.length,
    createdCount,
    updatedCount,
    reusedCount,
    reconciledCount,
  });

  const learningLogUpdates = buildLearningLogStatusUpdates({
    actions,
    candidates,
    reportIssueNumber: normalizedReportIssueNumber,
    reportIssueUrl: report?.issue_url,
    reportRunId: runId,
    publicationSha,
    registrySha,
  });
  const learningLogStatus = await runtime.applySuggestionStatusUpdates({
    logPath: learningLogPath,
    updates: learningLogUpdates,
  });

  return {
    ok: true,
    repo: normalizedRepo,
    report_issue_number: normalizedReportIssueNumber,
    run_id: asString(runId),
    publication_sha: asString(publicationSha),
    factory_id: asString(factoryId),
    action_count: actions.length,
    created_count: createdCount,
    updated_count: updatedCount,
    reused_count: reusedCount,
    reconciled_count: reconciledCount,
    registry_sha: registrySha,
    report,
    learning_log_status: learningLogStatus,
    candidates,
  };
}

export class AnalysisLensFollowupCandidatesCommand extends Command {
  static paths = [["analysis", "lens-followup-candidates"]];

  repo = Option.String("--repo", "");
  reportIssueNumber = Option.String("--report-issue-number", "");
  analysisPath = Option.String("--analysis-path", "");
  lensPayload = Option.String("--lens-payload", "");
  runId = Option.String("--run-id", "");
  publicationSha = Option.String("--publication-sha", "");
  factoryId = Option.String("--factory-id", "mothership");
  learningLogPath = Option.String("--learning-log-path", DEFAULT_LEARNING_LOG_JSON_PATH);

  async execute() {
    try {
      const result = await runAnalysisLensFollowupCandidates({
        repo: this.repo,
        reportIssueNumber: this.reportIssueNumber,
        analysisPath: this.analysisPath,
        lensPayloadRaw: this.lensPayload,
        runId: this.runId,
        publicationSha: this.publicationSha,
        factoryId: this.factoryId,
        learningLogPath: this.learningLogPath,
      });
      this.context.stdout.write(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      if (String(error?.message || "").startsWith("missing_")) return 2;
      return 1;
    }
  }
}
