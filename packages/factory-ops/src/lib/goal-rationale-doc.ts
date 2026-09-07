import { trim, parseJson } from "./cli-helpers.ts";

export const RATIONALE_DOC_SECTION_HEADINGS = Object.freeze([
  "What Changed",
  "Why Now",
  "Subsystem Map",
  "Assumptions",
  "Known Unknowns",
  "What Future Humans Need To Know",
  "Verification",
  "Follow-ups",
]);

export const RATIONALE_DOC_BANNED_PHRASES = Object.freeze([
  "various",
  "several",
  "misc",
  "tbd",
  "as needed",
]);

export const UNDERSTANDING_RISK_VALUES = Object.freeze([
  "low",
  "medium",
  "high",
  "unknown",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBooleanString(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "true") return "true";
  if (normalized === "false") return "false";
  return "";
}

export function normalizeUnderstandingRisk(value = "") {
  const normalized = trim(value).toLowerCase();
  return UNDERSTANDING_RISK_VALUES.includes(normalized) ? normalized : "";
}

function parseSignals({ classificationSignalsRaw = "", classificationSignals = null } = {}) {
  if (classificationSignals && typeof classificationSignals === "object" && !Array.isArray(classificationSignals)) {
    return classificationSignals;
  }
  const parsed = parseJson(trim(classificationSignalsRaw), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export function deriveRationaleRequirement({
  executionPath = "",
  understandingRisk = "",
  rationaleRequired = "",
  classificationSignalsRaw = "",
  classificationSignals = null,
} = {}) {
  const signals = parseSignals({ classificationSignalsRaw, classificationSignals });
  const explicitRisk = normalizeUnderstandingRisk(understandingRisk);
  const signalRisk = normalizeUnderstandingRisk(
    signals.understanding_risk || signals.understandingRisk || "",
  );
  const normalizedExecutionPath = trim(executionPath).toLowerCase();
  const explicitRequired = normalizeBooleanString(rationaleRequired);
  const signalRequired = normalizeBooleanString(
    String(signals.rationale_required ?? signals.rationaleRequired ?? ""),
  );

  const resolvedRisk = explicitRisk
    || signalRisk
    || (normalizedExecutionPath === "hard" ? "high" : "unknown");

  const resolvedRequired = explicitRequired
    || signalRequired
    || (resolvedRisk === "high" ? "true" : "")
    || (normalizedExecutionPath === "hard" ? "true" : "false");

  return {
    understanding_risk: resolvedRisk || "unknown",
    rationale_required: resolvedRequired === "true",
  };
}

function slugify(value = "") {
  const normalized = trim(value).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "goal";
}

function normalizeApprovedFeatures(raw = "[]") {
  const parsed = parseJson(trim(raw), []);
  return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

function hasRationaleFeature(features = []) {
  return features.some((entry) => trim(entry?.work_item_kind || entry?.kind).toLowerCase() === "rationale_doc");
}

export function buildRationaleFeature({
  goalIssue = {},
  understandingRisk = "high",
} = {}) {
  const goalNumber = trim(goalIssue?.number);
  const goalTitle = trim(goalIssue?.title) || `Goal ${goalNumber || ""}`.trim() || "Goal";
  const slug = slugify(goalTitle.replace(/^goal:\s*/i, ""));
  const featureId = `rationale-doc-${goalNumber || slug}`;
  const filePathHint = `docs/rationale/YYYY-MM-DD-${slug}.md`;

  return {
    feature_id: featureId,
    work_item_kind: "rationale_doc",
    title: `Write rationale doc for ${goalTitle}`,
    summary: `Capture the implementation rationale and teach-back for ${goalTitle} in ${filePathHint}.`,
    scope: [
      "In scope: one rationale doc for the shipped goal, grounded in the actual code and tests that landed.",
      "Out of scope: extra roadmap prose, product marketing, or re-planning the goal.",
    ].join(" "),
    domain: "docs",
    acceptance_criteria: [
      `Add exactly one rationale doc under ${filePathHint}.`,
      `Use these top-level sections exactly: ${RATIONALE_DOC_SECTION_HEADINGS.join(", ")}.`,
      "Explain the real subsystem/file/test boundaries touched by the goal using concrete paths or symbols.",
      "State assumptions and known unknowns explicitly instead of hand-waving future work.",
      "Include a short teach-back in 'What Future Humans Need To Know' that a maintainer can read quickly.",
      "The doc passes rationale doc lint and docs:check.",
    ],
    rationale_doc: {
      path_pattern: "docs/rationale/YYYY-MM-DD-<goal-slug>.md",
      suggested_slug: slug,
      goal_issue_number: goalNumber,
      understanding_risk: understandingRisk,
    },
  };
}

export function appendRationaleFeature({
  approvedFeaturesRaw = "[]",
  goalIssueRaw = "{}",
  understandingRisk = "",
  rationaleRequired = "",
  executionPath = "",
  classificationSignalsRaw = "",
  classificationSignals = null,
} = {}) {
  const features = normalizeApprovedFeatures(approvedFeaturesRaw);
  const goalIssue = asObject(parseJson(trim(goalIssueRaw), {}));
  const derived = deriveRationaleRequirement({
    executionPath,
    understandingRisk,
    rationaleRequired,
    classificationSignalsRaw,
    classificationSignals,
  });

  if (!derived.rationale_required) {
    return {
      approved_features: JSON.stringify(features),
      rationale_feature_added: "false",
      understanding_risk: derived.understanding_risk,
      rationale_required: "false",
    };
  }

  if (hasRationaleFeature(features)) {
    return {
      approved_features: JSON.stringify(features),
      rationale_feature_added: "false",
      understanding_risk: derived.understanding_risk,
      rationale_required: "true",
    };
  }

  const out = [...features, buildRationaleFeature({
    goalIssue,
    understandingRisk: derived.understanding_risk,
  })];

  return {
    approved_features: JSON.stringify(out),
    rationale_feature_added: "true",
    understanding_risk: derived.understanding_risk,
    rationale_required: "true",
  };
}

export function normalizeRationaleDocStructure(markdown = "") {
  const text = String(markdown || "");
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => trim(match[1]));
  return {
    headings,
    missing_headings: RATIONALE_DOC_SECTION_HEADINGS.filter((heading) => !headings.includes(heading)),
    banned_phrases: RATIONALE_DOC_BANNED_PHRASES.filter((phrase) => text.toLowerCase().includes(phrase)),
    has_concrete_ref: /[`[]?[A-Za-z0-9_./-]+\.(?:mjs|ts|tsx|js|json|dot|md)|#[A-Za-z0-9_]+/.test(text),
  };
}
