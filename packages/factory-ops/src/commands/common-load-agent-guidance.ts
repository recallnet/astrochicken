import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";

const DEFAULT_AGENTS_MAX_CHARS = 12000;
const DEFAULT_LEARNINGS_MAX_CHARS = 12000;
const DEFAULT_LEARNINGS_ENTRY_COUNT = 5;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(trim(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveRepoRoot(repoRoot = "") {
  const normalized = trim(repoRoot) || ".";
  return resolve(process.cwd(), normalized);
}

function truncateText(raw = "", maxChars = 0, label = "content") {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n...[truncated ${label}; total_chars=${value.length}]`;
}

function readOptionalText(pathValue = "") {
  if (!pathValue || !existsSync(pathValue)) {
    return { found: false, text: "" };
  }
  try {
    return { found: true, text: readFileSync(pathValue, "utf8") };
  } catch {
    return { found: false, text: "" };
  }
}

function collectRecentLearningEntries(raw = "", entryCount = DEFAULT_LEARNINGS_ENTRY_COUNT) {
  const text = String(raw || "");
  if (!text.trim()) return { excerpt: "", entryCount: 0 };

  const sections = text
    .split(/^###\s+/m)
    .map((section) => section.trim())
    .filter(Boolean);

  if (sections.length <= 1) {
    return { excerpt: text.trim(), entryCount: 0 };
  }

  const selected = sections
    .slice(1, 1 + Math.max(1, entryCount))
    .map((section) => `### ${section}`);

  return {
    excerpt: selected.join("\n\n"),
    entryCount: selected.length,
  };
}

export function loadAgentGuidanceContext({
  repoRoot = ".",
  agentsPath = "",
  agentLearningsPath = "",
  agentsMaxChars = DEFAULT_AGENTS_MAX_CHARS,
  learningsMaxChars = DEFAULT_LEARNINGS_MAX_CHARS,
  learningsEntryCount = DEFAULT_LEARNINGS_ENTRY_COUNT,
} = {}) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot);
  const resolvedAgentsPath = resolve(resolvedRepoRoot, trim(agentsPath) || "AGENTS.md");
  const resolvedLearningsPath = resolve(
    resolvedRepoRoot,
    trim(agentLearningsPath) || "AGENT-LEARNINGS.md",
  );

  const normalizedAgentsMaxChars = toPositiveInt(agentsMaxChars, DEFAULT_AGENTS_MAX_CHARS);
  const normalizedLearningsMaxChars = toPositiveInt(learningsMaxChars, DEFAULT_LEARNINGS_MAX_CHARS);
  const normalizedLearningsEntryCount = toPositiveInt(learningsEntryCount, DEFAULT_LEARNINGS_ENTRY_COUNT);

  // @context:decision — explicit custom path uses empty-string fallback so missing
  // factory-local files don't inject placeholder noise into builder prompts;
  // default (repo root) retains the "(missing …)" marker for visibility.
  const hasExplicitAgentsPath = Boolean(trim(agentsPath));
  const hasExplicitLearningsPath = Boolean(trim(agentLearningsPath));

  const agents = readOptionalText(resolvedAgentsPath);
  const learnings = readOptionalText(resolvedLearningsPath);
  const recentLearnings = collectRecentLearningEntries(learnings.text, normalizedLearningsEntryCount);

  const agentsExcerpt = agents.found
    ? truncateText(agents.text, normalizedAgentsMaxChars, "AGENTS.md")
    : hasExplicitAgentsPath ? "" : "(missing AGENTS.md)";

  const learningsExcerptSource = recentLearnings.excerpt || learnings.text;
  const learningsExcerpt = learnings.found
    ? truncateText(learningsExcerptSource, normalizedLearningsMaxChars, "AGENT-LEARNINGS.md")
    : hasExplicitLearningsPath ? "" : "(missing AGENT-LEARNINGS.md)";

  return {
    repo_root: resolvedRepoRoot,
    agents_path: resolvedAgentsPath,
    agents_found: agents.found ? "true" : "false",
    agents_excerpt: agentsExcerpt,
    agent_learnings_path: resolvedLearningsPath,
    agent_learnings_found: learnings.found ? "true" : "false",
    agent_learnings_excerpt: learningsExcerpt,
    agent_learnings_entry_count: String(recentLearnings.entryCount),
  };
}
