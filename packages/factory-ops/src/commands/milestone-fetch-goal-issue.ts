import {
  createGhCliAdapter,
  createGitHubIssueSource,
} from "@hatch/github-adapter";

export function fetchGoalIssue({
  repo = "",
  goalNumber = "",
  factoryId = "",
  runId = "",
  githubIssueSource,
  emitCanonicalEventFn,
} = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedGoalNumber = String(goalNumber || "").trim();
  if (!resolvedGoalNumber) return {};

  const issueSource = githubIssueSource || createGitHubIssueSource({
    adapter: createGhCliAdapter({
      repo: resolvedRepo,
    }),
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
  const view = issueSource.issueView({ number: resolvedGoalNumber, fields: "number,title,body" });
  if (!view || typeof view !== "object") {
    throw new Error("failed to fetch goal issue");
  }

  return view;
}
