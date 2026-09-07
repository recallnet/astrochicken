import { gh, ghJsonPaginated } from "../lib/cli-helpers.ts";



/**
 * Close any open milestone that has zero open issues.
 * Only targets wave milestones (goal-N-wave-M pattern).
 */
export function sweepEmptyMilestones({ repo, ghJsonPaginatedFn = ghJsonPaginated, ghFn = gh } = {}) {
  if (!repo) return { closed: 0, milestones: [], summary: "missing_repo" };

  const openMilestones = ghJsonPaginatedFn(`repos/${repo}/milestones?state=open&per_page=100`);
  const waveMilestones = openMilestones.filter(
    (m) => /^goal-\d+-wave-/.test(String(m?.title || "")),
  );

  const closed = [];
  for (const ms of waveMilestones) {
    if (Number(ms.open_issues || 0) > 0) continue;
    const result = ghFn(["api", "-X", "PATCH", `repos/${repo}/milestones/${ms.number}`, "-f", "state=closed"]);
    if (result.ok) {
      closed.push({ number: ms.number, title: ms.title, closed_issues: ms.closed_issues || 0 });
    }
  }

  return {
    closed: closed.length,
    milestones: closed,
    summary: closed.length
      ? `Closed ${closed.length} empty wave milestone(s).`
      : "No empty wave milestones.",
  };
}
