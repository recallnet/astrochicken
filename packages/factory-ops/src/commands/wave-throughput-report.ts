import {
  collectActiveWaveLeasesFromIssues,
  parseWaveReadyLeaseEventsFromComment,
} from "./wave-claim.ts";
import {
  classifyDuplicateClaims,
  computeCapacitySnapshot,
  measureRefillLatency,
} from "./wave-throughput-invariants.ts";
import { trim, ghJson } from "../lib/cli-helpers.ts";



function hasLabel(issue, name) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((label) => String(label?.name || "") === name);
}

function isOpen(issue) {
  return String(issue?.state || "OPEN").toUpperCase() !== "CLOSED";
}

function milestoneTitleFor(issue = {}) {
  const milestone = String(issue?.milestone?.title || "").trim();
  if (milestone) return milestone;
  const m = String(issue?.title || "").match(/^Wave Ready:\s*(.+)$/);
  return m ? m[1].trim() : "";
}

function isWaveMarker(issue = {}) {
  return /^Wave Ready:\s+/.test(String(issue?.title || ""));
}

function issueNumber(issue = {}) {
  const n = Number(issue?.number || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeWaveMarkers(markers = []) {
  return (Array.isArray(markers) ? markers : [])
    .filter((marker) => isWaveMarker(marker) && milestoneTitleFor(marker))
    .map((marker) => ({
      ...marker,
      number: issueNumber(marker),
      milestone: { title: milestoneTitleFor(marker) },
      state: String(marker?.state || "OPEN").toUpperCase(),
    }))
    .filter((marker) => marker.number > 0)
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

function collectCommentsForIssue({ repo = "", issue = 0, execGhJson = ghJson } = {}) {
  if (!repo || !issue) return [];

  const comments = [];
  const perPage = 100;

  for (let page = 1; page <= 100; page += 1) {
    const rows = execGhJson([
      "api",
      `repos/${repo}/issues/${issue}/comments?per_page=${perPage}&page=${page}`,
    ]);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) break;
    comments.push(...list);
    if (list.length < perPage) break;
  }

  return comments;
}

export function waveThroughputReport({
  repo = "",
  maxConcurrentWaves = 1,
  staleClaimMinutes = 0,
  nowEpochMs = Date.now(),
  ghJsonFn = ghJson,
} = {}) {
  if (!repo) {
    return {
      ok: false,
      schema_version: "wave_throughput_report/v1",
      generated_at: new Date(nowEpochMs).toISOString(),
      error: "missing_repo",
    };
  }

  const allMarkers = normalizeWaveMarkers(ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    '"Wave Ready:" in:title',
    "--json",
    "number,title,milestone,labels,state",
    "--limit",
    "300",
  ]));

  const openMarkers = allMarkers.filter((marker) => isOpen(marker));
  const openReadyMarkerCount = openMarkers.filter((marker) => hasLabel(marker, "ready")).length;

  const commentsByIssue = new Map();
  const leaseEvents = [];

  for (const marker of allMarkers) {
    const n = issueNumber(marker);
    if (!n) continue;
    const comments = collectCommentsForIssue({ repo, issue: n, execGhJson: ghJsonFn });
    commentsByIssue.set(String(n), comments);

    for (const comment of comments) {
      leaseEvents.push(...parseWaveReadyLeaseEventsFromComment(comment, {
        fallbackMilestone: milestoneTitleFor(marker),
        fallbackIssueNumber: String(n),
      }));
    }
  }

  const activeLeases = collectActiveWaveLeasesFromIssues({
    openIssues: openMarkers,
    commentsByIssue,
    nowEpochMs,
    staleClaimMinutes,
  });

  const activeWaveCount = Number(activeLeases?.active_lease_count || 0);
  const readyBacklogCount = Math.max(0, openReadyMarkerCount - activeWaveCount);

  const capacity_snapshot = computeCapacitySnapshot({
    readyWaveCount: readyBacklogCount,
    activeWaveCount,
    maxConcurrentWaves,
  });

  const refill_latency = measureRefillLatency({ leaseEvents });
  const duplicate_claims = classifyDuplicateClaims({ leaseEvents });

  return {
    ok: true,
    schema_version: "wave_throughput_report/v1",
    generated_at: new Date(nowEpochMs).toISOString(),
    repo,
    lease_event_count: leaseEvents.length,
    capacity_snapshot,
    refill_latency,
    duplicate_claims,
  };
}
