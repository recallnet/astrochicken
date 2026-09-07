import { ghJson } from "../lib/cli-helpers.ts";



export function extractGoalNumberFromTitle(title = "") {
  const m = String(title || "").match(/^Goal:\s*.*?#?(\d+)?$/i);
  if (m?.[1]) return Number(m[1]);
  return 0;
}

function wavePrefix(goalNumber) {
  return `goal-${Number(goalNumber)}-wave-`;
}

function listWaveMilestones(controlPlaneRepo, goalNumber) {
  const all = ghJson(["api", `repos/${controlPlaneRepo}/milestones?state=all&per_page=100`], []);
  const prefix = wavePrefix(goalNumber);
  return (Array.isArray(all) ? all : [])
    .filter((m) => String(m?.title || "").startsWith(prefix))
    .map((m) => ({ number: Number(m?.number || 0), title: String(m?.title || ""), state: String(m?.state || "") }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function listMilestoneIssues(controlPlaneRepo, milestoneTitle) {
  return ghJson([
    "issue", "list", "--repo", controlPlaneRepo, "--state", "all", "--milestone", milestoneTitle,
    "--limit", "200", "--json", "number,title,state,labels,url",
  ], []);
}

function listMergeFollowups(controlPlaneRepo, milestoneTitle) {
  return ghJson([
    "issue", "list", "--repo", controlPlaneRepo, "--state", "all",
    "--search", `\"Merge Conveyor Follow-up:\" in:title \"Wave milestone: ${milestoneTitle}\" in:body`,
    "--limit", "50", "--json", "number,title,state,url",
  ], []);
}

function parseArtifactSignature(body = "") {
  const m = String(body || "").match(/"signature_hash"\s*:\s*"([^"]+)"/);
  return m?.[1] ? String(m[1]) : "";
}

function findIngestedGoals(controlPlaneRepo, sourceRepo, sourceIssueNumber, signature = "") {
  const searches = [];
  if (signature) searches.push(`\"Artifact-Signature: ${signature}\" in:body`);
  searches.push(`\"Source: ${sourceRepo}#${sourceIssueNumber}\" in:body`);

  const out = [];
  for (const q of searches) {
    const rows = ghJson([
      "issue", "list", "--repo", controlPlaneRepo, "--state", "all", "--label", "goal",
      "--search", q, "--limit", "50", "--json", "number,title,state,url,body",
    ], []);
    for (const r of rows) {
      if (!out.some((e) => Number(e?.number) === Number(r?.number))) out.push(r);
    }
  }
  return out.sort((a, b) => Number(b?.number || 0) - Number(a?.number || 0));
}

export function buildArtifactTrace({ sourceRepo, sourceIssue, goals = [], milestonesByGoal = {}, followupsByMilestone = {} } = {}) {
  return {
    source_repo: sourceRepo,
    source_issue: sourceIssue,
    goals: goals.map((g) => ({
      number: Number(g?.number || 0),
      title: String(g?.title || ""),
      state: String(g?.state || ""),
      url: String(g?.url || ""),
      waves: (milestonesByGoal[Number(g?.number || 0)] || []).map((m) => ({
        milestone: m.title,
        state: m.state,
        followups: (followupsByMilestone[m.title] || []).map((f) => ({
          number: Number(f?.number || 0),
          title: String(f?.title || ""),
          state: String(f?.state || ""),
          url: String(f?.url || ""),
        })),
      })),
    })),
  };
}

export function traceArtifactLifecycle({ controlPlaneRepo, sourceRepo, sourceIssueNumber } = {}) {
  if (!controlPlaneRepo || !sourceRepo || !sourceIssueNumber) {
    return { ok: false, error: "missing_required_args", trace: null };
  }

  const sourceIssue = ghJson([
    "issue", "view", String(sourceIssueNumber), "--repo", sourceRepo,
    "--json", "number,title,state,url,body",
  ], {});

  const signature = parseArtifactSignature(sourceIssue?.body || "");
  const goals = findIngestedGoals(controlPlaneRepo, sourceRepo, sourceIssueNumber, signature);

  const milestonesByGoal = {};
  const followupsByMilestone = {};

  for (const goal of goals) {
    const goalNumber = Number(goal?.number || 0);
    const waves = listWaveMilestones(controlPlaneRepo, goalNumber);
    milestonesByGoal[goalNumber] = waves.map((w) => ({ ...w, issues: listMilestoneIssues(controlPlaneRepo, w.title) }));
    for (const w of waves) {
      followupsByMilestone[w.title] = listMergeFollowups(controlPlaneRepo, w.title);
    }
  }

  const trace = buildArtifactTrace({
    sourceRepo,
    sourceIssue: {
      number: Number(sourceIssue?.number || sourceIssueNumber),
      title: String(sourceIssue?.title || ""),
      state: String(sourceIssue?.state || ""),
      url: String(sourceIssue?.url || ""),
      signature,
    },
    goals,
    milestonesByGoal,
    followupsByMilestone,
  });

  return { ok: true, error: "", trace };
}
