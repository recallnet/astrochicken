/**
 * GraphQL-only goal title fetcher — no REST fallback.
 *
 * The original fetchGoalTitles in factory-dashboard.mjs falls back to
 * per-issue REST calls (5s timeout each, sequential) when GraphQL fails.
 * In the TUI refresh loop this creates multi-second stalls when the API
 * quota is under pressure.
 *
 * This variant returns whatever GraphQL provides; if it fails, callers
 * show raw goal numbers (e.g. "Goal #42") instead of blocking.
 */

import { spawnSync } from "node:child_process";

export function fetchGoalTitlesGraphQLOnly(goalNumbers = [], { repo = "", spawnSyncFn = spawnSync } = {}) {
  const titles = {};
  if (!repo || goalNumbers.length === 0) return titles;

  try {
    const [owner, name] = repo.split("/");
    if (owner && name) {
      const fields = goalNumbers
        .map((num) => `i${num}: issue(number: ${num}) { number title }`)
        .join("\n      ");
      const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
      const p = spawnSyncFn("gh", ["api", "graphql", "-f", `query=${query}`], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (p.status === 0) {
        const parsed = JSON.parse(String(p.stdout || "{}"));
        const repoData = parsed?.data?.repository || {};
        for (const num of goalNumbers) {
          const entry = repoData[`i${num}`];
          if (entry?.title) titles[num] = String(entry.title).trim();
        }
      }
    }
  } catch { /* GraphQL failed — return empty, callers show goal numbers */ }

  return titles;
}
