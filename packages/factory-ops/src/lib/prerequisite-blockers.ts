import { trim } from "./cli-helpers.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";


function normalizeGoalIssueNumber(goalIssueNumber = "") {
  const parsed = Number.parseInt(trim(goalIssueNumber), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Resolve blockedBy prerequisites for a goal from GitHub.
 *
 * This powers restart/admission gating for factory-request prerequisite chains:
 * if lookup fails or any prerequisite remains OPEN, goal execution must deny.
 */
export function listPrerequisiteBlockers({
  repo = "",
  goalIssueNumber = "",
  adapter,
} = {}) {
  const issueNumber = normalizeGoalIssueNumber(goalIssueNumber);
  if (!repo || issueNumber <= 0) {
    return {
      ok: false,
      error: "failed_lookup",
      blockers: [],
    };
  }

  try {
    const nodes = (adapter || createGhCliAdapter({ repo })).issueBlockedBy({ number: issueNumber });

    const blockers = nodes
      .map((node) => ({
        number: Number.parseInt(trim(node?.number), 10),
        state: trim(node?.state).toUpperCase(),
      }))
      .filter((node) => Number.isFinite(node.number) && node.number > 0);

    return {
      ok: true,
      error: "",
      blockers,
    };
  } catch {
    return {
      ok: false,
      error: "failed_lookup",
      blockers: [],
    };
  }
}

export function hasOpenPrerequisiteBlocker({
  repo = "",
  goalIssueNumber = "",
  listPrerequisiteBlockersFn = listPrerequisiteBlockers,
  adapter,
} = {}) {
  const listed = listPrerequisiteBlockersFn({
    repo,
    goalIssueNumber,
    adapter,
  });

  if (!listed?.ok) {
    return {
      ok: false,
      error: trim(listed?.error) || "failed_lookup",
      openBlockers: [],
    };
  }

  const openBlockers = Array.from(new Set(
    (Array.isArray(listed?.blockers) ? listed.blockers : [])
      .filter((node) => trim(node?.state).toUpperCase() === "OPEN")
      .map((node) => Number.parseInt(trim(node?.number), 10))
      .filter((number) => Number.isFinite(number) && number > 0),
  )).sort((a, b) => a - b);

  return {
    ok: true,
    error: "",
    openBlockers,
  };
}
