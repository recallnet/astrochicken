import { syncBlockedBy } from "./triage-sync-blocked-by.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";


export function resolveFeatureDependencies({
  featureIssueMapRaw = "[]",
  repo = "",
  syncBlockedByFn = syncBlockedBy,
  applySync = true,
  failOnUnresolvedRefs = false,
} = {}) {
  const featureIssueMap = parseJson(String(featureIssueMapRaw || "[]"), []);
  if (!Array.isArray(featureIssueMap) || featureIssueMap.length === 0) {
    return { resolved: 0, dependencies: [], unresolved_refs: [] };
  }

  // Build feature ID → issue number lookup
  const idToIssue = new Map();
  for (const entry of featureIssueMap) {
    const featureId = String(entry?.feature?.id || "").trim();
    const issueNumber = Number(entry?.issue_number);
    if (featureId && Number.isFinite(issueNumber) && issueNumber > 0) {
      idToIssue.set(featureId, issueNumber);
    }
  }

  const results = [];
  const unresolvedRefs = [];

  for (const entry of featureIssueMap) {
    const feature = entry?.feature;
    const deps = Array.isArray(feature?.dependencies) ? feature.dependencies : [];
    const issueNumber = Number(entry?.issue_number);
    const featureId = String(feature?.id || "").trim();

    if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;

    // Resolve dependency IDs to issue numbers
    const blockedBy = [];
    for (const depIdRaw of deps) {
      const depId = trim(depIdRaw);
      if (!depId) continue;
      const mappedIssueNumber = idToIssue.get(depId);
      if (!Number.isFinite(mappedIssueNumber) || mappedIssueNumber <= 0) {
        unresolvedRefs.push({
          issue_number: issueNumber,
          feature_id: featureId,
          dependency_id: depId,
        });
        continue;
      }
      if (mappedIssueNumber === issueNumber) continue;
      blockedBy.push(mappedIssueNumber);
    }

    if (blockedBy.length === 0) continue;

    results.push({
      issue_number: issueNumber,
      feature_id: featureId,
      blocked_by: [...new Set(blockedBy)].sort((left, right) => left - right),
    });
  }

  if (failOnUnresolvedRefs && unresolvedRefs.length > 0) {
    const first = unresolvedRefs[0] || {};
    throw new Error(`unresolved_feature_dependency:${trim(first.feature_id) || "(unknown)"}->${trim(first.dependency_id) || "(unknown)"}`);
  }

  if (applySync) {
    for (const entry of results) {
      syncBlockedByFn({
        repo,
        issueNumber: entry.issue_number,
        blockedByRaw: JSON.stringify(entry.blocked_by),
      });
    }
  }

  return {
    resolved: results.length,
    dependencies: results,
    unresolved_refs: unresolvedRefs,
  };
}
