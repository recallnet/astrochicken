function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStrictString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeIssueUrlEntry(entry: unknown): string {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return "";
    if (/\/issues\/\d+$/.test(trimmed)) return trimmed;
    try {
      return normalizeIssueUrlEntry(JSON.parse(trimmed));
    } catch {
      return "";
    }
  }

  if (!isPlainObject(entry)) return "";
  return normalizeStrictString(entry.issue_url);
}

export function normalizeIssueUrlArray(raw: string = "[]"): string {
  let parsed: unknown[] = [];
  try {
    parsed = JSON.parse(String(raw || "[]"));
  } catch {
    parsed = [];
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(parsed) ? parsed : []) {
    const url = normalizeIssueUrlEntry(entry);
    if (!url) continue;
    if (!/\/issues\/\d+$/.test(url)) continue;
    if (seen.has(url)) continue;
    urls.push(url);
    seen.add(url);
  }
  return JSON.stringify(urls);
}
