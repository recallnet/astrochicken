import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ghJson, trim } from "../lib/cli-helpers.ts";

const UI_REFINEMENT_REQUIRED_FIELDS = [
  "visual_risk_class",
  "hotspot_files",
  "scope_limit_minutes",
  "refinement_strategy",
  "scenario_sources",
];

function parseJsonObject(pathValue = "") {
  const normalized = trim(pathValue);
  if (!normalized) return {};
  if (!existsSync(normalized)) return {};

  try {
    const parsed = JSON.parse(readFileSync(normalized, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
      if (Array.isArray(entry.items)) {
        queue.unshift(...entry.items);
        continue;
      }
      if (Array.isArray(entry.bullets)) {
        queue.unshift(...entry.bullets);
        continue;
      }
      const serialized = trim(JSON.stringify(entry));
      if (serialized) out.push(serialized);
      continue;
    }

    const normalized = trim(entry);
    if (!normalized) continue;

    for (const line of normalized.split(/\r?\n/g)) {
      const stripped = trim(String(line).replace(/^[-*•]\s+/, ""));
      if (stripped) out.push(stripped);
    }
  }

  return [...new Set(out)];
}

function parseIssueFromRepo({ repo = "", issueNumber = "" } = {}) {
  const normalizedIssue = trim(issueNumber);
  const normalizedRepo = trim(repo);
  if (!normalizedIssue || !normalizedRepo) return { body: "", title: "" };

  try {
    const out = ghJson(["issue", "view", normalizedIssue, "--repo", normalizedRepo, "--json", "title,body"], {});
    return {
      title: trim(out?.title),
      body: trim(out?.body),
    };
  } catch {
    return { body: "", title: "" };
  }
}

function parseListLikeMetadata(rawValue = "") {
  const value = trim(rawValue);
  if (!value) return [];

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeTextList(parsed);
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return normalizeTextList(value.split(/[;,|]/g));
}

function extractUiRefinementMetadataFromText(text = "") {
  const normalizedText = String(text || "");
  if (!trim(normalizedText)) {
    return {
      visual_risk_class: "",
      hotspot_files: [],
      scope_limit_minutes: "",
      refinement_strategy: "",
      scenario_sources: [],
    };
  }

  const aliases = {
    visual_risk_class: ["visual_risk_class", "visualRiskClass"],
    hotspot_files: ["hotspot_files", "hotspotFiles"],
    scope_limit_minutes: ["scope_limit_minutes", "scopeLimitMinutes"],
    refinement_strategy: ["refinement_strategy", "refinementStrategy"],
    scenario_sources: ["scenario_sources", "scenarioSources"],
  };

  const readLastMatch = (keys = []) => {
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?:^|\\n)\\s*[-*•]?\\s*${escaped}\\s*[:=]\\s*([^\\n\\r]+)`, "ig");
      let match;
      let value = "";
      while ((match = pattern.exec(normalizedText)) !== null) {
        value = trim(match[1]);
      }
      if (value) return value;
    }
    return "";
  };

  return {
    visual_risk_class: readLastMatch(aliases.visual_risk_class),
    hotspot_files: parseListLikeMetadata(readLastMatch(aliases.hotspot_files)),
    scope_limit_minutes: readLastMatch(aliases.scope_limit_minutes),
    refinement_strategy: readLastMatch(aliases.refinement_strategy),
    scenario_sources: parseListLikeMetadata(readLastMatch(aliases.scenario_sources)),
  };
}

function parseEvidenceFlags(evidence = {}, metadataText = "") {
  const issues = [];
  const textMetadata = extractUiRefinementMetadataFromText(metadataText);

  const visualRiskClass = trim(evidence?.visual_risk_class || evidence?.visualRiskClass || textMetadata.visual_risk_class);
  const hotspotFilesFromEvidence = normalizeTextList(evidence?.hotspot_files ?? evidence?.hotspotFiles);
  const hotspotFiles = hotspotFilesFromEvidence.length > 0
    ? hotspotFilesFromEvidence
    : normalizeTextList(textMetadata.hotspot_files);

  const scopeLimitFromEvidence = Number(trim(evidence?.scope_limit_minutes || evidence?.scopeLimitMinutes));
  const scopeLimitFromText = Number(trim(textMetadata.scope_limit_minutes).replace(/[^0-9.]+/g, ""));
  const scopeLimit = Number.isFinite(scopeLimitFromEvidence) && scopeLimitFromEvidence > 0
    ? scopeLimitFromEvidence
    : scopeLimitFromText;

  const refinementStrategy = trim(evidence?.refinement_strategy || evidence?.refinementStrategy || textMetadata.refinement_strategy);
  const scenarioSourcesFromEvidence = normalizeTextList(evidence?.scenario_sources ?? evidence?.scenarioSources);
  const scenarioSources = scenarioSourcesFromEvidence.length > 0
    ? scenarioSourcesFromEvidence
    : normalizeTextList(textMetadata.scenario_sources);

  if (!visualRiskClass) issues.push("visual_risk_class");
  if (hotspotFiles.length === 0) issues.push("hotspot_files");
  if (!Number.isFinite(scopeLimit) || scopeLimit <= 0) issues.push("scope_limit_minutes");
  if (!refinementStrategy) issues.push("refinement_strategy");
  if (scenarioSources.length === 0) issues.push("scenario_sources");

  return {
    issues,
    visualRiskClass,
    hotspotFiles,
    scopeLimit,
    refinementStrategy,
    scenarioSources,
  };
}

function hasUiRefinementSignal({ reviewContext = {}, reviewEvidence = {}, issueTitle = "", issueBody = "" } = {}) {
  const contextSignal = normalizeTextList([
    reviewContext?.issue_excerpt,
    reviewContext?.builder_notes,
    issueTitle,
    issueBody,
    reviewEvidence?.review_evidence_note,
    reviewEvidence?.builder_notes,
  ]).join("\n").toLowerCase();

  // Compound signals that strongly indicate actual UI/visual work.
  // Single-word matches like bare "ui", "interaction", or "design" produce
  // false positives on backend issues that mention these words in exclusion
  // clauses (e.g. "No UI surface", "No interaction with transport layer").
  const compoundSignalPattern = /ui[- ]refine|visual[- ]refine|ui[- ]component|ui[- ]design|visual[- ]design|copy[- ]tweak|a11y|animation[- ]smooth|interaction[- ]smooth|pan[\/\- ]zoom|\bui[- ]polish/i;
  if (compoundSignalPattern.test(contextSignal)) {
    return true;
  }

  const metadataSignal = UI_REFINEMENT_REQUIRED_FIELDS.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(reviewEvidence, key)) return false;
    const value = reviewEvidence[key];
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(trim(value));
  });

  if (metadataSignal) return true;

  const domainValue = trim(reviewEvidence?.domain || reviewContext?.domain).toLowerCase();
  return domainValue === "ui-refinement";
}

function hasPolicyGuidanceRefs({ issueTitle = "", issueBody = "", reviewContext = {}, reviewEvidence = {} } = {}) {
  const corpus = normalizeTextList([
    issueTitle,
    issueBody,
    reviewContext?.issue_excerpt,
    reviewContext?.builder_notes,
    reviewEvidence?.review_evidence_note,
    reviewEvidence?.builder_notes,
  ]).join("\n").toLowerCase();

  return /agents\.md|agent-learnings\.md|agents|agent-learnings/.test(corpus);
}

function hasAdversarialEvidence({ issueTitle = "", issueBody = "", reviewContext = {}, reviewEvidence = {} } = {}) {
  const corpus = normalizeTextList([
    issueTitle,
    issueBody,
    reviewContext?.issue_excerpt,
    reviewContext?.builder_notes,
    reviewEvidence?.review_evidence_note,
    reviewEvidence?.builder_notes,
  ]).join("\n").toLowerCase();

  return /adversarial|red[- ]team|counterexample|falsif/i.test(corpus);
}

function hasScenarioRootReference({ scenarioRoot = "", scenarioSources = [], reviewContext = {}, issueTitle = "", issueBody = "" } = {}) {
  const normalizedRoot = trim(scenarioRoot).toLowerCase();
  if (!normalizedRoot) return true;

  const sourcesJoined = normalizeTextList(scenarioSources).join("\n").toLowerCase();
  if (sourcesJoined.includes(normalizedRoot)) return true;

  const corpus = normalizeTextList([
    reviewContext?.issue_excerpt,
    issueTitle,
    issueBody,
  ]).join("\n").toLowerCase();

  return corpus.includes(normalizedRoot);
}

function resolveScenarioRoot({ scenarioRoot = "", factoryRoot = "" } = {}) {
  const explicit = trim(scenarioRoot);
  if (explicit) return explicit;

  const normalizedFactoryRoot = trim(factoryRoot);
  if (!normalizedFactoryRoot) return "";

  const configPath = resolve(normalizedFactoryRoot, "factory.config.json");
  if (!existsSync(configPath)) return "";

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return trim(parsed?.scenarios?.root);
  } catch {
    return "";
  }
}

export function verifyVisualRefinementEvidence({
  repo = "",
  issueNumber = "",
  reviewContextPath = "",
  reviewEvidencePath = "",
  reviewContextGatePass = "",
  reviewContextGateCode = "",
  scenarioRoot = "",
  factoryRoot = "",
} = {}) {
  const contextGatePass = trim(reviewContextGatePass).toLowerCase();
  if (contextGatePass && contextGatePass !== "true") {
    return {
      visual_refinement_gate_pass: "true",
      visual_refinement_gate_code: "skipped_review_context_failed",
      visual_refinement_required: "false",
      visual_refinement_missing: [],
      visual_refinement_notes: `review_context_gate_not_passed:${trim(reviewContextGateCode) || "unknown"}`,
    };
  }

  const reviewContext = parseJsonObject(reviewContextPath);
  const reviewEvidence = parseJsonObject(reviewEvidencePath);
  const issue = parseIssueFromRepo({ repo, issueNumber });
  const resolvedScenarioRoot = resolveScenarioRoot({ scenarioRoot, factoryRoot });

  const required = hasUiRefinementSignal({
    reviewContext,
    reviewEvidence,
    issueTitle: issue.title,
    issueBody: issue.body,
  });

  if (!required) {
    return {
      visual_refinement_gate_pass: "true",
      visual_refinement_gate_code: "not_required",
      visual_refinement_required: "false",
      visual_refinement_missing: [],
      visual_refinement_notes: "no_ui_refinement_signal",
    };
  }

  const metadataText = normalizeTextList([
    reviewEvidence?.review_evidence_note,
    reviewEvidence?.builder_notes,
    reviewContext?.builder_notes,
    reviewContext?.issue_excerpt,
    issue.title,
    issue.body,
  ]).join("\n");

  const parsed = parseEvidenceFlags(reviewEvidence, metadataText);
  const missing = [...parsed.issues];

  if (!hasScenarioRootReference({
    scenarioRoot: resolvedScenarioRoot,
    scenarioSources: parsed.scenarioSources,
    reviewContext,
    issueTitle: issue.title,
    issueBody: issue.body,
  })) {
    missing.push("scenario_root_reference");
  }

  if (!hasPolicyGuidanceRefs({
    issueTitle: issue.title,
    issueBody: issue.body,
    reviewContext,
    reviewEvidence,
  })) {
    missing.push("agents_guidance_reference");
  }

  if (!hasAdversarialEvidence({
    issueTitle: issue.title,
    issueBody: issue.body,
    reviewContext,
    reviewEvidence,
  })) {
    missing.push("adversarial_review_artifacts");
  }

  if (missing.length > 0) {
    return {
      visual_refinement_gate_pass: "false",
      visual_refinement_gate_code: "visual_refinement_evidence_missing",
      visual_refinement_required: "true",
      visual_refinement_missing: [...new Set(missing)],
      visual_refinement_notes: `missing:${[...new Set(missing)].join(",")}`,
      visual_refinement_scenario_root: resolvedScenarioRoot,
    };
  }

  return {
    visual_refinement_gate_pass: "true",
    visual_refinement_gate_code: "ok",
    visual_refinement_required: "true",
    visual_refinement_missing: [],
    visual_refinement_notes: "visual_refinement_evidence_verified",
    visual_refinement_scenario_root: resolvedScenarioRoot,
  };
}
