import { trim } from "../lib/cli-helpers.ts";

function decodeBase64Utf8(value = "") {
  const raw = trim(value);
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function extractBuilderNotes(output = "") {
  const raw = String(output || "").trim();
  if (!raw) return "";
  const match = raw.match(/(?:^|\n)BUILDER_NOTES:\s*([\s\S]*?)\s*$/i);
  return match ? trim(match[1]) : "";
}

export function resolveBuilderNotes({ builderOutput = "", builderNotesB64 = "" } = {}) {
  const decoded = decodeBase64Utf8(builderNotesB64);
  return trim(extractBuilderNotes(decoded) || decoded || extractBuilderNotes(builderOutput));
}
