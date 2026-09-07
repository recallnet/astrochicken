import { ghJson } from "../lib/cli-helpers.ts";


export function fetchIssueBody({ repo, issueNumber } = {}) {
  if (!repo || !issueNumber) return "";
  const body = String(ghJson(["issue", "view", String(issueNumber), "--repo", repo, "--json", "body"], {})?.body || "");
  return body.replaceAll("${", "$ {");
}
