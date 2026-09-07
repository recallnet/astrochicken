import { parseJson } from "../lib/cli-helpers.ts";

export function zipFeaturesToIssues({ featuresRaw = "[]", issueIndexRaw = "[]" } = {}) {
  const features = parseJson(String(featuresRaw || "[]"), []);
  const issues = parseJson(String(issueIndexRaw || "[]"), []);
  const items = [];
  for (let i = 0; i < (Array.isArray(features) ? features.length : 0); i++) {
    const feature = features[i];
    const issue = Array.isArray(issues) && i < issues.length ? issues[i] : {};
    const num = Number(issue?.issue_number);
    if (!Number.isFinite(num) || num <= 0) continue;
    items.push({
      issue_number: num,
      issue_url: issue?.url ?? "",
      feature,
    });
  }
  return items;
}
