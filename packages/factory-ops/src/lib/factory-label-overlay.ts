import {
  FACTORY_LABEL_CATEGORIES,
  globalFactoryLabelRegistry,
} from "./factory-label-registry.ts";

const CATEGORY_SET = new Set(FACTORY_LABEL_CATEGORIES);
const HEX_COLOR_PATTERN = /^[0-9a-f]{6}$/i;

/**
 * @typedef {"type"|"state"|"queue"|"control"|"artifact"} FactoryLabelOverlayCategory
 */

/**
 * @typedef {{
 *   name: string,
 *   category: FactoryLabelOverlayCategory,
 *   owner: string,
 *   description: string,
 *   color: string,
 *   include_by_default?: boolean,
 *   wave_ready?: boolean,
 * }} FactoryLabelOverlayEntry
 */

/**
 * @typedef {ReadonlyArray<FactoryLabelOverlayEntry>} FactoryLabelOverlay
 */

export const FACTORY_LABEL_OVERLAY_CATEGORIES = Object.freeze([...FACTORY_LABEL_CATEGORIES]);

export class FactoryLabelOverlayValidationError extends Error {
  constructor(message, { labelName = "", reason = "" } = {}) {
    super(message);
    this.name = "FactoryLabelOverlayValidationError";
    this.label_name = String(labelName || "").trim();
    this.reason = String(reason || "").trim();
  }
}

function validationError(reason, labelName = "") {
  const normalizedLabelName = String(labelName || "").trim();
  const message = normalizedLabelName
    ? `factory label overlay validation failed (${reason}) for label "${normalizedLabelName}"`
    : `factory label overlay validation failed (${reason})`;
  return new FactoryLabelOverlayValidationError(message, {
    labelName: normalizedLabelName,
    reason,
  });
}

function normalizeOverlayEntry(entry = {}) {
  const normalized = entry && typeof entry === "object" ? entry : {};
  return {
    name: String(normalized.name || "").trim(),
    category: String(normalized.category || "").trim(),
    owner: String(normalized.owner || "").trim(),
    description: String(normalized.description || "").trim(),
    color: String(normalized.color || "").trim(),
    include_by_default: normalized.include_by_default !== false,
    wave_ready: normalized.wave_ready === true,
  };
}

/**
 * @param {{
 *   overlay?: FactoryLabelOverlay,
 *   coreRegistry?: ReadonlyArray<{name:string}>
 * }} [args]
 * @returns {ReadonlyArray<FactoryLabelOverlayEntry>}
 */
export function validateFactoryLabelOverlay({
  overlay = [],
  coreRegistry = globalFactoryLabelRegistry,
} = {}) {
  if (!Array.isArray(overlay)) {
    throw validationError("overlay_not_array");
  }

  const coreNames = new Set((Array.isArray(coreRegistry) ? coreRegistry : [])
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean));

  const normalizedEntries = [];
  const seenOverlayNames = new Set();

  for (const rawEntry of overlay) {
    const entry = normalizeOverlayEntry(rawEntry);

    if (!entry.name) throw validationError("missing_name", entry.name);
    if (!entry.owner) throw validationError("missing_owner", entry.name);
    if (!entry.description) throw validationError("missing_description", entry.name);
    if (!entry.color) throw validationError("missing_color", entry.name);
    if (!HEX_COLOR_PATTERN.test(entry.color)) throw validationError("invalid_color_hex", entry.name);
    if (!CATEGORY_SET.has(entry.category)) throw validationError("invalid_category", entry.name);

    if (seenOverlayNames.has(entry.name)) throw validationError("duplicate_overlay_name", entry.name);
    seenOverlayNames.add(entry.name);

    if (coreNames.has(entry.name)) throw validationError("overlay_core_collision", entry.name);

    normalizedEntries.push(Object.freeze({ ...entry }));
  }

  return Object.freeze([...normalizedEntries]);
}

/**
 * @param {{
 *   coreRegistry?: ReadonlyArray<object>,
 *   overlay?: FactoryLabelOverlay
 * }} [args]
 * @returns {ReadonlyArray<object>}
 */
export function mergeFactoryLabelRegistryOverlay({
  coreRegistry = globalFactoryLabelRegistry,
  overlay = [],
} = {}) {
  const core = Array.isArray(coreRegistry) ? [...coreRegistry] : [];
  const validatedOverlay = validateFactoryLabelOverlay({
    overlay,
    coreRegistry: core,
  });
  return Object.freeze([...core, ...validatedOverlay]);
}
