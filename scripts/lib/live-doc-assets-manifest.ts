import { matchesDocsTemplateFrameworkPattern } from "./docs-template-framework.ts";

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

export const LIVE_DOC_ASSET_MANIFEST_VERSION = "live_doc_assets/v1";

export const LIVE_DOC_ASSET_GLOBS_DESCRIPTION =
  "Contract-bearing docs/skills/templates that define the shipped factory workflow.";

export const ARCHIVED_DOC_GLOBS_DESCRIPTION =
  "Quarantined historical docs that must stay neutral and outside live contract gating.";

export const LIVE_DOC_ASSET_GLOBS = Object.freeze(sortedUnique([
  "docs/agent-runbooks/**",
  "docs/factory-supervisor-tick.md",
  "docs/langfuse-kpis.md",
  "docs/runbooks/**",
  "docs/skills/**",
  "docs/templates/**",
  "factories/mothership/skills/**",
]));

export const ARCHIVED_DOC_GLOBS = Object.freeze(sortedUnique([
  "docs/archive/**",
  "docs/skills/factory-design-workspace/**",
]));

/**
 * @param {string} pathValue
 */
export function isArchivedDocPath(pathValue) {
  return ARCHIVED_DOC_GLOBS.some((pattern) => matchesDocsTemplateFrameworkPattern(pathValue, pattern));
}

/**
 * @param {string} pathValue
 */
export function isLiveDocAssetPath(pathValue) {
  if (isArchivedDocPath(pathValue)) {
    return false;
  }

  return LIVE_DOC_ASSET_GLOBS.some((pattern) => matchesDocsTemplateFrameworkPattern(pathValue, pattern));
}
