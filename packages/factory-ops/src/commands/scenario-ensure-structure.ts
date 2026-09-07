import { trim, parseJson } from "../lib/cli-helpers.ts";

const REQUIRED_SECTIONS = [
  "Context",
  "Preconditions",
  "Trigger",
  "Expected Behavior",
  "Assertions",
  "Edge Cases",
];

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHeadingLevels(md) {
  let out = String(md || "").replace(/\r\n/g, "\n");
  for (const title of REQUIRED_SECTIONS) {
    const re = new RegExp(`^#{1,6}\\s*${esc(title)}\\s*$`, "gim");
    out = out.replace(re, `## ${title}`);
  }
  return out;
}

function hasSection(md, title) {
  return new RegExp(`^##\\s+${esc(title)}\\s*$`, "m").test(md);
}

function appendSection(md, title) {
  const sectionBody = title === "Assertions" || title === "Edge Cases"
    ? "- [ ] TODO: add deterministic assertion."
    : "TODO: add content.";
  const sep = md.endsWith("\n") ? "" : "\n";
  return `${md}${sep}\n## ${title}\n${sectionBody}\n`;
}

function ensureAtLeastOneCheckbox(md) {
  if (/^\- \[ \]/m.test(md)) return md;
  if (hasSection(md, "Assertions")) {
    return md.replace(/^##\s+Assertions\s*$/m, "## Assertions\n- [ ] TODO: add deterministic assertion.");
  }
  return appendSection(md, "Assertions");
}

const REQUIRED_FRONTMATTER_FIELDS = ["id", "title", "version", "tags", "priority", "status", "created", "last_reviewed", "authors"];

function extractFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : "";
}

function hasFrontmatterField(frontmatter, field) {
  return new RegExp(`^${field}:`, "m").test(frontmatter);
}

function ensureFrontmatter(md, slug) {
  const today = new Date().toISOString().slice(0, 10);
  const defaults = {
    id: slug || "unknown-scenario",
    title: slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Untitled Scenario",
    version: "1",
    tags: "[]",
    priority: "medium",
    status: "active",
    created: today,
    last_reviewed: today,
    authors: "[scenario-agent]",
  };

  const existing = extractFrontmatter(md);
  if (!existing && !/^---/.test(md.trimStart())) {
    // No frontmatter at all — prepend a full block
    const lines = REQUIRED_FRONTMATTER_FIELDS.map((f) => `${f}: ${defaults[f]}`);
    return `---\n${lines.join("\n")}\n---\n\n${md}`;
  }

  // Frontmatter exists — fill in any missing fields
  let patched = md;
  const missing = REQUIRED_FRONTMATTER_FIELDS.filter((f) => !hasFrontmatterField(existing, f));
  if (missing.length > 0) {
    const additions = missing.map((f) => `${f}: ${defaults[f]}`).join("\n");
    patched = patched.replace(/^---\n/, `---\n${additions}\n`);
  }

  // Ensure id matches slug if slug is provided
  if (slug && hasFrontmatterField(extractFrontmatter(patched), "id")) {
    patched = patched.replace(/^(id:) .*/m, `$1 ${slug}`);
  }

  return patched;
}

export function ensureScenarioStructure(payloadRaw = "{}") {
  const payload = parseJson(String(payloadRaw || "{}"), {});
  const scenario_domain = String(payload?.scenario_domain || "").trim();
  const scenario_slug = String(payload?.scenario_slug || "").trim();
  let scenario_md = normalizeHeadingLevels(String(payload?.scenario_md || ""));

  scenario_md = ensureFrontmatter(scenario_md, scenario_slug);

  for (const title of REQUIRED_SECTIONS) {
    if (!hasSection(scenario_md, title)) {
      scenario_md = appendSection(scenario_md, title);
    }
  }

  scenario_md = ensureAtLeastOneCheckbox(scenario_md);

  return { scenario_domain, scenario_slug, scenario_md };
}
