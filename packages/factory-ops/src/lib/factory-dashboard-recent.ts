import { trim } from "./cli-helpers.ts";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildRecentRows({ outcomes = {}, nowMs = Date.now(), formatAge = () => "" } = {}) {
  const commits = Array.isArray(outcomes.commits) ? outcomes.commits : [];
  const rows = [];
  for (const commit of commits) {
    const subject = trim(commit.subject || "");
    const authoredAt = trim(commit.authored_at || "");
    const mergeMatch = subject.match(/^Merge branch 'wave\/(goal-\d+-wave-\d+)'/);
    const closeMatch = subject.match(/(?:Closes|Fixes|Resolves)\s+#(\d+)/i);
    let kind = "commit";
    let issue = "";
    let title = subject;
    let summary = trim(commit.sha || "").slice(0, 8);
    if (mergeMatch?.[1]) {
      kind = "merge";
      title = mergeMatch[1];
      summary = `main ← ${mergeMatch[1]}`;
    } else if (closeMatch?.[1]) {
      kind = "issue";
      issue = `#${closeMatch[1]}`;
      title = subject;
      summary = subject;
    }
    rows.push({
      id: `recent:${trim(commit.sha || subject)}`,
      kind,
      issue,
      title,
      status: "completed",
      summary,
      progress_label: "",
      updated_at: authoredAt,
      updated_age: formatAge(nowMs, authoredAt),
      badges: [kind].filter(Boolean),
      refs: {
        sha: trim(commit.sha || ""),
      },
      detail: [
        subject,
        commit.sha ? `Commit: ${commit.sha}` : "",
      ].filter(Boolean),
    });
  }
  rows.sort((left, right) => (Date.parse(right.updated_at || "") || 0) - (Date.parse(left.updated_at || "") || 0));
  return rows;
}

export function summarizeRecent(outcomes = {}) {
  return {
    merged: toNumber(outcomes.merge_commits_main, 0),
    goals: toNumber(outcomes.closed_goals, 0),
    issues: toNumber(outcomes.closed_features, 0) + toNumber(outcomes.closed_bugs, 0),
    commits: Array.isArray(outcomes.commits) ? outcomes.commits.length : 0,
  };
}
