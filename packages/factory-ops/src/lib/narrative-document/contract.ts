import { assertTaxonomyValue } from "./taxonomy.ts";

const REQUIRED_ROOT_FIELDS = ["title", "sections", "metadata"];
const REQUIRED_METADATA_FIELDS = ["taxonomy"];
const ALLOWED_ASTROCHICKEN_FIELDS = new Set(["backlinks", "privacy", "internal_note"]);
const ALLOWED_BACKLINK_FIELDS = new Set(["canonical_issue", "related_issues", "related_prs"]);
const ALLOWED_PRIVACY_FIELDS = new Set(["publishable", "contains_internal_only"]);

function trim(value = "") {
  return String(value || "").trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) {
    throw new Error(`${label}:not_object`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label}:not_array`);
  }
  return value;
}

function assertNoUnknownKeys(value = {}, allowedKeys = new Set(), label = "object") {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}:unknown_key:${key}`);
    }
  }
}

function assertOptionalString(value, label) {
  if (value === undefined) return;
  if (!trim(value)) {
    throw new Error(`${label}:empty`);
  }
}

function assertIssueRefArray(value, label) {
  const arr = assertArray(value, label);
  for (const entry of arr) {
    if (!trim(entry)) {
      throw new Error(`${label}:contains_empty`);
    }
  }
}

function assertAstrochickenBacklinks(backlinks = {}) {
  const normalized = assertObject(backlinks, "narrative_document.astrochicken.backlinks");
  assertNoUnknownKeys(normalized, ALLOWED_BACKLINK_FIELDS, "narrative_document.astrochicken.backlinks");

  if (normalized.canonical_issue !== undefined) {
    if (!trim(normalized.canonical_issue)) {
      throw new Error("narrative_document.astrochicken.backlinks.canonical_issue:empty");
    }
  }
  if (normalized.related_issues !== undefined) {
    assertIssueRefArray(normalized.related_issues, "narrative_document.astrochicken.backlinks.related_issues");
  }
  if (normalized.related_prs !== undefined) {
    assertIssueRefArray(normalized.related_prs, "narrative_document.astrochicken.backlinks.related_prs");
  }
}

function assertAstrochickenPrivacy(privacy = {}) {
  const normalized = assertObject(privacy, "narrative_document.astrochicken.privacy");
  assertNoUnknownKeys(normalized, ALLOWED_PRIVACY_FIELDS, "narrative_document.astrochicken.privacy");

  if (typeof normalized.publishable !== "boolean") {
    throw new Error("narrative_document.astrochicken.privacy.publishable:must_be_boolean");
  }
  if (typeof normalized.contains_internal_only !== "boolean") {
    throw new Error("narrative_document.astrochicken.privacy.contains_internal_only:must_be_boolean");
  }
}

function assertSections(sections = []) {
  const normalized = assertArray(sections, "narrative_document.sections");
  if (normalized.length < 1) {
    throw new Error("narrative_document.sections:empty");
  }

  for (const section of normalized) {
    const sectionObject = assertObject(section, "narrative_document.sections.entry");
    if (!trim(sectionObject.heading)) {
      throw new Error("narrative_document.sections.entry.heading:missing");
    }
    if (!trim(sectionObject.body)) {
      throw new Error("narrative_document.sections.entry.body:missing");
    }
  }
}

function assertMetadata(metadata = {}) {
  const normalized = assertObject(metadata, "narrative_document.metadata");
  for (const key of REQUIRED_METADATA_FIELDS) {
    if (!(key in normalized)) {
      throw new Error(`narrative_document.metadata:missing_required:${key}`);
    }
  }

  const taxonomy = normalized.taxonomy;
  const values = Array.isArray(taxonomy) ? taxonomy : [taxonomy];
  if (values.length < 1) {
    throw new Error("narrative_document.metadata.taxonomy:empty");
  }
  for (const value of values) {
    assertTaxonomyValue(value);
  }
}

function assertAstrochicken(astrochicken = {}) {
  const normalized = assertObject(astrochicken, "narrative_document.astrochicken");
  assertNoUnknownKeys(normalized, ALLOWED_ASTROCHICKEN_FIELDS, "narrative_document.astrochicken");

  if (normalized.backlinks !== undefined) {
    assertAstrochickenBacklinks(normalized.backlinks);
  }
  if (normalized.privacy !== undefined) {
    assertAstrochickenPrivacy(normalized.privacy);
  }
  if (normalized.internal_note !== undefined) {
    assertOptionalString(normalized.internal_note, "narrative_document.astrochicken.internal_note");
  }
}

export function assertNarrativeDocumentContract(document = {}) {
  const normalized = assertObject(document, "narrative_document");

  for (const key of REQUIRED_ROOT_FIELDS) {
    if (!(key in normalized)) {
      throw new Error(`narrative_document:missing_required:${key}`);
    }
  }

  if (!trim(normalized.title)) {
    throw new Error("narrative_document.title:missing");
  }

  assertSections(normalized.sections);
  assertMetadata(normalized.metadata);

  if (normalized.astrochicken !== undefined) {
    assertAstrochicken(normalized.astrochicken);
  }

  return normalized;
}
