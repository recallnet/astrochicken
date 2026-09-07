import { markGoalDispatched } from "./goal-run-state.ts";
import { gh, ghJson } from "../lib/cli-helpers.ts";

function hasLabel(issue, name) {
  return (issue.labels || []).some((l) => String(l?.name || "") === name);
}

function hasOpenBlockers(repo, issueNumber, { ghJsonFn = ghJson } = {}) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name || !issueNumber) return false;
  const query = `query { repository(owner:\"${owner}\", name:\"${name}\") { i: issue(number:${Number(issueNumber)}) { blockedBy(first:100){nodes{number state}} } } }`;
  const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`]);
  const nodes = out?.data?.repository?.i?.blockedBy?.nodes || [];
  return nodes.some((n) => String(n?.state || "").toUpperCase() === "OPEN");
}

export function autoReadyArtifactGoals({
  repo,
  ghJsonFn = ghJson,
  ghExec = gh,
  markGoalDispatchedFn = markGoalDispatched,
} = {}) {
  if (!repo) {
    return {
      promoted_count: 0,
      promoted: [],
      awaiting_human_skipped_count: 0,
      awaiting_human_skipped: [],
      messages: [],
    };
  }

  const goals = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "200",
    "--json", "number,title,labels",
  ]) ?? [];

  const artifactGoals = (Array.isArray(goals) ? goals : []).filter((g) => {
    if (!String(g?.title || "").startsWith("[artifact] ")) return false;
    if (hasLabel(g, "ready")) return false;
    if (hasOpenBlockers(repo, Number(g?.number), { ghJsonFn })) return false;
    return true;
  });

  const promoted = [];
  const awaitingHumanSkipped = [];
  const messages = [];

  for (const g of artifactGoals) {
    const number = String(g.number);
    if (hasLabel(g, "awaiting-human")) {
      awaitingHumanSkipped.push(number);
      messages.push(`skip_goal_${number}: awaiting-human label present; auto-ready disabled until human review re-adds ready.`);
      continue;
    }

    markGoalDispatchedFn({ repo, issueNumber: number, ghExec });
    ghExec(["issue", "comment", number, "--repo", repo, "--body", "Auto-promoted to ready by factory supervisor artifact→goal policy."]);
    promoted.push(number);
  }

  return {
    promoted_count: promoted.length,
    promoted,
    awaiting_human_skipped_count: awaitingHumanSkipped.length,
    awaiting_human_skipped: awaitingHumanSkipped,
    messages,
  };
}
