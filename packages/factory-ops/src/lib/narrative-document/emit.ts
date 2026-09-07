import {
  normalizeNarrativeDocument,
  validateNarrativeDocument,
} from "../narrative-document-contract.ts";
import { assertNarrativeDocumentContract } from "./contract.ts";
import { serializeNarrativeDocumentToMarkdown } from "./markdown-shape.ts";
import { assertTaxonomyValue, matchesTaxonomy } from "./taxonomy.ts";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trim(value = "") {
  return String(value ?? "").trim();
}

function toStringArray(value) {
  if (value === undefined) return undefined;
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function coerceTaxonomyValues(taxonomy) {
  const values = Array.isArray(taxonomy) ? taxonomy : [taxonomy];
  return values.map((value) => trim(value));
}

function mergeAstrochicken(baseAstro, overrideAstro) {
  const base = isObject(baseAstro) ? baseAstro : {};
  const override = isObject(overrideAstro) ? overrideAstro : {};

  const backlinks = {
    ...(isObject(base.backlinks) ? base.backlinks : {}),
    ...(isObject(override.backlinks) ? override.backlinks : {}),
  };

  const privacy = {
    ...(isObject(base.privacy) ? base.privacy : {}),
    ...(isObject(override.privacy) ? override.privacy : {}),
  };

  const merged = {};
  if (Object.keys(backlinks).length > 0) merged.backlinks = backlinks;
  if (Object.keys(privacy).length > 0) merged.privacy = privacy;

  if (override.internal_note !== undefined) {
    merged.internal_note = override.internal_note;
  } else if (base.internal_note !== undefined) {
    merged.internal_note = base.internal_note;
  }

  return merged;
}

function normalizeAstroContext(astroContext = {}) {
  const source = isObject(astroContext?.astrochicken) ? astroContext.astrochicken : astroContext;
  if (!isObject(source)) return {};

  const backlinks = {
    ...(isObject(source.backlinks) ? source.backlinks : {}),
  };

  const canonicalIssue = trim(backlinks.canonical_issue || source.canonical_issue || source.canonical_issue_url);
  if (canonicalIssue) backlinks.canonical_issue = canonicalIssue;

  if (source.related_issues !== undefined && backlinks.related_issues === undefined) {
    backlinks.related_issues = toStringArray(source.related_issues);
  }
  if (source.related_prs !== undefined && backlinks.related_prs === undefined) {
    backlinks.related_prs = toStringArray(source.related_prs);
  }

  const privacy = {
    ...(isObject(source.privacy) ? source.privacy : {}),
  };

  if (typeof source.publishable === "boolean" && typeof privacy.publishable !== "boolean") {
    privacy.publishable = source.publishable;
  }
  if (typeof source.contains_internal_only === "boolean" && typeof privacy.contains_internal_only !== "boolean") {
    privacy.contains_internal_only = source.contains_internal_only;
  }

  const visibility = trim(source.visibility);
  if (visibility === "public") {
    if (typeof privacy.publishable !== "boolean") privacy.publishable = true;
    if (typeof privacy.contains_internal_only !== "boolean") privacy.contains_internal_only = false;
  }
  if (visibility === "internal-only") {
    if (typeof privacy.publishable !== "boolean") privacy.publishable = false;
    if (typeof privacy.contains_internal_only !== "boolean") privacy.contains_internal_only = true;
  }

  const normalized = {};
  if (Object.keys(backlinks).length > 0) normalized.backlinks = backlinks;
  if (Object.keys(privacy).length > 0) normalized.privacy = privacy;

  if (source.internal_note !== undefined) {
    normalized.internal_note = String(source.internal_note);
  }

  return normalized;
}

function normalizeSections(sections = []) {
  const source = Array.isArray(sections) ? sections : [];
  return source.map((section = {}) => ({
    heading: trim(section.heading),
    body: trim(section.body),
  }));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = trim(value);
    if (normalized) return normalized;
  }
  return "";
}

function deriveVisibilityFromPrivacy(privacy = {}) {
  if (!isObject(privacy)) return "";
  if (privacy.contains_internal_only === true) return "internal-only";
  if (privacy.publishable === true) return "public";
  if (privacy.publishable === false) return "internal-only";
  return "";
}

function buildMetadataContractCandidate({ documentJson = {}, metadata = {}, astroContext = {}, taxonomyValues = [] } = {}) {
  const sourceMetadata = isObject(metadata) ? metadata : {};
  const { taxonomy: _ignoredTaxonomy, ...metadataWithoutTaxonomy } = sourceMetadata;
  const sourceAstro = isObject(metadataWithoutTaxonomy.astro) ? metadataWithoutTaxonomy.astro : {};
  const astroFromContext = normalizeAstroContext(astroContext);
  const documentAstro = isObject(documentJson.astrochicken) ? documentJson.astrochicken : {};

  const canonicalIssueUrl = firstNonEmpty(
    sourceAstro.canonical_issue_url,
    documentAstro.backlinks?.canonical_issue,
    astroFromContext.backlinks?.canonical_issue,
  );

  const visibility = firstNonEmpty(
    sourceAstro.visibility,
    deriveVisibilityFromPrivacy(documentAstro.privacy),
    deriveVisibilityFromPrivacy(astroFromContext.privacy),
  );

  const internalOnlySections = toStringArray(
    sourceAstro.internal_only_sections
    ?? astroContext?.internal_only_sections
    ?? astroContext?.astrochicken?.internal_only_sections,
  );

  const metadataCategory = trim(sourceMetadata.category);
  if (metadataCategory && taxonomyValues.length > 0 && !taxonomyValues.includes(metadataCategory)) {
    throw new Error(`narrative_document_metadata_category_mismatch:${metadataCategory}`);
  }

  return {
    ...metadataWithoutTaxonomy,
    title: firstNonEmpty(sourceMetadata.title, documentJson.title),
    summary: firstNonEmpty(sourceMetadata.summary, documentJson.abstract, documentJson.sections?.[0]?.body),
    category: metadataCategory || taxonomyValues[0] || "",
    astro: {
      ...sourceAstro,
      canonical_issue_url: canonicalIssueUrl,
      visibility,
      ...(internalOnlySections !== undefined ? { internal_only_sections: internalOnlySections } : {}),
    },
  };
}

export function emitNarrativeDocument({
  document = {},
  metadata = {},
  astroContext = {},
  outputPath = "",
} = {}) {
  const sourceDocument = isObject(document) ? document : {};
  const sourceMetadata = isObject(metadata) ? metadata : {};
  const normalizedAstro = mergeAstrochicken(sourceDocument.astrochicken, normalizeAstroContext(astroContext));

  const documentJson = {
    title: trim(sourceDocument.title || sourceMetadata.title),
    sections: normalizeSections(sourceDocument.sections),
    metadata: {
      ...(isObject(sourceDocument.metadata) ? sourceDocument.metadata : {}),
      ...sourceMetadata,
    },
    ...(trim(sourceDocument.abstract) ? { abstract: trim(sourceDocument.abstract) } : {}),
    ...(Object.keys(normalizedAstro).length > 0 ? { astrochicken: normalizedAstro } : {}),
  };

  const taxonomyValues = coerceTaxonomyValues(documentJson.metadata?.taxonomy)
    .map((value) => assertTaxonomyValue(value));

  for (const taxonomyValue of taxonomyValues) {
    if (!matchesTaxonomy(taxonomyValue)) {
      throw new Error(`narrative_taxonomy_invalid:${taxonomyValue}`);
    }
  }

  const validatedDocument = assertNarrativeDocumentContract(documentJson);

  const metadataContractCandidate = buildMetadataContractCandidate({
    documentJson: validatedDocument,
    metadata: sourceMetadata,
    astroContext,
    taxonomyValues,
  });

  const normalizedMetadata = normalizeNarrativeDocument(metadataContractCandidate);
  const metadataValidation = validateNarrativeDocument(normalizedMetadata);
  if (!metadataValidation.ok) {
    throw new Error(`narrative_document_metadata_contract_invalid:${metadataValidation.errors.join(",")}`);
  }

  const markdown = serializeNarrativeDocumentToMarkdown(validatedDocument);

  return {
    documentJson: validatedDocument,
    markdown,
    metadata: normalizedMetadata,
    ...(trim(outputPath) ? { outputPath: trim(outputPath) } : {}),
  };
}
