import { parseJson, trim } from "../lib/cli-helpers.ts";

const REQUIRED_FRONTMATTER_FIELDS = ["id", "domain", "priority", "created"];
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CREATED_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_RE = /^(critical|high|medium|low)$/;

function trimString(value) {
  return trim(String(value || ""));
}

function buildRetryPrompt(error) {
  return [
    "Return JSON only with scenario_domain, scenario_slug, and scenario_md.",
    "scenario_domain must be a single kebab-case directory name.",
    "scenario_slug must be kebab-case and must match frontmatter id.",
    "scenario_md must start with YAML frontmatter containing id, domain, priority, and created.",
    "priority must be one of critical|high|medium|low.",
    "created must be YYYY-MM-DD.",
    "After frontmatter, include only a 1-5 line holdout truth block (no ## sections, no checkboxes).",
    `Validation error: ${error}.`,
  ].join("\n");
}

function parseFrontmatter(md = "") {
  const match = String(md || "").match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: "", hasFrontmatter: false };

  const frontmatter = String(match[1] || "");
  const body = String(md || "").slice(match[0].length).trim();
  const fields = {};

  for (const rawLine of frontmatter.split("\n")) {
    const line = trimString(rawLine);
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.+)$/);
    if (!kv) continue;
    const key = trimString(kv[1]);
    const value = trimString(String(kv[2] || "").replace(/^['"]|['"]$/g, ""));
    if (key) fields[key] = value;
  }

  return { fields, body, hasFrontmatter: true };
}

function validateTruthBody(body = "") {
  const normalized = String(body || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return { ok: false, error: "scenario_md truth body must be non-empty" };

  if (/^#{1,6}\s+/m.test(normalized)) {
    return { ok: false, error: "scenario_md truth body must not include markdown headings" };
  }

  if (/^\- \[ \]/m.test(normalized)) {
    return { ok: false, error: "scenario_md truth body must not include checkbox assertions" };
  }

  const lines = normalized
    .split("\n")
    .map((line) => trimString(line))
    .filter(Boolean);

  if (lines.length < 1 || lines.length > 5) {
    return { ok: false, error: "scenario_md truth body must be 1-5 non-empty lines" };
  }

  return { ok: true, error: "" };
}

export function validateScenarioPayload(payloadRaw = "{}") {
  const parsed = parseJson(String(payloadRaw || "{}"), null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = "scenario payload must be a JSON object";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain: "", scenario_slug: "", scenario_md: "" };
  }

  const scenario_domain = trimString(parsed.scenario_domain);
  const scenario_slug = trimString(parsed.scenario_slug);
  const scenario_md = String(parsed.scenario_md || "").replace(/\r\n/g, "\n").trim();

  if (!DOMAIN_RE.test(scenario_domain)) {
    const error = "scenario_domain must be a single kebab-case directory name";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }
  if (!SLUG_RE.test(scenario_slug)) {
    const error = "scenario_slug must be kebab-case";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }
  if (!scenario_md) {
    const error = "scenario_md must be non-empty";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  const frontmatter = parseFrontmatter(scenario_md);
  if (!frontmatter.hasFrontmatter) {
    const error = "scenario_md must start with YAML frontmatter";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (!trimString(frontmatter.fields[field])) {
      const error = `scenario_md frontmatter is missing ${field}`;
      return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
    }
  }

  if (trimString(frontmatter.fields.id) !== scenario_slug) {
    const error = "scenario_md frontmatter id must match scenario_slug";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  if (trimString(frontmatter.fields.domain) !== scenario_domain) {
    const error = "scenario_md frontmatter domain must match scenario_domain";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  if (!PRIORITY_RE.test(trimString(frontmatter.fields.priority).toLowerCase())) {
    const error = "scenario_md frontmatter priority must be critical|high|medium|low";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  if (!CREATED_RE.test(trimString(frontmatter.fields.created))) {
    const error = "scenario_md frontmatter created must be YYYY-MM-DD";
    return { ok: false, error, retry_prompt: buildRetryPrompt(error), scenario_domain, scenario_slug, scenario_md };
  }

  const truthCheck = validateTruthBody(frontmatter.body);
  if (!truthCheck.ok) {
    return {
      ok: false,
      error: truthCheck.error,
      retry_prompt: buildRetryPrompt(truthCheck.error),
      scenario_domain,
      scenario_slug,
      scenario_md,
    };
  }

  return {
    ok: true,
    error: "",
    retry_prompt: "",
    scenario_domain,
    scenario_slug,
    scenario_md,
    payload: JSON.stringify({ scenario_domain, scenario_slug, scenario_md }),
  };
}
