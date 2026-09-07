/**
 * @hatch/factory-core — Transport utilities
 *
 * Safe transport of structured data through DOT graph tool node arguments.
 * Handles base64 encoding/decoding, JSON payload resolution from multiple
 * sources (flags, base64 flags, stdin), and flag parsing for values that
 * arrive as strings from shell commands.
 *
 * These utilities solve the shell interpolation problem: when DOT graph
 * variable values contain quotes, newlines, or metacharacters, raw string
 * transport breaks. Base64 transport provides a safe channel.
 */

/**
 * Decode a base64-encoded UTF-8 string. Returns "" on empty or bad input.
 */
export function decodeBase64Utf8(raw: string = ""): string {
  const normalized = String(raw || "").replace(/\s+/g, "");
  if (!normalized) return "";
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Encode a UTF-8 string to base64.
 */
export function encodeBase64Utf8(value: string = ""): string {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

/**
 * Decode a base64-encoded UTF-8 string when the input is valid base64;
 * otherwise return the input verbatim.
 *
 * This keeps DOT command transports deterministic when graphs send
 * literal payloads through legacy "-b64" flags without shell wrappers.
 */
export function decodeBase64Utf8OrRaw(raw: string = ""): string {
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
export function resolveB64OrRaw(raw: unknown, b64: unknown, flagName: string = "flag"): string {
  const hasRaw = raw !== undefined && raw !== null;
  const hasB64 = b64 !== undefined && b64 !== null;
  if (hasRaw && hasB64)
    throw new Error(
      `${flagName} accepts one transport: --${flagName} or --${flagName}-b64`
    );
  if (hasB64) return decodeBase64Utf8(b64 as string);
  return (raw as string) ?? "";
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
}: { flag?: unknown; flagB64?: unknown; flagName?: string; allowStdin?: boolean } = {}): Promise<string> {
  const hasRaw = flag !== undefined && flag !== null;
  const hasB64 = flagB64 !== undefined && flagB64 !== null;

  if (hasRaw && hasB64) {
    throw new Error(
      `${flagName} accepts one transport: --${flagName} or --${flagName}-b64`
    );
  }

  if (hasRaw) return String(flag ?? "");
  if (hasB64) return decodeBase64Utf8(flagB64 as string);
  if (allowStdin) return readStdin();

  return "";
}

/**
 * Read all of stdin as a UTF-8 string. Returns "" if stdin is a TTY or
 * no data arrives within timeoutMs (default 500ms). The timeout prevents
 * hanging when invoked by the Hatch tool handler, which pipes stdin but
 * never sends data or closes the pipe.
 */
export async function readStdin(timeoutMs: number = 500): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let resolved = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("end");
      process.stdin.removeAllListeners("error");
      resolve(
        chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : ""
      );
    }, timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => {
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

/**
 * Parse a string flag value as boolean.
 * Treats "true", "1", "yes" (case-insensitive) as true; everything else as false.
 * Use this for flags that DOT graphs pass as --flag 'true'/'false' (not clipanion Boolean).
 */
export function parseBoolFlag(value: unknown, fallback: boolean = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(true|1|yes)$/i.test(String(value).trim());
}

/**
 * Parse a string to a positive number, returning fallback if invalid.
 */
export function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse a string to a non-negative number, returning fallback if invalid.
 */
export function parseNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
