import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { DEFAULT_SCENARIO_REGISTRY_ROOT } from "../lib/scenario-registry.ts";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRIORITY_RE = /^(critical|high|medium|low)$/;
const CREATED_RE = /^\d{4}-\d{2}-\d{2}$/;

function toAbsolute(pathValue = "", fallback = "") {
  const raw = trim(pathValue);
  const chosen = raw || trim(fallback);
  if (!chosen) return "";
  return isAbsolute(chosen) ? chosen : resolve(process.cwd(), chosen);
}

function normalizeTruthLines(truth = "") {
  return String(truth || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => trim(line))
    .filter(Boolean);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildScenarioMarkdown({ id = "", domain = "", priority = "", created = "", truthLines = [] } = {}) {
  const frontmatter = [
    "---",
    `id: ${id}`,
    `domain: ${domain}`,
    `priority: ${priority}`,
    `created: ${created}`,
    "status: active",
    "authors: [scenario-ops]",
    "---",
  ].join("\n");

  return `${frontmatter}\n\n${truthLines.join("\n")}\n`;
}

export function scenarioAdd({
  registryRoot = DEFAULT_SCENARIO_REGISTRY_ROOT,
  id = "",
  domain = "",
  priority = "",
  truth = "",
  created = "",
} = {}) {
  const scenarioId = trim(id);
  const scenarioDomain = trim(domain);
  const scenarioPriority = trim(priority).toLowerCase();
  const scenarioCreated = trim(created) || todayIsoDate();
  const truthLines = normalizeTruthLines(truth);
  const resolvedRegistryRoot = toAbsolute(registryRoot, DEFAULT_SCENARIO_REGISTRY_ROOT);

  if (!ID_RE.test(scenarioId)) {
    return {
      ok: false,
      error: "id must be kebab-case",
      path: "",
    };
  }

  if (!DOMAIN_RE.test(scenarioDomain)) {
    return {
      ok: false,
      error: "domain must be kebab-case",
      path: "",
    };
  }

  if (!PRIORITY_RE.test(scenarioPriority)) {
    return {
      ok: false,
      error: "priority must be critical|high|medium|low",
      path: "",
    };
  }

  if (!CREATED_RE.test(scenarioCreated)) {
    return {
      ok: false,
      error: "created must be YYYY-MM-DD",
      path: "",
    };
  }

  if (truthLines.length < 1 || truthLines.length > 5) {
    return {
      ok: false,
      error: "truth must contain 1-5 non-empty lines",
      path: "",
    };
  }

  const outputDir = join(resolvedRegistryRoot, scenarioDomain, scenarioId);
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "SCENARIO.md");

  writeFileSync(
    outputPath,
    buildScenarioMarkdown({
      id: scenarioId,
      domain: scenarioDomain,
      priority: scenarioPriority,
      created: scenarioCreated,
      truthLines,
    }),
    "utf8",
  );

  return {
    ok: true,
    error: "",
    path: outputPath,
    registry_root: resolvedRegistryRoot,
    scenario_id: scenarioId,
    domain: scenarioDomain,
    priority: scenarioPriority,
    created: scenarioCreated,
    truth_line_count: String(truthLines.length),
    status: "active",
    authors: ["scenario-ops"],
  };
}
