import { addSubIssue } from "../../commands/goal-sub-issues.ts";
import { gh, ghJson, trim } from "../cli-helpers.ts";

const REQUIRED_CANDIDATE_LABELS = ["daily-lens", "daily-lens-candidate"];
const DEFAULT_EXECUTION_OWNER = "supervisor_on_main";

export const ACTION_REGISTRY_REQUIRED_FIELDS = Object.freeze([
  "id",
  "type",
  "title",
  "why_now",
  "success_metric",
  "evidence_links",
  "dependency_hints",
]);

function asString(value) {
  return String(value ?? "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseIssueNumberFromUrl(url = "") {
  const match = asString(url).match(/\/(\d+)\/?$/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function firstDefined(values = []) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizeEvidenceLink(entry) {
  if (entry === null || entry === undefined) return "";
  if (typeof entry === "string") return asString(entry);
  if (typeof entry !== "object") return "";
  return asString(entry.ref || entry.url || entry.id || entry.link || JSON.stringify(entry));
}

function normalizeDependencyHint(entry) {
  if (entry === null || entry === undefined) return "";
  if (typeof entry === "string") return asString(entry);
  if (typeof entry !== "object") return "";
  return asString(entry.hint || entry.depends_on || entry.id || entry.link || JSON.stringify(entry));
}

function assertRequiredString({ value = "", field = "", index = 0 } = {}) {
  if (asString(value)) return asString(value);
  throw new Error(`lens_candidates_invalid_action_registry_entry: index=${index} reason=missing_field field=${field}`);
}

function assertRequiredArray({ value, field = "", index = 0 } = {}) {
  if (value === undefined) {
    throw new Error(`lens_candidates_invalid_action_registry_entry: index=${index} reason=missing_field field=${field}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`lens_candidates_invalid_action_registry_entry: index=${index} reason=invalid_field_type field=${field} expected=array`);
  }
  return value;
}

export function validateLensActionRegistryEntry(entry = {}, { index = 0 } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`lens_candidates_invalid_action_registry_entry: index=${index} reason=expected_object`);
  }

  const id = assertRequiredString({
    value: entry.id || entry.action_id || entry.actionId,
    field: "id",
    index,
  });
  const type = assertRequiredString({
    value: entry.type || entry.candidate_type || entry.candidate_work_item_type,
    field: "type",
    index,
  });
  const title = assertRequiredString({
    value: entry.title || entry.summary,
    field: "title",
    index,
  });
  const whyNow = assertRequiredString({
    value: entry.why_now || entry.whyNow,
    field: "why_now",
    index,
  });
  const successMetric = assertRequiredString({
    value: entry.success_metric || entry.successMetric,
    field: "success_metric",
    index,
  });

  const rawEvidenceLinks = assertRequiredArray({
    value: firstDefined([
      entry.evidence_links,
      entry.evidenceLinks,
      entry.evidence_refs,
      entry.evidenceRefs,
    ]),
    field: "evidence_links",
    index,
  });

  const rawDependencyHints = assertRequiredArray({
    value: firstDefined([
      entry.dependency_hints,
      entry.dependencyHints,
    ]),
    field: "dependency_hints",
    index,
  });

  return {
    id,
    type,
    title,
    summary: asString(entry.summary || title),
    why_now: whyNow,
    success_metric: successMetric,
    evidence_links: rawEvidenceLinks.map(normalizeEvidenceLink).filter(Boolean),
    dependency_hints: rawDependencyHints.map(normalizeDependencyHint).filter(Boolean),
    recommendation: asString(entry.recommendation || entry.action),
    implementation_hints: asString(entry.implementation_hints || entry.implementationHints || entry.detail),
    elevation: asString(entry.elevation),
    execution_owner: asString(entry.execution_owner || entry.executionOwner || DEFAULT_EXECUTION_OWNER),
  };
}

export function isLensActionRegistryEntry(entry = {}) {
  try {
    validateLensActionRegistryEntry(entry);
    return true;
  } catch {
    return false;
  }
}

function normalizeLegacySuggestionEntry(suggestion = {}, index = 0) {
  const suggestionId = asString(suggestion?.id || suggestion?.action_id || suggestion?.actionId);
  if (!suggestionId) {
    return {
      descriptor: null,
      skipped: {
        index,
        reason: "missing_id",
      },
    };
  }

  const summary = asString(suggestion?.summary || suggestion?.title || suggestion?.description);
  if (!summary) {
    return {
      descriptor: null,
      skipped: {
        index,
        suggestion_id: suggestionId,
        reason: "missing_summary",
      },
    };
  }

  const whyNow = asString(suggestion?.why_now || suggestion?.whyNow || suggestion?.impact_notes || suggestion?.impactNotes || suggestion?.detail || summary);
  const successMetric = asString(suggestion?.success_metric || suggestion?.successMetric)
    || "Candidate issue reaches merged or closed state with evidence-backed completion notes.";

  return {
    descriptor: {
      id: suggestionId,
      type: asString(suggestion?.type || "task"),
      title: asString(suggestion?.title || summary),
      summary,
      why_now: whyNow,
      success_metric: successMetric,
      evidence_links: asArray(suggestion?.evidence_refs)
        .length > 0
        ? asArray(suggestion?.evidence_refs).map(normalizeEvidenceLink).filter(Boolean)
        : asArray(suggestion?.evidence).map(normalizeEvidenceLink).filter(Boolean),
      dependency_hints: asArray(suggestion?.dependency_hints || suggestion?.dependencyHints)
        .map(normalizeDependencyHint)
        .filter(Boolean),
      recommendation: asString(suggestion?.recommendation),
      implementation_hints: asString(suggestion?.implementation_hints || suggestion?.implementationHints || suggestion?.impact_notes || suggestion?.detail),
      elevation: asString(suggestion?.elevation),
      execution_owner: asString(suggestion?.execution_owner || suggestion?.executionOwner || DEFAULT_EXECUTION_OWNER),
    },
    skipped: null,
  };
}

export function resolveLensCandidateDescriptors(lensJson = {}, { strict = false } = {}) {
  if (Array.isArray(lensJson?.action_registry)) {
    return {
      source: "action_registry",
      descriptors: lensJson.action_registry.map((entry, index) => validateLensActionRegistryEntry(entry, { index })),
      skipped: [],
    };
  }

  if (!Array.isArray(lensJson?.suggestions)) {
    if (strict) {
      throw new Error("lens_candidates_missing_entries: expected action_registry or suggestions array");
    }
    return {
      source: "none",
      descriptors: [],
      skipped: [],
    };
  }

  const descriptors = [];
  const skipped = [];

  for (const [index, suggestion] of lensJson.suggestions.entries()) {
    const normalized = normalizeLegacySuggestionEntry(suggestion, index);
    if (normalized.descriptor) {
      descriptors.push(normalized.descriptor);
    }
    if (normalized.skipped) {
      skipped.push(normalized.skipped);
    }
  }

  return {
    source: "suggestions",
    descriptors,
    skipped,
  };
}

function screenCandidateDescriptor(descriptor = {}) {
  const recommendation = asString(descriptor?.recommendation || descriptor?.summary || descriptor?.title).toLowerCase();
  const whyNow = asString(descriptor?.why_now).toLowerCase();
  if (asArray(descriptor?.evidence_links).length === 0) return { ok: false, reason: "missing_evidence" };
  if (/^(investigate|look into|figure out|check|verify|explore|review)\b/.test(recommendation)) {
    return { ok: false, reason: "vague_recommendation" };
  }
  if (/\b(close stale|clean up|housekeeping|operator reminder|schedule review)\b/.test(`${recommendation} ${whyNow}`)) {
    return { ok: false, reason: "housekeeping" };
  }
  return { ok: true, reason: "" };
}

function resolveLensRunId({ lensJson = {}, reportDate = "" } = {}) {
  const runId = asString(lensJson?.meta?.run_id || lensJson?.meta?.report_run_id);
  if (runId) return runId;
  return `${asString(reportDate) || "unknown-date"} manual`;
}

function renderEvidenceArray(evidence) {
  const arrayValue = Array.isArray(evidence)
    ? evidence
    : (evidence == null ? [] : [evidence]);
  return JSON.stringify(arrayValue, null, 2);
}

function resolveCandidateLabels() {
  return [...REQUIRED_CANDIDATE_LABELS];
}

function buildCandidateTitle({ reportDate = "", suggestionId = "", actionTitle = "" } = {}) {
  const title = asString(actionTitle);
  if (title) {
    const capped = title.length > 200 ? `${title.slice(0, 200)}…` : title;
    return capped;
  }
  return `Daily Lens Candidate — ${asString(reportDate)} — ${asString(suggestionId)}`;
}

function buildCandidateBody({
  reportIssueNumber = 0,
  reportDate = "",
  suggestionId = "",
  title = "",
  type = "",
  summary = "",
  whyNow = "",
  successMetric = "",
  recommendation = "",
  dependencyHints = [],
  evidence = [],
  lensRunId = "",
  candidateSource = "",
  executionOwner = DEFAULT_EXECUTION_OWNER,
} = {}) {
  const metadata = {
    origin_report_number: Number(reportIssueNumber),
    origin_report_date: asString(reportDate),
    lens_suggestion_id: asString(suggestionId),
    lens_run_id: asString(lensRunId),
    action_type: asString(type || "task"),
    candidate_source: asString(candidateSource || "suggestions"),
    execution_owner: asString(executionOwner || DEFAULT_EXECUTION_OWNER),
  };

  const dependencySection = asArray(dependencyHints).length > 0
    ? [
      "\n## Dependency hints",
      ...asArray(dependencyHints).map((hint) => `- ${asString(hint)}`),
    ].join("\n")
    : "";

  return [
    "## Action title",
    asString(title || summary),
    "\n## Recommendation summary",
    asString(summary),
    "\n## Why now",
    asString(whyNow) || "Not provided.",
    "\n## Success metric",
    asString(successMetric) || "Not provided.",
    recommendation ? `\n## Recommendation detail\n${asString(recommendation)}` : "",
    `\n## Execution owner\n${asString(executionOwner || DEFAULT_EXECUTION_OWNER)}`,
    dependencySection,
    "\n## Evidence (quoted from Daily Lens output)",
    "```json",
    renderEvidenceArray(evidence),
    "```",
    "\n## Candidate metadata",
    "```json",
    JSON.stringify(metadata, null, 2),
    "```",
    "\n> Operator note: This is candidate follow-up work pending human report promotion. Do not add `goal` or `ready` labels until the parent Daily Lens report is reviewed.",
  ].filter(Boolean).join("\n");
}

function findExistingIssueByTitle({
  repo = "",
  title = "",
  suggestionId = "",
  ghJsonFn = ghJson,
} = {}) {
  const searchTerm = asString(suggestionId || title);
  const issues = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    searchTerm,
    "--json",
    "number,title,state,url",
  ], []);

  const exactMatches = asArray(issues)
    .filter((issue) => {
      const issueTitle = asString(issue?.title);
      if (issueTitle === asString(title)) return true;
      return Boolean(searchTerm && issueTitle.includes(searchTerm));
    });
  if (exactMatches.length === 0) return null;

  const byNumberDesc = (a, b) => Number(b?.number || 0) - Number(a?.number || 0);

  const open = exactMatches
    .filter((issue) => asString(issue?.state).toUpperCase() === "OPEN")
    .sort(byNumberDesc)[0];
  if (open) return open;

  return exactMatches.sort(byNumberDesc)[0] || null;
}

function runGhCommandOrThrow({ ghFn = gh, args = [], errorCode = "gh_command_failed" } = {}) {
  const result = ghFn(args);
  if (!result?.ok) {
    throw new Error(`${errorCode}: ${trim(result?.stderr || result?.stdout || errorCode)}`);
  }
  return result;
}

function ensureIssueIsOpen({ repo = "", issueNumber = 0, ghFn = gh } = {}) {
  const normalizedIssueNumber = toPositiveInt(issueNumber);
  if (normalizedIssueNumber <= 0) return false;

  runGhCommandOrThrow({
    ghFn,
    args: ["issue", "reopen", String(normalizedIssueNumber), "--repo", repo],
    errorCode: "candidate_issue_reopen_failed",
  });
  return true;
}

function fetchIssueForUpdate({ repo = "", issueNumber = 0, ghJsonFn = ghJson } = {}) {
  const normalizedIssueNumber = toPositiveInt(issueNumber);
  if (normalizedIssueNumber <= 0) return {};
  return ghJsonFn([
    "issue",
    "view",
    String(normalizedIssueNumber),
    "--repo",
    repo,
    "--json",
    "number,url,title,state,body,labels",
  ], {});
}

function ensureLabels({ issue = {}, requiredLabels = [] } = {}) {
  const existingLabels = new Set(
    asArray(issue?.labels)
      .map((label) => asString(label?.name || label))
      .filter(Boolean),
  );
  return requiredLabels.every((label) => existingLabels.has(label));
}

function createCandidateIssue({ repo = "", title = "", body = "", labels = [], ghFn = gh } = {}) {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body,
  ];
  for (const label of labels) {
    args.push("--label", label);
  }

  const result = runGhCommandOrThrow({ ghFn, args, errorCode: "candidate_issue_create_failed" });
  const issueUrl = trim(result.stdout);
  const issueNumber = parseIssueNumberFromUrl(issueUrl);
  if (!issueUrl || issueNumber <= 0) {
    throw new Error("candidate_issue_create_failed: unable_to_resolve_issue_identity");
  }
  return { issue_number: issueNumber, issue_url: issueUrl };
}

function updateCandidateIssue({
  repo = "",
  issueNumber = 0,
  title = "",
  body = "",
  labels = [],
  ghFn = gh,
} = {}) {
  const normalizedIssueNumber = toPositiveInt(issueNumber);
  if (normalizedIssueNumber <= 0) {
    throw new Error("candidate_issue_update_failed: invalid_issue_number");
  }

  const args = [
    "issue",
    "edit",
    String(normalizedIssueNumber),
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body,
  ];
  for (const label of labels) {
    args.push("--add-label", label);
  }

  runGhCommandOrThrow({ ghFn, args, errorCode: "candidate_issue_update_failed" });
}

function linkCandidateToReport({
  repo = "",
  reportIssueNumber = 0,
  candidateIssueNumber = 0,
  addSubIssueFn = addSubIssue,
} = {}) {
  const linked = addSubIssueFn({
    repo,
    parentNumber: reportIssueNumber,
    childNumber: candidateIssueNumber,
  });

  if (linked?.ok) return "linked";

  const errorText = asString(linked?.error || linked?.stderr || linked?.stdout);
  if (/already|exists|unprocessable|422/i.test(errorText)) {
    return "already_linked";
  }

  throw new Error(
    `candidate_sub_issue_link_failed: parent=${reportIssueNumber} child=${candidateIssueNumber} error=${errorText || "unknown"}`,
  );
}

function resolveIssueUrl({ repo = "", issueNumber = 0, issueUrl = "" } = {}) {
  const normalizedIssueUrl = asString(issueUrl);
  if (normalizedIssueUrl) return normalizedIssueUrl;

  const normalizedRepo = asString(repo);
  const normalizedIssueNumber = toPositiveInt(issueNumber);
  if (!normalizedRepo || normalizedIssueNumber <= 0) return "";
  return `https://github.com/${normalizedRepo}/issues/${normalizedIssueNumber}`;
}

export function prepareLensCandidateEntries(lensJson = {}) {
  const reportDate = asString(lensJson?.date || lensJson?.report_date);
  const lensRunId = resolveLensRunId({ lensJson, reportDate });
  let normalized;
  try {
    normalized = resolveLensCandidateDescriptors(lensJson);
  } catch (error) {
    return {
      report_date: reportDate,
      lens_run_id: lensRunId,
      source: "error",
      entries: [],
      skipped: [{
        index: 0,
        reason: asString(error?.message || error) || "invalid_action_registry",
      }],
    };
  }

  const entries = [];
  const skipped = [...normalized.skipped];

  for (const [index, descriptor] of normalized.descriptors.entries()) {
    const screen = screenCandidateDescriptor(descriptor);
    if (!screen.ok) {
      skipped.push({
        index,
        suggestion_id: descriptor.id,
        reason: screen.reason,
      });
      continue;
    }
    entries.push({
      index,
      suggestion_id: descriptor.id,
      type: descriptor.type,
      title: descriptor.title,
      summary: descriptor.summary,
      why_now: descriptor.why_now,
      success_metric: descriptor.success_metric,
      recommendation: descriptor.recommendation,
      dependency_hints: descriptor.dependency_hints,
      evidence: descriptor.evidence_links,
      candidate_source: normalized.source,
      execution_owner: descriptor.execution_owner || DEFAULT_EXECUTION_OWNER,
    });
  }

  return {
    report_date: reportDate,
    lens_run_id: lensRunId,
    source: normalized.source,
    entries,
    skipped,
  };
}

export function publishLensCandidates({
  repo = "",
  reportIssueNumber = 0,
  reportDate = "",
  lensJson = {},
  ghFn = gh,
  ghJsonFn = ghJson,
  addSubIssueFn = addSubIssue,
} = {}) {
  const normalizedRepo = asString(repo);
  const normalizedReportIssueNumber = toPositiveInt(reportIssueNumber);
  const normalizedReportDate = asString(reportDate || lensJson?.date || lensJson?.report_date);

  if (!normalizedRepo) throw new Error("missing_repo: --repo is required");
  if (normalizedReportIssueNumber <= 0) {
    throw new Error("missing_report_issue_number: report issue number is required");
  }
  if (!normalizedReportDate) {
    throw new Error("missing_report_date: report date is required");
  }

  const prepared = prepareLensCandidateEntries({
    ...lensJson,
    date: normalizedReportDate,
  });

  const lensRunId = asString(prepared.lens_run_id || `${normalizedReportDate} manual`);
  const result = {
    created: [],
    updated: [],
    skipped: [...prepared.skipped],
  };

  for (const entry of prepared.entries) {
    const title = buildCandidateTitle({
      reportDate: normalizedReportDate,
      suggestionId: entry.suggestion_id,
      actionTitle: entry.title || entry.summary,
    });
    const labels = resolveCandidateLabels();
    const body = buildCandidateBody({
      reportIssueNumber: normalizedReportIssueNumber,
      reportDate: normalizedReportDate,
      suggestionId: entry.suggestion_id,
      title: entry.title,
      type: entry.type,
      summary: entry.summary,
      whyNow: entry.why_now,
      successMetric: entry.success_metric,
      recommendation: entry.recommendation,
      dependencyHints: entry.dependency_hints,
      evidence: entry.evidence,
      lensRunId,
      candidateSource: entry.candidate_source,
      executionOwner: entry.execution_owner,
    });

    const existing = findExistingIssueByTitle({
      repo: normalizedRepo,
      title,
      suggestionId: entry.suggestion_id,
      ghJsonFn,
    });

    if (!existing) {
      const created = createCandidateIssue({
        repo: normalizedRepo,
        title,
        body,
        labels,
        ghFn,
      });

      const linkStatus = linkCandidateToReport({
        repo: normalizedRepo,
        reportIssueNumber: normalizedReportIssueNumber,
        candidateIssueNumber: created.issue_number,
        addSubIssueFn,
      });

      result.created.push({
        suggestion_id: entry.suggestion_id,
        issue_number: created.issue_number,
        issue_url: created.issue_url,
        link_status: linkStatus,
      });
      continue;
    }

    const existingNumber = toPositiveInt(existing?.number);
    const existingIssue = fetchIssueForUpdate({
      repo: normalizedRepo,
      issueNumber: existingNumber,
      ghJsonFn,
    });

    const existingState = asString(existingIssue?.state || existing?.state).toUpperCase();
    const wasClosed = existingState === "CLOSED";
    if (wasClosed) {
      ensureIssueIsOpen({
        repo: normalizedRepo,
        issueNumber: existingNumber,
        ghFn,
      });
    }

    const missingLabels = !ensureLabels({
      issue: existingIssue,
      requiredLabels: labels,
    });
    const bodyChanged = asString(existingIssue?.body) !== asString(body);
    const needsUpdate = wasClosed || missingLabels || bodyChanged;

    if (needsUpdate) {
      updateCandidateIssue({
        repo: normalizedRepo,
        issueNumber: existingNumber,
        title,
        body,
        labels,
        ghFn,
      });

      const linkStatus = linkCandidateToReport({
        repo: normalizedRepo,
        reportIssueNumber: normalizedReportIssueNumber,
        candidateIssueNumber: existingNumber,
        addSubIssueFn,
      });

      result.updated.push({
        suggestion_id: entry.suggestion_id,
        issue_number: existingNumber,
        issue_url: resolveIssueUrl({
          repo: normalizedRepo,
          issueNumber: existingNumber,
          issueUrl: existingIssue?.url || existing?.url,
        }),
        link_status: linkStatus,
      });
      continue;
    }

    const linkStatus = linkCandidateToReport({
      repo: normalizedRepo,
      reportIssueNumber: normalizedReportIssueNumber,
      candidateIssueNumber: existingNumber,
      addSubIssueFn,
    });

    result.skipped.push({
      index: entry.index,
      suggestion_id: entry.suggestion_id,
      issue_number: existingNumber,
      reason: "unchanged",
      link_status: linkStatus,
    });
  }

  return result;
}
