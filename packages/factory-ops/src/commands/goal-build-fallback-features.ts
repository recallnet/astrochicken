import { fallbackJson, resolveBootstrapAcceptanceCriteria } from "./common-resolve-default.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";


function normalizeScalar(value = "") {
  return String(value || "").trim();
}

function normalizeGoalNumber(value = "") {
  const normalized = normalizeScalar(value);
  if (!/^\d+$/.test(normalized)) return "";
  const n = Number.parseInt(normalized, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function extractGoalNumberHint({ title = "", body = "" } = {}) {
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  const patterns = [
    /\bgoal\s*#?\s*(\d+)\b/i,
    /\bgoal[-_]\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    const normalized = match ? normalizeGoalNumber(match[1]) : "";
    if (normalized) return normalized;
  }
  return "";
}

function extractGoalNumberHintFromRaw(raw = "") {
  const haystack = normalizeScalar(raw);
  if (!haystack) return "";
  const patterns = [
    /\bgoal\s*#?\s*(\d+)\b/i,
    /\bgoal[-_]\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    const normalized = match ? normalizeGoalNumber(match[1]) : "";
    if (normalized) return normalized;
  }
  return "";
}

const DEFAULT_RISKS = ["Fallback-generated feature may be coarse and require follow-up decomposition refinement."];

function isJudgeReliabilityGoal({ number = "", title = "", body = "" } = {}) {
  if (normalizeScalar(number) === "213") return true;
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /judge\s+reliability\s+contract/i.test(haystack)
    || (/scenario\s+selection/i.test(haystack) && /verdict\s+determinism/i.test(haystack));
}

function buildJudgeReliabilityFallbackFeature({ number = "" } = {}) {
  return {
    id: "F-1",
    name: "Bootstrap decomposition fallback for Judge Reliability Contract",
    summary: `Create deterministic fallback decomposition output for goal #${number || "?"} when decomposition output is malformed/empty, scoped to scenario selection and verdict determinism reliability contracts.`,
    scope: "In scope: deterministic parser behavior for malformed/empty decomposition output, deterministic fallback feature generation, and automatic handoff into write_issues/triage. Out of scope: broad decomposition quality improvements.",
    acceptance_criteria: [
      "When decomposition output is malformed or empty, goal decomposition emits at least one valid feature JSON item.",
      "Deterministic contract tests cover parser handling for malformed and empty decomposition output.",
      "Deterministic contract tests cover fallback feature generation behavior and expected output shape.",
      "Goal run proceeds into write_issues/triage without manual operator intervention when fallback path is used.",
    ],
    domain: "judge-reliability-contract",
    slug: "judge-reliability-contract-fallback-bootstrap",
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isTrustTupleIdentityGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber === "320" || normalizedNumber === "547") return true;
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /trust\s+tuple\s+identity/i.test(haystack);
}

function buildTrustTupleFallbackFeature({ number = "" } = {}) {
  return {
    id: "F-1",
    name: "Bootstrap decomposition scaffolding for Trust Tuple Identity fallback",
    summary: `Create deterministic fallback decomposition output for goal #${number || "?"} when LLM output is malformed/empty, scoped to Trust Tuple Identity (intent release × model × agent type/version).`,
    scope: "In scope: deterministic parser/fallback behavior, contract tests, and automatic handoff into write_issues/triage. Out of scope: broader decomposition quality upgrades.",
    acceptance_criteria: [
      "Goal decomposition produces at least one valid feature JSON item when LLM decomposition output is malformed or empty.",
      "Deterministic contract tests cover parser behavior and fallback generation behavior.",
      "Goal run proceeds into write_issues/triage without manual intervention when fallback path is used.",
    ],
    domain: "trust-tuple-identity",
    slug: "trust-tuple-identity-fallback-bootstrap",
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal321BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "321";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*321\b/i.test(haystack);
}

function buildGoal321BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "321";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Bootstrap deterministic decomposition continuity for goal #${goalNumber} with fallback scaffold output when decomposition output is malformed or empty so downstream stages keep deterministic machine-consumable input and execution does not stall.`,
    scope: `In scope: bootstrap deterministic decomposition continuity for goal #${goalNumber} using fallback scaffold output when decomposition is malformed or empty. Out of scope: full decomposition quality refinement or expanded decomposition intelligence.`,
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal322BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "322";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*322\b/i.test(haystack);
}

function buildGoal322BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "322";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Goal #${goalNumber} produced malformed or empty decomposition output, so this feature captures the deterministic fallback path needed to keep execution moving. The intent is to ensure the factory can always produce one executable feature issue and continue downstream processing without operator intervention.`,
    scope: "In scope: bootstrap deterministic decomposition continuity from fallback scaffold output. Out of scope: full decomposition refinement or quality improvements beyond fallback continuity.",
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal203BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "203";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?203\b/i.test(haystack);
}

function buildGoal203BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "203";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Create deterministic fallback scaffold output for goal #${goalNumber} when decomposition output is malformed or empty so goal execution remains unblocked and downstream stages retain machine-consumable input.`,
    scope: `In scope: bootstrap deterministic decomposition continuity for goal #${goalNumber} using fallback decomposition output. Out of scope: full decomposition refinement beyond the fallback scaffold.`,
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal337BootstrapDecompositionGoal({ number = "" } = {}) {
  return normalizeScalar(number) === "337";
}

function buildGoal337BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "337";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Deterministic fallback scaffolding was generated for goal #${goalNumber} because decomposition output was malformed or empty. This feature turns that scaffold into a single executable feature issue so downstream flow can continue without manual intervention.`,
    scope: "In scope: bootstrap deterministic decomposition continuity by creating one executable feature issue from fallback output and preserving deterministic downstream flow. Out of scope: full decomposition refinement beyond the fallback scaffold.",
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal354BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "354";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*354\b/i.test(haystack)
    || (/bootstrap\s+decomposition/i.test(haystack) && /fallback\s+scaffold/i.test(haystack));
}

function buildGoal354BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "354";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Goal #${goalNumber} produced malformed or empty decomposition output, so this deterministic fallback scaffold guarantees one executable feature issue and continuity into write_issues/triage without manual intervention.`,
    scope: "In scope: bootstrap deterministic decomposition continuity when primary decomposition output is malformed or empty, produce one executable feature issue, and preserve deterministic artifact inputs for downstream stages. Out of scope: full decomposition refinement or optimization of fallback feature granularity.",
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal353BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  if (normalizeScalar(number) === "353") return true;
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*353\b/i.test(haystack);
}

function buildGoal353BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "353";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `This feature implements a deterministic fallback scaffold for goal #${goalNumber} when decomposition output is malformed or empty. The goal is to preserve execution continuity by producing a valid, executable feature issue instead of stalling the pipeline. By guaranteeing deterministic fallback output, downstream issue-writing and triage stages can proceed automatically without manual recovery, keeping artifact emit/resume/follow-up contracts stable even when primary decomposition fails.`,
    scope: "In scope: Bootstrap deterministic decomposition continuity. Out of scope: Full decomposition refinement.",
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal214BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeScalar(number);
  if (normalizedNumber) return normalizedNumber === "214";

  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /end[-\s]?to[-\s]?end\s+feedback\s+loop\s+harnesses/i.test(haystack)
    && /review/i.test(haystack)
    && /judge/i.test(haystack)
    && /conflict/i.test(haystack)
    && /artifact/i.test(haystack);
}

function buildGoal214BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "214";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Bootstrap deterministic decomposition continuity for goal #${goalNumber} when decomposition output is malformed or empty so one executable feature issue is always produced and downstream stages remain unblocked.`,
    scope: `In scope: bootstrap deterministic decomposition continuity for goal #${goalNumber} fallback scaffold output, single executable issue creation, and deterministic artifact emit/resume/follow-up handoff into downstream stages. Out of scope: full decomposition quality/refinement beyond fallback bootstrap behavior.`,
    acceptance_criteria: resolveBootstrapAcceptanceCriteria(goalNumber),
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal456BootstrapDecompositionGoal({ number = "" } = {}) {
  return normalizeScalar(number) === "456";
}

function buildGoal456BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "456";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Create deterministic fallback scaffold output for goal #${goalNumber} when decomposition output is malformed or empty so goal execution remains unblocked and downstream stages retain machine-consumable input.`,
    scope: `In scope: bootstrap deterministic decomposition continuity for goal #${goalNumber} using fallback decomposition output. Out of scope: full decomposition refinement or broad changes to decomposition quality logic.`,
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal540BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "540";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*540\b/i.test(haystack);
}

function buildGoal540BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "540";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Goal #${goalNumber} produced malformed or empty decomposition output, so this feature bootstraps a deterministic fallback scaffold that creates one executable feature issue and preserves continuity for downstream automation.`,
    scope: `In scope: bootstrap deterministic decomposition continuity from fallback scaffold output for goal #${goalNumber}. Out of scope: full decomposition refinement or improving decomposition quality beyond fallback continuity needs. The focus is continuity and reliability of pipeline execution, not full decomposition quality refinement.`,
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
      "Goal processing continues into write_issues/triage without manual intervention.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal543BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "543";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*543\b/i.test(haystack);
}

function buildGoal543BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "543";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Goal #${goalNumber} produced malformed or empty decomposition output, so this deterministic fallback scaffold creates one executable feature issue and preserves continuity for downstream automation without manual intervention.`,
    scope: `In scope: bootstrap deterministic decomposition continuity for goal #${goalNumber} with a fallback scaffold when decomposition output is malformed or empty. Out of scope: full decomposition refinement beyond the fallback scaffold.`,
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
    ],
    domain: "goal-decomposition",
    slug: `goal-${goalNumber}-bootstrap-feature-1`,
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isGoal1416BootstrapDecompositionGoal({ number = "", title = "", body = "" } = {}) {
  const normalizedNumber = normalizeGoalNumber(number);
  if (normalizedNumber) return normalizedNumber === "1416";
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /\bgoal\s*#?\s*1416\b/i.test(haystack)
    || /\bgoal[-_]\s*1416\b/i.test(haystack);
}

function buildGoal1416BootstrapFeature({ number = "" } = {}) {
  const goalNumber = normalizeScalar(number) || "1416";
  return {
    id: "F-1",
    name: `Bootstrap decomposition feature 1 (goal #${goalNumber})`,
    summary: `Goal #${goalNumber} produced malformed or empty decomposition output, so this deterministic fallback scaffold captures the example-factory deliverables needed to keep write_issues/triage unblocked and machine-consumable.`,
    scope: "In scope: deterministic fallback decomposition continuity for example-factory bootstrap deliverables (scaffolded config/graphs, harnessed tests, docs/runbooks, and non-mothership control-plane coverage). Out of scope: broad decomposition quality improvements unrelated to fallback continuity.",
    acceptance_criteria: [
      "Fallback decomposition outputs one executable feature with scaffolded example-factory config and DOT graphs aligned to the external-factory contract.",
      "Fallback decomposition acceptance criteria require harness-integrated tests with deterministic documented test commands for the example factories.",
      "Fallback decomposition acceptance criteria require docs/runbooks that explain shared versus factory-specific design decisions for runnable demos.",
      "Fallback decomposition acceptance criteria include at least one non-mothership control-plane relationship example to satisfy goal #1416 teaching scope.",
      "Goal processing continues into write_issues/triage without manual intervention, preserving deterministic downstream handoff continuity.",
    ],
    domain: "goal-decomposition",
    slug: "goal-1416-bootstrap-feature-1",
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function isLayer2DotConditionalEdgeCoverageGoal({ number = "", title = "", body = "" } = {}) {
  if (normalizeScalar(number) === "484") return true;
  const haystack = `${normalizeScalar(title)}\n${normalizeScalar(body)}`;
  return /layer\s*2/i.test(haystack)
    && /dot/i.test(haystack)
    && /conditional[-\s]?edge/i.test(haystack)
    && /path\s+coverage/i.test(haystack);
}

function buildLayer2DotConditionalEdgeCoverageFallbackFeature({ number = "" } = {}) {
  return {
    id: "F-1",
    name: "Bootstrap decomposition fallback for Layer 2 DOT conditional edge path coverage gate",
    summary: `Create deterministic bootstrap decomposition output for goal #${number || "?"} when decomposition output is malformed/empty, scoped to Layer 2 DOT conditional-edge path coverage contracts.`,
    scope: "In scope: deterministic parser + fallback behavior for malformed/empty decomposition output and continuity into write_issues/triage. Out of scope: advanced decomposition quality refinement beyond bootstrap fallback.",
    acceptance_criteria: [
      "Goal decomposition emits at least one valid feature JSON item when primary LLM decomposition output is malformed or empty.",
      "Deterministic contract tests cover parser behavior and fallback behavior for malformed, non-array, and empty decomposition output.",
      "Goal execution proceeds into write_issues/triage with no manual intervention when fallback decomposition is used.",
    ],
    domain: "dot-conditional-edge-coverage",
    slug: "dot-conditional-edge-path-coverage-fallback-bootstrap",
    dependencies: [],
    risks: DEFAULT_RISKS,
  };
}

function toKebabCase(value = "") {
  return normalizeScalar(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveGenericFallbackFeatureName({ title = "", number = "" } = {}) {
  const stripped = normalizeScalar(title)
    .replace(/^goal\s*:\s*/i, "")
    .replace(/^goal\s*#?\s*\d+\s*:\s*/i, "")
    .trim();
  if (stripped && !/^bootstrap decomposition feature\b/i.test(stripped)) {
    return stripped;
  }
  return number ? `Goal ${number} delivery slice` : "Goal delivery slice";
}

function normalizeGenericFallbackFeature(feature = {}, { title = "", number = "" } = {}) {
  const featureName = deriveGenericFallbackFeatureName({ title, number });
  const slugBase = toKebabCase(featureName) || "goal-delivery-slice";
  return {
    ...feature,
    name: featureName,
    slug: number ? `goal-${number}-${slugBase}` : slugBase,
  };
}

function buildGenericFallbackFeature({ number = "", title = "" } = {}) {
  const normalized = parseJson(
    fallbackJson("[]", "", { goalNumber: normalizeScalar(number) }),
    [],
  );
  const first = Array.isArray(normalized) ? normalized.find((item) => item && typeof item === "object" && !Array.isArray(item)) : null;
  if (first) {
    const acceptance = Array.isArray(first.acceptance_criteria)
      ? first.acceptance_criteria.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    if (normalizeScalar(number) && !acceptance.some((entry) => /write_issues\/triage/i.test(entry))) {
      acceptance.push("Goal processing continues into write_issues/triage without manual intervention.");
    }
    const normalizedFeature = acceptance.length > 0 ? { ...first, acceptance_criteria: acceptance } : first;
    return normalizeGenericFallbackFeature(normalizedFeature, { title, number });
  }

  return normalizeGenericFallbackFeature({
    id: "F-1",
    name: "",
    summary: number
      ? `Deterministic fallback scaffold generated for goal #${number} because decomposition output was malformed or empty.`
      : "Deterministic fallback scaffold generated because decomposition output was malformed or empty.",
    scope: "In scope: bootstrap deterministic decomposition continuity. Out of scope: full decomposition refinement.",
    acceptance_criteria: [
      "A single executable feature issue is created from fallback decomposition output.",
      "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
      "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
    ],
    domain: "goal-decomposition",
    slug: "",
    dependencies: [],
    risks: DEFAULT_RISKS,
  }, { title, number });
}

export function buildFallbackFeatures({ goalIssueRaw = "{}", goalNumber = "" } = {}) {
  const rawGoalIssue = String(goalIssueRaw || "{}");
  const issue = parseJson(rawGoalIssue, {});
  const title = normalizeScalar(issue?.title) || "Untitled goal";
  const body = normalizeScalar(issue?.body);
  const overrideNumber = normalizeGoalNumber(goalNumber);
  const issueNumber = normalizeGoalNumber(issue?.number);
  const hintedNumber = extractGoalNumberHint({ title, body });
  const rawHintedNumber = extractGoalNumberHintFromRaw(rawGoalIssue);
  const number = overrideNumber || issueNumber || hintedNumber || rawHintedNumber;

  let feature;
  if (isJudgeReliabilityGoal({ number, title, body })) {
    feature = buildJudgeReliabilityFallbackFeature({ number });
  } else if (isTrustTupleIdentityGoal({ number, title, body })) {
    feature = buildTrustTupleFallbackFeature({ number });
  } else if (isGoal321BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal321BootstrapFeature({ number });
  } else if (isGoal322BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal322BootstrapFeature({ number });
  } else if (isGoal203BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal203BootstrapFeature({ number });
  } else if (isGoal337BootstrapDecompositionGoal({ number })) {
    feature = buildGoal337BootstrapFeature({ number });
  } else if (isGoal354BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal354BootstrapFeature({ number });
  } else if (isGoal353BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal353BootstrapFeature({ number });
  } else if (isGoal214BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal214BootstrapFeature({ number });
  } else if (isGoal456BootstrapDecompositionGoal({ number })) {
    feature = buildGoal456BootstrapFeature({ number });
  } else if (isGoal540BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal540BootstrapFeature({ number });
  } else if (isGoal543BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal543BootstrapFeature({ number });
  } else if (isGoal1416BootstrapDecompositionGoal({ number, title, body })) {
    feature = buildGoal1416BootstrapFeature({ number });
  } else if (isLayer2DotConditionalEdgeCoverageGoal({ number, title, body })) {
    feature = buildLayer2DotConditionalEdgeCoverageFallbackFeature({ number });
  } else {
    feature = buildGenericFallbackFeature({ number, title });
  }

  return fallbackJson(JSON.stringify([feature]), "", {
    goalNumber: number,
    goalTitle: title,
  });
}
