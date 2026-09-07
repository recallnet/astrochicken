import camelcaseKeys from "camelcase-keys";

/**
 * Decode a base64-encoded UTF-8 string. Returns "" on empty or bad input.
 */
export function decodeBase64Utf8(raw = "") {
  const normalized = String(raw || "").replace(/\s+/g, "");
  if (!normalized) return "";
  try { return Buffer.from(normalized, "base64").toString("utf8"); } catch { return ""; }
}

/**
 * Decode a base64-encoded UTF-8 string when the input is valid base64;
 * otherwise return the input verbatim.
 *
 * This keeps DOT command transports deterministic when graphs send
 * literal payloads through legacy "-b64" flags without shell wrappers.
 */
export function decodeBase64Utf8OrRaw(raw = "") {
  const input = String(raw || "");
  if (!input) return "";

  // Preserve obvious non-base64 payloads verbatim.
  if (/\s/.test(input)) return input;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) return input;
  if (input.length % 4 !== 0) return input;

  try {
    const decoded = Buffer.from(input, "base64").toString("utf8");
    const roundTrip = Buffer.from(decoded, "utf8").toString("base64");
    return roundTrip === input ? decoded : input;
  } catch {
    return input;
  }
}

/**
 * Resolve a flag that may arrive as --flag or --flag-b64.
 * Returns the decoded string value. Throws if both are provided.
 */
export function resolveB64OrRaw(raw, b64, flagName = "flag") {
  const hasRaw = raw !== undefined && raw !== null;
  const hasB64 = b64 !== undefined && b64 !== null;
  if (hasRaw && hasB64) throw new Error(`${flagName} accepts one transport: --${flagName} or --${flagName}-b64`);
  if (hasB64) return decodeBase64Utf8(b64);
  return raw ?? "";
}

/**
 * Resolve JSON payload transport from --flag / --flag-b64 / stdin.
 *
 * Precedence is deterministic:
 * 1) raw flag
 * 2) base64 flag
 * 3) stdin (only when allowStdin=true)
 * 4) empty string
 *
 * Throws when both raw and base64 transports are provided.
 */
export async function resolveJsonPayload({
  flag,
  flagB64,
  flagName = "payload",
  allowStdin = false,
} = {}) {
  const hasRaw = flag !== undefined && flag !== null;
  const hasB64 = flagB64 !== undefined && flagB64 !== null;

  if (hasRaw && hasB64) {
    throw new Error(`${flagName} accepts one transport: --${flagName} or --${flagName}-b64`);
  }

  if (hasRaw) return String(flag ?? "");
  if (hasB64) return decodeBase64Utf8(flagB64);
  if (allowStdin) return readStdin();

  return "";
}

/**
 * Convert CLI flag map (kebab-case) to camelCase for internal use.
 */
export function flagsToCamel(obj) {
  return camelcaseKeys(obj, { deep: false });
}

/**
 * Parse a string to a positive number, returning fallback if invalid.
 */
export function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse a string to a non-negative number, returning fallback if invalid.
 */
export function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Parse a string flag value as boolean.
 * Treats "true", "1", "yes" (case-insensitive) as true; everything else as false.
 * Use this for flags that DOT graphs pass as --flag 'true'/'false' (not clipanion Boolean).
 */
export function parseBoolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(true|1|yes)$/i.test(String(value).trim());
}

export function parseJsonObjectFlag({
  raw = "",
  flagName = "json-flag",
} = {}) {
  const text = String(raw || "").trim();
  if (!text) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: `--${flagName} must be a JSON object map` };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: `--${flagName} invalid JSON: ${String(error?.message || error || "invalid_json")}` };
  }
}

/**
 * Read all of stdin as a UTF-8 string. Returns "" if stdin is a TTY or
 * no data arrives within timeoutMs (default 500ms). The timeout prevents
 * hanging when invoked by the Hatch tool handler, which pipes stdin but
 * never sends data or closes the pipe.
 */
export async function readStdin(timeoutMs = 500) {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  let resolved = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("end");
      process.stdin.removeAllListeners("error");
      resolve(chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "");
    }, timeoutMs);
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve("");
    });
    process.stdin.resume();
  });
}
