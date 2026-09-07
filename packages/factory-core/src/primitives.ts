/**
 * @hatch/factory-core — Common primitives
 *
 * Domain-independent utilities used by factory ops CLIs:
 * string resolution with fallbacks, counter operations,
 * JSON counting, approval/decision normalization, and
 * text processing helpers.
 */

import { readFileSync } from "node:fs";

/**
 * Return the first non-empty trimmed string, or the fallback.
 */
export function resolveDefault(value: string = "", fallback: string = ""): string {
  const v = String(value || "").trim();
  return v || String(fallback || "").trim();
}

/**
 * Read a top-level key from factory.config.json.
 * Supports dot-notation for nested keys (e.g., "models.primary").
 */
export function resolveFactoryConfigValue({
  key = "",
  fallback = "",
  configPath = "factory.config.json",
}: { key?: string; fallback?: string; configPath?: string } = {}): string {
  const k = String(key || "").trim();
  const fb = String(fallback || "").trim();
  if (!k) return fb;

  try {
    const raw = readFileSync(String(configPath), "utf8");
    const parsed = JSON.parse(raw);
    const parts = k.split(".");
    let value: unknown = parsed;
    for (const part of parts) {
      if (value === undefined || value === null) return fb;
      value = (value as Record<string, unknown>)[part];
    }
    if (value === undefined || value === null) return fb;
    const normalized = String(value).trim();
    return normalized || fb;
  } catch {
    return fb;
  }
}

/**
 * Normalize a string value to "true" or "false".
 */
export function resolveBoolean(value: string = "", fallback: boolean = false): string {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return fallback ? "true" : "false";
  return ["1", "true", "yes", "y", "on"].includes(v) ? "true" : "false";
}

/**
 * Normalize an approval value to "true" or "false".
 */
export function normalizeApproved(value: string = ""): string {
  const v = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes"].includes(v) ? "true" : "false";
}

/**
 * Normalize a gate decision to "approved" or "revise".
 */
export function normalizeDecision(value: string = ""): string {
  const v = String(value || "").trim().toLowerCase();
  return v === "approved" ? "approved" : "revise";
}

/**
 * Increment a counter value (string in, string out).
 */
export function incrementCounter(value: string = "0"): string {
  const raw = String(value || "0").trim();
  const n = Number.parseInt(raw, 10);
  return String((Number.isFinite(n) ? n : 0) + 1);
}

/**
 * Count items in a JSON array string. Returns "0" on parse failure.
 */
export function countJsonItems(raw: string = ""): string {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return String(Array.isArray(parsed) ? parsed.length : 0);
  } catch {
    return "0";
  }
}

/**
 * Strip markdown JSON code fences from a string.
 * Handles ```json ... ``` wrapping.
 */
export function stripMarkdownJsonFences(input: string = ""): string {
  const s = String(input || "").trim();
  const fenced = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return s;
}

/**
 * Check if a value is a plain object (not null, not array).
 */
export function isPlainObject(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Create a URL-safe slug from a string.
 */
export function slugify(value: string = ""): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
