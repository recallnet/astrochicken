const REQUIRED_EXTERNAL_BUG_FIELDS = [
  "source_factory",
  "source_repo",
  "affected_version",
  "incident_evidence",
  "expected_behavior",
  "observed_behavior",
  "remediation_attempts",
];

const OPTIONAL_EXTERNAL_BUG_FIELDS = ["control_plane_intent"];

const FIELD_ALIASES = {
  source_factory: ["source_factory", "source factory", "reporting factory", "external factory", "factory"],
  source_repo: ["source_repo", "source repo", "source repository", "reporting repo", "repo", "repository"],
  affected_version: ["affected_version", "affected version", "affected release", "version", "release"],
  incident_evidence: ["incident_evidence", "incident evidence", "evidence", "incident artifacts", "logs"],
  expected_behavior: ["expected_behavior", "expected behavior"],
  observed_behavior: ["observed_behavior", "observed behavior"],
  remediation_attempts: [
    "remediation_attempts",
    "remediation attempts",
    "local remediation attempts",
    "local remediation",
    "attempted remediation",
    "troubleshooting tried",
  ],
  control_plane_intent: ["control_plane_intent", "control plane intent", "product intent", "intent"],
};

const NORMALIZED_ALIAS_TO_FIELD = new Map(
  Object.entries(FIELD_ALIASES)
    .flatMap(([field, aliases]) => aliases.map((alias) => [normalizeAlias(alias), field])),
);

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return fallback;
  }
}

function normalizeAlias(raw = "") {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function resolveFieldName(raw = "") {
  const direct = normalizeAlias(raw);
  return NORMALIZED_ALIAS_TO_FIELD.get(direct) || "";
}

function resolveHeadingFieldName(raw = "") {
  const headingText = String(raw || "").trim();
  const headingPair = headingText.match(/^([^:]+):\s*(.+)$/);
  return resolveFieldName(headingPair ? headingPair[1] : headingText);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return String(value ?? "").trim().length > 0;
}

function normalizeStringValue(value = "") {
  return String(value ?? "").trim();
}

function normalizeSectionValue(raw = "") {
  const lines = String(raw || "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));

  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length > 0 && nonEmpty.every((line) => /^\s*[-*]\s+/.test(line))) {
    return lines.map((line) => line.replace(/^\s*[-*]\s+/, "")).join("\n").trim();
  }

  return lines.join("\n").trim();
}

function buildOrderedReport(candidate = {}) {
  const ordered = {};
  for (const field of [...REQUIRED_EXTERNAL_BUG_FIELDS, ...OPTIONAL_EXTERNAL_BUG_FIELDS]) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) continue;
    const value = candidate[field];
    if (!hasValue(value)) continue;
    ordered[field] = typeof value === "string" ? normalizeStringValue(value) : value;
  }
  return ordered;
}

function validateExternalBugReport(report = {}) {
  const errors = [];

  for (const field of REQUIRED_EXTERNAL_BUG_FIELDS) {
    if (!hasValue(report[field])) {
      errors.push(`missing_required_field:${field}`);
    }
  }

  const sourceRepo = normalizeStringValue(report.source_repo);
  if (sourceRepo && !/^[^/\s]+\/[^/\s]+$/.test(sourceRepo)) {
    errors.push("invalid_field:source_repo:expected_owner_repo");
  }

  const hasIdentityHints = Boolean(normalizeStringValue(report.source_factory) && sourceRepo);
  const hasControlPlaneIntent = Boolean(normalizeStringValue(report.control_plane_intent));
  if (!hasIdentityHints && !hasControlPlaneIntent) {
    errors.push("missing_control_plane_context");
  }

  return errors;
}

function extractFencedJsonBlocks(body = "") {
  const blocks = [];
  const fencePattern = /```\s*([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  for (const match of body.matchAll(fencePattern)) {
    blocks.push({
      language: normalizeAlias(match[1]),
      content: String(match[2] || "").trim(),
    });
  }
  return blocks;
}

function normalizeHeadingText(raw = "") {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/\s+#+\s*$/g, "")
    .replace(/\s+/g, " ");
}

function detectExternalBugSection(body = "") {
  const lines = String(body || "").split("\n");

  let activation = null;
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) continue;

    const headingText = normalizeHeadingText(headingMatch[2]);
    if (headingText !== "external bug report") continue;

    activation = {
      headingDepth: headingMatch[1].length,
      startLine: index + 1,
    };
    break;
  }

  if (!activation) {
    return {
      activated: false,
      mode: "none",
      sectionBody: "",
    };
  }

  let endLine = lines.length;
  for (let index = activation.startLine; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) continue;

    const headingDepth = headingMatch[1].length;
    const headingText = String(headingMatch[2] || "").trim();

    if (headingDepth < activation.headingDepth) {
      endLine = index;
      break;
    }

    if (headingDepth > activation.headingDepth) {
      continue;
    }

    const normalizedHeading = normalizeHeadingText(headingText);
    if (normalizedHeading === "external bug report") {
      endLine = index;
      break;
    }

    if (resolveHeadingFieldName(headingText)) {
      continue;
    }

    endLine = index;
    break;
  }

  const sectionBody = lines.slice(activation.startLine, endLine).join("\n");
  const mode = extractFencedJsonBlocks(sectionBody).some((block) => block.language === "json")
    ? "json"
    : "section";

  return {
    activated: true,
    mode,
    sectionBody,
  };
}

function scoreCandidate(candidate = {}) {
  let score = 0;
  for (const field of REQUIRED_EXTERNAL_BUG_FIELDS) {
    if (hasValue(candidate[field])) score += 1;
  }
  if (hasValue(candidate.control_plane_intent)) score += 1;
  return score;
}

function parseFencedExternalBugReport(body = "") {
  const blocks = extractFencedJsonBlocks(body);
  const explicitJsonBlocks = blocks.filter((block) => block.language === "json");

  if (explicitJsonBlocks.length === 0) {
    return { found: false, report: null, errors: [] };
  }

  const parseErrors = [];
  const parsedCandidates = [];

  for (const block of explicitJsonBlocks) {
    if (!block.content) continue;
    const parsed = safeJsonParse(block.content, null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (parsed === null) {
        parseErrors.push("invalid_external_bug_report_json");
      } else {
        parseErrors.push("invalid_external_bug_report_json_shape:expected_object");
      }
      continue;
    }
    parsedCandidates.push(parsed);
  }

  if (parsedCandidates.length === 0) {
    return {
      found: true,
      report: null,
      errors: [...new Set(parseErrors)],
    };
  }

  const best = parsedCandidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;

  return { found: true, report: best, errors: [] };
}

function parseSectionExternalBugReport(body = "") {
  const lines = String(body || "").split("\n");
  const candidate = {};

  let activeField = "";
  let activeBuffer = [];

  function flushActiveField() {
    if (!activeField) return;
    const value = normalizeSectionValue(activeBuffer.join("\n"));
    if (value) candidate[activeField] = value;
    activeField = "";
    activeBuffer = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushActiveField();
      const headingText = String(headingMatch[1] || "").trim();
      const headingPair = headingText.match(/^([^:]+):\s*(.+)$/);
      const headingKey = resolveHeadingFieldName(headingText);
      if (!headingKey) continue;

      if (headingPair) {
        const inlineValue = normalizeStringValue(headingPair[2]);
        if (inlineValue) candidate[headingKey] = inlineValue;
      } else {
        activeField = headingKey;
      }
      continue;
    }

    const kvMatch = line.match(/^\s*[-*]?\s*([A-Za-z0-9 _-]+)\s*:\s*(.+)$/);
    if (kvMatch) {
      const kvKey = resolveFieldName(kvMatch[1]);
      if (kvKey) {
        const kvValue = normalizeStringValue(kvMatch[2]);
        if (kvValue) candidate[kvKey] = kvValue;
      }
    }

    if (activeField) activeBuffer.push(line);
  }

  flushActiveField();
  return candidate;
}

function resolveGoalIssueBody(goalIssueRaw = "{}") {
  const parsed = safeJsonParse(goalIssueRaw, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "";
  }
  return normalizeStringValue(parsed.body);
}

export function parseExternalBugReport({ goalIssueRaw = "{}" } = {}) {
  const body = resolveGoalIssueBody(goalIssueRaw);
  if (!body) {
    return {
      external_bug_report: null,
      external_bug_errors: [],
      external_bug_present: false,
      external_bug_intake_activated: false,
    };
  }

  const externalBugSection = detectExternalBugSection(body);
  if (!externalBugSection.activated) {
    return {
      external_bug_report: null,
      external_bug_errors: [],
      external_bug_present: false,
      external_bug_intake_activated: false,
    };
  }

  const fenced =
    externalBugSection.mode === "json"
      ? parseFencedExternalBugReport(externalBugSection.sectionBody)
      : { found: false, report: null, errors: [] };

  if (fenced.found && !fenced.report) {
    return {
      external_bug_report: null,
      external_bug_errors: fenced.errors,
      external_bug_present: false,
      external_bug_intake_activated: true,
    };
  }

  const parsedCandidate = fenced.report || parseSectionExternalBugReport(externalBugSection.sectionBody);
  const normalizedReport = buildOrderedReport(parsedCandidate);
  const validationErrors = validateExternalBugReport(normalizedReport);

  if (!hasValue(normalizedReport)) {
    return {
      external_bug_report: null,
      external_bug_errors: validationErrors,
      external_bug_present: false,
      external_bug_intake_activated: true,
    };
  }

  return {
    external_bug_report: normalizedReport,
    external_bug_errors: validationErrors,
    external_bug_present: validationErrors.length === 0,
    external_bug_intake_activated: true,
  };
}
