export const TAXONOMY_CATEGORIES = Object.freeze([
  "factory-health",
  "delivery",
  "quality",
  "operations",
  "strategy",
]);

export const PUBLISH_MODES = Object.freeze(["public", "internal-only"]);

export const ASTRO_EXTENSION_KEYS = Object.freeze([
  "canonical_issue_url",
  "visibility",
  "internal_only_sections",
]);

const ALLOWED_ROOT_KEYS = new Set([
  "title",
  "summary",
  "category",
  "published_on",
  "tags",
  "topics",
  "astro",
]);

const ALLOWED_ASTRO_KEYS = new Set(ASTRO_EXTENSION_KEYS);
const TAXONOMY_CATEGORIES_SET = new Set(TAXONOMY_CATEGORIES);
const PUBLISH_MODES_SET = new Set(PUBLISH_MODES);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trim(value = "") {
  return String(value ?? "").trim();
}

function coerceStringArray(value) {
  if (value === undefined) return undefined;
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function looksLikeUrl(value = "") {
  const normalized = trim(value);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeNarrativeDocument(metadata = {}) {
  if (!isPlainObject(metadata)) return {};

  const normalized = {
    title: trim(metadata.title),
    summary: trim(metadata.summary),
    category: trim(metadata.category),
  };

  if (metadata.published_on !== undefined) {
    normalized.published_on = trim(metadata.published_on);
  }

  if (metadata.tags !== undefined) {
    normalized.tags = coerceStringArray(metadata.tags);
  }

  if (metadata.topics !== undefined) {
    normalized.topics = coerceStringArray(metadata.topics);
  }

  if (metadata.astro !== undefined && isPlainObject(metadata.astro)) {
    const astro = {};

    if (metadata.astro.canonical_issue_url !== undefined) {
      astro.canonical_issue_url = trim(metadata.astro.canonical_issue_url);
    }

    if (metadata.astro.visibility !== undefined) {
      astro.visibility = trim(metadata.astro.visibility);
    }

    if (metadata.astro.internal_only_sections !== undefined) {
      astro.internal_only_sections = coerceStringArray(metadata.astro.internal_only_sections);
    }

    normalized.astro = astro;
  }

  return normalized;
}

export function validateNarrativeDocument(metadata = {}) {
  const errors = [];
  const warnings = [];

  const isObject = isPlainObject(metadata);
  const normalized = normalizeNarrativeDocument(metadata);

  if (!isObject) {
    errors.push("metadata:not_plain_object");
  }

  const rootKeys = isObject ? Object.keys(metadata) : [];
  const unknownRootKeys = rootKeys.filter((key) => !ALLOWED_ROOT_KEYS.has(key));
  if (unknownRootKeys.length > 0) {
    errors.push(`metadata:unknown_keys:${unknownRootKeys.join(",")}`);
  }

  if (!normalized.title) {
    errors.push("metadata:title:required");
  }

  if (!normalized.summary) {
    errors.push("metadata:summary:required");
  }

  if (!normalized.category) {
    errors.push("metadata:category:required");
  } else if (!TAXONOMY_CATEGORIES_SET.has(normalized.category)) {
    errors.push(`metadata:category:invalid:${normalized.category}`);
  }

  if (metadata.tags !== undefined && !Array.isArray(metadata.tags)) {
    warnings.push("metadata:tags:coerced_to_array");
  }

  if (metadata.topics !== undefined && !Array.isArray(metadata.topics)) {
    warnings.push("metadata:topics:coerced_to_array");
  }

  if (metadata.astro !== undefined) {
    if (!isPlainObject(metadata.astro)) {
      errors.push("metadata:astro:not_object");
    } else {
      const astroKeys = Object.keys(metadata.astro);
      const unknownAstroKeys = astroKeys.filter((key) => !ALLOWED_ASTRO_KEYS.has(key));
      if (unknownAstroKeys.length > 0) {
        errors.push(`metadata:astro:unknown_keys:${unknownAstroKeys.join(",")}`);
      }

      if (metadata.astro.visibility !== undefined) {
        if (!PUBLISH_MODES_SET.has(normalized.astro?.visibility || "")) {
          errors.push(`metadata:astro:visibility:invalid:${trim(metadata.astro.visibility)}`);
        }
      }

      if (metadata.astro.internal_only_sections !== undefined) {
        if (!Array.isArray(metadata.astro.internal_only_sections)) {
          errors.push("metadata:astro:internal_only_sections:not_array");
        } else {
          metadata.astro.internal_only_sections.forEach((section, index) => {
            if (typeof section !== "string" || !trim(section)) {
              errors.push(`metadata:astro:internal_only_sections:invalid_entry:${index}`);
            }
          });
        }
      }

      if (metadata.astro.canonical_issue_url !== undefined) {
        if (!looksLikeUrl(metadata.astro.canonical_issue_url)) {
          errors.push("metadata:astro:canonical_issue_url:invalid_url");
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      taxonomy_allowlist_size: TAXONOMY_CATEGORIES.length,
      publish_mode_allowlist_size: PUBLISH_MODES.length,
      root_key_count: rootKeys.length,
      unknown_root_key_count: unknownRootKeys.length,
      has_astro_extension: Boolean(isObject && metadata.astro !== undefined),
      normalized_tags_count: normalized.tags?.length || 0,
      normalized_topics_count: normalized.topics?.length || 0,
      normalized_internal_only_sections_count: normalized.astro?.internal_only_sections?.length || 0,
    },
  };
}
