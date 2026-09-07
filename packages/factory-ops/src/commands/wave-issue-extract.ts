import { parseJson } from "../lib/cli-helpers.ts";

export function extractIssueItem(raw = "{}") {
  const item = typeof raw === "string" ? parseJson(raw || "{}", {}) : (raw || {});
  return {
    issue_number: String(item.issue_number ?? ""),
    issue_title: String(item.issue_title ?? ""),
  };
}
