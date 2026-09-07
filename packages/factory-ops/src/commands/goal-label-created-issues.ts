import { trim, gh } from "../lib/cli-helpers.ts";
import { buildIssueLabelEditArgs, FACTORY_LABEL_KEYS } from "../lib/factory-label-contract.ts";

/**
 * Add the `triaged` label to all issues created during decomposition.
 * Replaces the per-item label application that triage used to do.
 */
export function labelCreatedIssues({
  repo = "",
  issueUrls = "",
  runGhFn = gh,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return { ok: false, error: "repo is required" };
  }

  const urls = String(issueUrls || "")
    .split(",")
    .map((u) => trim(u))
    .filter(Boolean);

  if (urls.length === 0) {
    return { ok: true, labeled_count: 0, errors: [] };
  }

  let labeledCount = 0;
  const errors = [];

  for (const url of urls) {
    const issueNumber = url.match(/\/issues\/(\d+)/)?.[1];
    if (!issueNumber) {
      errors.push({ url, error: "could not extract issue number" });
      continue;
    }

    const result = runGhFn(buildIssueLabelEditArgs({
      repo: normalizedRepo,
      issueNumber,
      factoryId: "mothership",
      addKeys: [FACTORY_LABEL_KEYS.TRIAGED],
    }));

    if (result.ok) {
      labeledCount += 1;
    } else {
      errors.push({ url, issue_number: issueNumber, error: trim(result.stderr || result.stdout || "label_failed") });
    }
  }

  return { ok: true, labeled_count: labeledCount, errors };
}
