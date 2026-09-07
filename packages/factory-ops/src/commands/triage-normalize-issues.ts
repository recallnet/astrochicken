import { trim, parseJson } from "../lib/cli-helpers.ts";

export function normalizeIssueUrls(raw = "[]") {
  const data = parseJson(String(raw || "[]"), []);
  const items = [];
  for (const entry of Array.isArray(data) ? data : []) {
    const url = String(entry || "").trim();
    if (!url) continue;
    const m = url.match(/\/issues\/(\d+)/);
    if (!m) continue;
    items.push({ issue_number: Number(m[1]), url });
  }
  return items;
}
