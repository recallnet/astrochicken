import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAXONOMY_ALLOWLIST_PATH = fileURLToPath(new URL("../../../../../config/narrative/taxonomy-allowlist.json", import.meta.url));

function normalizeTaxonomyValue(value = "") {
  return String(value || "").trim();
}

function loadTaxonomyAllowlist(path = TAXONOMY_ALLOWLIST_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`narrative_taxonomy_allowlist_load_failed:${String(error?.message || error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length < 1) {
    throw new Error("narrative_taxonomy_allowlist_invalid:not_array");
  }

  const normalized = parsed
    .map((value) => normalizeTaxonomyValue(value))
    .filter(Boolean);

  if (normalized.length !== parsed.length) {
    throw new Error("narrative_taxonomy_allowlist_invalid:contains_empty_entries");
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new Error("narrative_taxonomy_allowlist_invalid:contains_duplicates");
  }

  return Object.freeze(normalized);
}

const TAXONOMY_ALLOWLIST = loadTaxonomyAllowlist();
const TAXONOMY_ALLOWLIST_SET = new Set(TAXONOMY_ALLOWLIST);

export function getNarrativeTaxonomyAllowlist() {
  return [...TAXONOMY_ALLOWLIST];
}

export function matchesTaxonomy(value = "") {
  return TAXONOMY_ALLOWLIST_SET.has(normalizeTaxonomyValue(value));
}

export function assertTaxonomyValue(value = "") {
  const normalized = normalizeTaxonomyValue(value);
  if (!normalized) throw new Error("narrative_taxonomy_invalid:(empty)");
  if (!matchesTaxonomy(normalized)) {
    throw new Error(`narrative_taxonomy_invalid:${normalized}`);
  }
  return normalized;
}

export { TAXONOMY_ALLOWLIST_PATH };
