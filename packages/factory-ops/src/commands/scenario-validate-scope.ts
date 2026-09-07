import { parseJson } from "../lib/cli-helpers.ts";

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const REGISTRY_PATH_RE = /^registry\/astrochicken\/([a-z0-9][a-z0-9-]*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SCENARIO\.md$/;

function trimString(value) {
  return String(value || "").trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => trimString(entry)).filter(Boolean);
}

function buildRetryPrompt(error) {
  return [
    "Return JSON only with keys recommended, declined, and coverage_notes.",
    "recommended must be an array of at most 2 scenario objects.",
    "Each recommended scenario must include non-empty title, story, what_makes_this_hard, key_assertions, edge_cases, priority, and registry_path.",
    "priority must be one of critical|high|medium|low.",
    "registry_path must match registry/astrochicken/<domain>/<slug>/SCENARIO.md.",
    "declined must be an array of {name, reason}.",
    `Validation error: ${error}.`,
  ].join("\n");
}

function normalizeRecommended(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: `recommended[${index}] must be an object` };
  }

  const title = trimString(entry.title);
  const priority = trimString(entry.priority);
  const story = trimString(entry.story);
  const whatMakesThisHard = trimString(entry.what_makes_this_hard);
  const keyAssertions = normalizeStringArray(entry.key_assertions);
  const edgeCases = normalizeStringArray(entry.edge_cases);
  const registryPath = trimString(entry.registry_path);

  if (!title) return { ok: false, error: `recommended[${index}].title must be non-empty` };
  if (!PRIORITIES.has(priority)) return { ok: false, error: `recommended[${index}].priority must be critical|high|medium|low` };
  if (!story) return { ok: false, error: `recommended[${index}].story must be non-empty` };
  if (!whatMakesThisHard) return { ok: false, error: `recommended[${index}].what_makes_this_hard must be non-empty` };
  if (keyAssertions.length === 0) return { ok: false, error: `recommended[${index}].key_assertions must contain at least one string` };
  if (edgeCases.length === 0) return { ok: false, error: `recommended[${index}].edge_cases must contain at least one string` };

  const pathMatch = registryPath.match(REGISTRY_PATH_RE);
  if (!pathMatch) {
    return { ok: false, error: `recommended[${index}].registry_path must match registry/astrochicken/<domain>/<slug>/SCENARIO.md` };
  }

  const [, scenario_domain, scenario_slug] = pathMatch;
  return {
    ok: true,
    value: {
      title,
      priority,
      story,
      what_makes_this_hard: whatMakesThisHard,
      key_assertions: keyAssertions,
      edge_cases: edgeCases,
      registry_path: registryPath,
      scenario_domain,
      scenario_slug,
    },
  };
}

function normalizeDeclined(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: `declined[${index}] must be an object` };
  }
  const name = trimString(entry.name);
  const reason = trimString(entry.reason);
  if (!name) return { ok: false, error: `declined[${index}].name must be non-empty` };
  if (!reason) return { ok: false, error: `declined[${index}].reason must be non-empty` };
  return { ok: true, value: { name, reason } };
}

export function validateScenarioScope(scopeRaw = "{}") {
  const parsed = parseJson(String(scopeRaw || "{}"), null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = "scope result must be a JSON object";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), recommended: [], declined: [], coverage_notes: "" };
  }

  const recommendedInput = Array.isArray(parsed.recommended) ? parsed.recommended : [];
  const declinedInput = Array.isArray(parsed.declined) ? parsed.declined : [];
  const coverageNotes = trimString(parsed.coverage_notes);

  if (recommendedInput.length > 2) {
    const error = "recommended must contain at most 2 scenarios";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), recommended: [], declined: [], coverage_notes: coverageNotes };
  }

  const recommended = [];
  for (const [index, entry] of recommendedInput.entries()) {
    const normalized = normalizeRecommended(entry, index);
    if (!normalized.ok) {
      return {
        ok: false,
        error: normalized.error,
        retry_prompt: buildRetryPrompt(normalized.error),
        recommended: [],
        declined: [],
        coverage_notes: coverageNotes,
      };
    }
    recommended.push(normalized.value);
  }

  const declined = [];
  for (const [index, entry] of declinedInput.entries()) {
    const normalized = normalizeDeclined(entry, index);
    if (!normalized.ok) {
      return {
        ok: false,
        error: normalized.error,
        retry_prompt: buildRetryPrompt(normalized.error),
        recommended: [],
        declined: [],
        coverage_notes: coverageNotes,
      };
    }
    declined.push(normalized.value);
  }

  return {
    ok: true,
    error: "",
    retry_prompt: "",
    recommended,
    declined,
    coverage_notes: coverageNotes,
  };
}
