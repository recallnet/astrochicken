import { readFileSync } from "node:fs";
import { join } from "node:path";


import { syncBlockedBy } from "./triage-sync-blocked-by.ts";
import { parseWaveReadyLeaseEventsFromComment } from "./wave-claim.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

const READY_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);

function createLegacyReadAdapter({ repo, ghJsonFn } = {}) {
  const legacyRead = ghJsonFn;
  return {
    issueList({ state = "open", labels = [], limit = 50, fields = "number,title", search, milestone } = {}) {
      const args = ["issue", "list", "--repo", repo, "--state", state];
      if (Array.isArray(labels) && labels.length > 0) {
        args.push("--label", labels.join(","));
      }
      args.push("--limit", String(limit));
      if (search) {
        args.push("--search", search);
      }
      if (milestone) {
        args.push("--milestone", milestone);
      }
      args.push("--json", fields);
      return legacyRead(args);
    },
    issueComments({ number } = {}) {
      return legacyRead(["api", `repos/${repo}/issues/${number}/comments?per_page=100`]);
    },
  };
}

function loadContext(runId, runsDir = ".hatch/runs") {
  if (!runId) return {};
  const state = parseJson(readFileSync(join(runsDir, runId, "state.json"), "utf8"), {});
  return state?.context || {};
}

function parseArrayRaw(raw = "[]") {
  return parseJson(String(raw || "[]"), []);
}

function hasLabel(issue, name) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => String(l?.name || "") === name);
}

function issueNumber(issue) {
  const n = Number(issue?.number || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseIssueNumberFromUrl(url = "") {
  const m = String(url || "").match(/\/(\d+)\/?$/);
  const n = Number(m?.[1] || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const DEFAULT_TERMINAL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/** Check if a closed marker's latest lease event is a terminal release (no_merge_candidates / judge_failed / wave_completed)
 *  that is still within the cooldown window. After cooldownMs, allow re-dispatch.
 *
 *  wave_completed semantics:
 *  - With the default cooldown (no explicit override): treated as permanent — the wave successfully merged, never reopen.
 *  - With cooldownMs=0 (explicit force-override): treated as time-expired — allow creating a fresh marker for re-dispatch
 *    when open features still exist. This lets the supervisor explicitly override terminal state for stalled waves.
 */
function isTerminalRelease(comments = [], cooldownMs = DEFAULT_TERMINAL_COOLDOWN_MS, nowMs = Date.now()) {
  const allEvents = [];
  for (const c of comments) {
    allEvents.push(...parseWaveReadyLeaseEventsFromComment(c));
  }
  if (allEvents.length === 0) return false;
  allEvents.sort((a, b) => {
    const ae = Number.isFinite(a.sort_epoch_ms) ? a.sort_epoch_ms : Number.NEGATIVE_INFINITY;
    const be = Number.isFinite(b.sort_epoch_ms) ? b.sort_epoch_ms : Number.NEGATIVE_INFINITY;
    return ae - be;
  });
  const latest = allEvents[allEvents.length - 1];
  const isTerminal = latest.action === "release" && (
    latest.reason === "no_merge_candidates"
    || latest.reason === "judge_failed"
    || latest.reason === "wave_completed"
  );
  if (!isTerminal) return false;
  // wave_completed is permanent by default — the wave successfully merged.
  // Exception: cooldownMs=0 is an explicit force-override that bypasses even wave_completed terminal state,
  // allowing the supervisor to re-dispatch when open features remain after a completed wave.
  if (latest.reason === "wave_completed" && cooldownMs !== 0) return true;
  const eventAt = Date.parse(latest.at);
  if (Number.isFinite(eventAt) && (nowMs - eventAt) > cooldownMs) return false;
  return true;
}

export function createWaveReadyMarker({
  repo,
  wave = "",
  assignee = "",
  cooldownMs = DEFAULT_TERMINAL_COOLDOWN_MS,
  adapter,
  ghJsonFn,
  ghFn,
  syncBlockedByFn = syncBlockedBy,
} = {}) {
  const milestoneTitle = String(wave || "").trim();
  if (!repo || !milestoneTitle) {
    return {
      ok: false,
      decision: "invalid_input",
      markerIssueNumber: "",
      url: "",
      cooldownReason: "",
    };
  }

  const wanted = `Wave Ready: ${milestoneTitle}`;
  const match = (r) => (r?.title || "") === wanted && String(r?.milestone?.title || "") === milestoneTitle;
  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo, ghJsonFn }) : null)
    || createGhCliAdapter({ repo });
  const executeMutation = ghFn || ((args) => {
    const [entity, action, issueNumberArg, ...rest] = args;
    if (entity !== "issue") return { ok: false, stdout: "", stderr: "unsupported_command" };
    if (action === "comment") {
      const bodyIndex = rest.indexOf("--body");
      return githubAdapter.issueComment({
        number: issueNumberArg,
        body: bodyIndex >= 0 ? String(rest[bodyIndex + 1] || "") : "",
      });
    }
    if (action === "edit") {
      const addLabelIndex = rest.indexOf("--add-label");
      const addLabels = addLabelIndex >= 0
        ? String(rest[addLabelIndex + 1] || "").split(",").filter(Boolean)
        : [];
      return githubAdapter.issueEdit({ number: issueNumberArg, addLabels });
    }
    if (action === "reopen") {
      return githubAdapter.issueEdit({ number: issueNumberArg, state: "open" });
    }
    if (action === "create") {
      const getFlag = (flag) => {
        const index = rest.indexOf(flag);
        return index >= 0 ? String(rest[index + 1] || "") : "";
      };
      return githubAdapter.issueCreate({
        title: getFlag("--title"),
        body: getFlag("--body"),
        labels: [getFlag("--label")].filter(Boolean),
        assignees: [getFlag("--assignee")].filter(Boolean),
        milestone: getFlag("--milestone"),
      });
    }
    return { ok: false, stdout: "", stderr: "unsupported_command" };
  });

  const openReady = githubAdapter.issueList({
    state: "open",
    labels: [READY_LABEL],
    limit: 200,
    fields: "title,url,milestone,labels,number,state",
  });
  const foundReady = (Array.isArray(openReady) ? openReady : []).find(match);
  if (foundReady?.url) {
    return {
      ok: true,
      decision: "already_ready",
      markerIssueNumber: String(issueNumber(foundReady) || ""),
      url: String(foundReady.url || ""),
      cooldownReason: "",
    };
  }

  const openAll = githubAdapter.issueList({
    state: "open",
    limit: 200,
    fields: "title,url,milestone,labels,number,state",
  });
  const existingOpen = (Array.isArray(openAll) ? openAll : []).find(match);
  if (existingOpen?.url && existingOpen?.number) {
    syncBlockedByFn({ repo, issueNumber: existingOpen.number, blockedByRaw: "[]" });
    executeMutation(["issue", "comment", String(existingOpen.number), "--repo", repo, "--body", "Reusing existing wave marker and restoring ready state."]);
    if (!hasLabel(existingOpen, READY_LABEL)) {
      executeMutation(["issue", "edit", String(existingOpen.number), "--repo", repo, "--add-label", READY_LABEL]);
    }
    return {
      ok: true,
      decision: "already_ready",
      markerIssueNumber: String(issueNumber(existingOpen) || ""),
      url: String(existingOpen.url || ""),
      cooldownReason: "",
    };
  }

  const allWaveMarkers = githubAdapter.issueList({
    state: "all",
    search: '"Wave Ready:" in:title',
    limit: 300,
    fields: "title,url,milestone,labels,number,state",
  });

  const closedExisting = (Array.isArray(allWaveMarkers) ? allWaveMarkers : [])
    .filter(match)
    .filter((i) => String(i?.state || "").toUpperCase() === "CLOSED")
    .sort((a, b) => Number(b?.number || 0) - Number(a?.number || 0))[0];

  if (closedExisting?.number) {
    // Check if the marker was closed due to a terminal failure (no_merge_candidates / judge_failed).
    // If so, do NOT reopen while the deterministic cooldown is active.
    const comments = githubAdapter.issueComments({ number: closedExisting.number });
    if (isTerminalRelease(Array.isArray(comments) ? comments : [], cooldownMs)) {
      // Emit observable warning so callers are not silently surprised by a no-op.
      process.stderr.write(
        `[wave-create-ready] WARN: cooldown_blocked for milestone=${milestoneTitle} marker=#${closedExisting.number} cooldownMs=${cooldownMs} reason=terminal_release_cooldown_active\n`,
      );
      return {
        ok: true,
        decision: "cooldown_blocked",
        markerIssueNumber: String(issueNumber(closedExisting) || ""),
        url: "",
        cooldownReason: "terminal_release_cooldown_active",
      };
    }

    executeMutation(["issue", "reopen", String(closedExisting.number), "--repo", repo]);
    syncBlockedByFn({ repo, issueNumber: closedExisting.number, blockedByRaw: "[]" });
    if (!hasLabel(closedExisting, READY_LABEL)) {
      executeMutation(["issue", "edit", String(closedExisting.number), "--repo", repo, "--add-label", READY_LABEL]);
    }
    executeMutation(["issue", "comment", String(closedExisting.number), "--repo", repo, "--body", "Reopened existing wave marker for deterministic provenance continuity."]);
    return {
      ok: true,
      decision: "reopened_ready_marker",
      markerIssueNumber: String(issueNumber(closedExisting) || ""),
      url: String(closedExisting.url || ""),
      cooldownReason: "",
    };
  }

  const body = `Wave marked ready for execution. Milestone: ${milestoneTitle}`;
  const assigneeLogin = String(assignee || "").trim();
  const created = executeMutation([
    "issue", "create", "--repo", repo,
    "--title", wanted,
    "--label", READY_LABEL,
    ...(assigneeLogin ? ["--assignee", assigneeLogin] : []),
    "--milestone", milestoneTitle,
    "--body", body,
  ]);

  const createdUrl = String(created.stdout || "").trim();
  const createdIssueNumber = parseIssueNumberFromUrl(createdUrl);

  return {
    ok: Boolean(created.ok),
    decision: created.ok ? "created_ready_marker" : "create_failed",
    markerIssueNumber: createdIssueNumber > 0 ? String(createdIssueNumber) : "",
    url: createdUrl,
    cooldownReason: "",
  };
}

export function findPriorWaveMarkerNumber(waveTitle, repo, adapter) {
  const m = waveTitle.match(/^(goal-\d+-wave-)(\d+)$/);
  if (!m) return 0;
  const priorNum = Number(m[2]) - 1;
  if (priorNum < 1) return 0;
  const priorTitle = `Wave Ready: ${m[1]}${priorNum}`;
  const all = adapter.issueList({
    state: "open",
    search: `"${priorTitle}" in:title`,
    limit: 10,
    fields: "number,title,milestone",
  });
  const match = (Array.isArray(all) ? all : []).find(
    (i) => String(i?.title || "") === priorTitle,
  );
  return Number(match?.number || 0) || 0;
}

export function createReadyMarkers({
  repo,
  waves = [],
  assignee = "",
  cooldownMs = DEFAULT_TERMINAL_COOLDOWN_MS,
  adapter,
  ghJsonFn,
  ghFn,
  syncBlockedByFn = syncBlockedBy,
} = {}) {
  const results = [];
  let prevMarkerNumber = 0;
  if (!Array.isArray(waves) || waves.length === 0) return results;
  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo, ghJsonFn }) : null)
    || createGhCliAdapter({ repo });

  // Seed the chain: if the first wave in this batch isn't wave-1,
  // look up the prior wave's marker so cross-tick blocked-by is set.
  prevMarkerNumber = findPriorWaveMarkerNumber(waves[0], repo, githubAdapter);

  for (const title of waves) {
    const marker = createWaveReadyMarker({
      repo,
      wave: title,
      assignee,
      cooldownMs,
      adapter: githubAdapter,
      ghJsonFn,
      ghFn,
      syncBlockedByFn,
    });
    const markerNum = Number(marker?.markerIssueNumber || 0);
    if (markerNum > 0 && prevMarkerNumber > 0) {
      syncBlockedByFn({
        repo,
        issueNumber: markerNum,
        blockedByRaw: JSON.stringify([prevMarkerNumber]),
      });
    }
    if (markerNum > 0) prevMarkerNumber = markerNum;
    results.push(String(marker?.url || ""));
  }

  return results;
}

export function createReadyMarkersFromRun({ runId, runsDir = ".hatch/runs", repo } = {}) {
  const ctx = loadContext(runId, runsDir);
  const waves = parseArrayRaw(ctx.selected_waves || "[]");
  return createReadyMarkers({ repo, waves });
}

export function createReadyMarkersFromArgs({ repo, selectedWavesRaw = "[]", cooldownMinutes } = {}) {
  const waves = parseArrayRaw(selectedWavesRaw);
  const opts = { repo, waves };
  if (Number.isFinite(cooldownMinutes)) opts.cooldownMs = cooldownMinutes * 60 * 1000;
  return createReadyMarkers(opts);
}
