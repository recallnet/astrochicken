import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  validateHatchRunLifecycleCloudEvent,
  validateHatchRunLifecycleEvent,
} from "@hatch/factory-core/hatch-run-lifecycle-asyncapi";

import {
  factoryActiveSummary,
  formatFactoryActiveMinimal,
  readAllRunStates,
  resolveGraph,
  resolveIssue,
  resolveMilestone,
} from "./factory-status.ts";
import { tickStatus } from "./factory-tick-status.ts";
import { extractRunOutcome } from "./factory-watch.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";
import {
  FACTORY_INSIGHT_EVENTS,
  FACTORY_INSIGHT_EVENT_TYPES,
  FACTORY_INSIGHT_TARGETS,
  classifySemanticEvent,
  normalizeGraphLabel,
  normalizeLifecycleEvent,
} from "../lib/factory-insight-contract.ts";
import {
  PROJECTION_DIMENSIONS,
  ensureInsightEvent,
} from "../lib/insight-contract.ts";

const VALID_EVENTS = new Set(FACTORY_INSIGHT_EVENT_TYPES);
const VALID_TARGETS = new Set(FACTORY_INSIGHT_TARGETS);

export const FACTORY_SUBSCRIBE_EVENT_PROJECTION_DIMENSIONS = PROJECTION_DIMENSIONS.factory_subscribe_event;
export { classifySemanticEvent };

function includesIgnoreCase(value = "", pattern = "") {
  const expected = String(pattern || "").trim().toLowerCase();
  if (!expected) return true;
  return String(value || "").toLowerCase().includes(expected);
}

function extractArtifactUrls(ctx) {
  const urls = new Set();
  for (const [key, value] of Object.entries(ctx || {})) {
    if (key.includes("artifact_url") && typeof value === "string" && value.startsWith("http")) {
      urls.add(value);
    }
  }
  return urls;
}

function buildRunSnapshot(states) {
  const snap = new Map();
  for (const [id, state] of states) {
    snap.set(id, {
      status: state.status || "unknown",
      node: state.currentNode || "",
      graph: resolveGraph(state),
      issue: resolveIssue(state),
      milestone: resolveMilestone(state),
      artifactUrls: extractArtifactUrls(state.context),
    });
  }
  return snap;
}

export function diffSnapshots(prev, curr) {
  const events = [];
  const ts = new Date().toISOString();

  for (const [id, current] of curr) {
    if (!prev.has(id)) {
      events.push({
        event: FACTORY_INSIGHT_EVENTS.RUN_START,
        runId: id,
        graph: current.graph,
        node: current.node,
        issue: current.issue,
        milestone: current.milestone,
        ts,
      });
    }
  }

  for (const [id, current] of curr) {
    const previous = prev.get(id);
    if (!previous) continue;

    if (previous.status !== current.status) {
      if (current.status === "completed") {
        events.push({
          event: FACTORY_INSIGHT_EVENTS.COMPLETE,
          runId: id,
          graph: current.graph,
          node: current.node,
          issue: current.issue,
          milestone: current.milestone,
          ts,
        });
      } else if (["failed", "guarded", "guarded_terminal", "blocked", "terminal"].includes(current.status)) {
        events.push({
          event: FACTORY_INSIGHT_EVENTS.FAIL,
          runId: id,
          graph: current.graph,
          node: current.node,
          issue: current.issue,
          milestone: current.milestone,
          ts,
        });
      }

      if (current.status === "completed" && (current.graph === "merge_item" || current.graph?.includes("merge"))) {
        events.push({
          event: FACTORY_INSIGHT_EVENTS.MERGE,
          runId: id,
          issue: current.issue,
          mergeStatus: "completed",
          ts,
        });
      }
    }

    if (previous.node !== current.node) {
      events.push({
        event: FACTORY_INSIGHT_EVENTS.NODE_CHANGE,
        runId: id,
        graph: current.graph,
        prevNode: previous.node,
        node: current.node,
        issue: current.issue,
        milestone: current.milestone,
        ts,
      });
    }

    for (const url of current.artifactUrls) {
      if (!previous.artifactUrls.has(url)) {
        events.push({
          event: FACTORY_INSIGHT_EVENTS.ARTIFACT,
          runId: id,
          graph: current.graph,
          node: current.node,
          issue: current.issue,
          milestone: current.milestone,
          artifactUrl: url,
          ts,
        });
      }
    }
  }

  return events;
}

function parseEventTypes(raw = "") {
  const types = String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = types.filter((type) => !VALID_EVENTS.has(type));
  return { types: new Set(types), invalid };
}

function normalizeTarget(raw = "") {
  const normalized = trim(raw).toLowerCase();
  return VALID_TARGETS.has(normalized) ? normalized : "";
}

function formatDurationShort(ms) {
  const totalMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(totalMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${totalMinutes}m${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

export function resolveSubscribeMode({ eventType = "", target = "", stream = false } = {}) {
  const { types: eventTypes, invalid } = parseEventTypes(eventType);
  const normalizedTarget = normalizeTarget(target);
  const semanticTarget = normalizedTarget || (eventTypes.size === 0 ? "next-goal-progress" : "");
  return {
    eventTypes,
    invalidEventTypes: invalid,
    target: semanticTarget,
    semanticMode: Boolean(semanticTarget),
    stream: stream === true,
  };
}

function lifecyclePath(runsDir, runId) {
  return join(runsDir, runId, "lifecycle-events.jsonl");
}

export function initializeLifecycleCursors(states, { runsDir = ".hatch/runs" } = {}) {
  const cursors = new Map();
  for (const runId of states.keys()) {
    const path = lifecyclePath(runsDir, runId);
    let offset = 0;
    if (existsSync(path)) {
      try {
        offset = statSync(path).size;
      } catch {
        offset = 0;
      }
    }
    cursors.set(runId, { offset });
  }
  return cursors;
}

export function readLifecycleEventsSince({ runsDir = ".hatch/runs", runId = "", offset = 0 } = {}) {
  const path = lifecyclePath(runsDir, runId);
  if (!existsSync(path)) return { nextOffset: 0, events: [] };
  let content = "";
  let nextOffset = 0;
  try {
    const raw = readFileSync(path);
    nextOffset = raw.byteLength;
    const effectiveOffset = offset > nextOffset ? 0 : offset;
    content = raw.subarray(effectiveOffset).toString("utf8");
  } catch {
    return { nextOffset: offset, events: [] };
  }
  const events = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .map((entry) => {
      const validated = validateHatchRunLifecycleCloudEvent(entry);
      if (validated.ok) return validated.value?.data;
      const legacy = validateHatchRunLifecycleEvent(entry);
      return legacy.ok ? legacy.value : null;
    })
    .filter((entry) => entry && typeof entry === "object");
  return { nextOffset, events };
}

export function enrichSubscriptionEvent(rawEvent = {}, { state = {} } = {}) {
  // Runtime filters depend on normalized insight fields (issue/milestone/semantic_family).
  const normalized = ensureInsightEvent(normalizeLifecycleEvent(rawEvent, { state }));
  const outcome = extractRunOutcome(state);
  const semantic = classifySemanticEvent({ ...normalized, ...outcome });
  return {
    ...normalized,
    ...outcome,
    ...semantic,
  };
}

export function matchesRuntimeContext(event = {}, { issue = "", milestone = "", family = "" } = {}) {
  const expectedIssue = trim(issue).replace(/^#/, "");
  const expectedMilestone = trim(milestone);
  const expectedFamily = trim(family);
  const eventIssue = trim(event.issue).replace(/^#/, "");

  if (expectedIssue && !includesIgnoreCase(eventIssue, expectedIssue)) return false;
  if (expectedMilestone && !includesIgnoreCase(event.milestone, expectedMilestone)) return false;
  if (expectedFamily && !includesIgnoreCase(event.semantic_family, expectedFamily)) return false;
  return true;
}

export function matchesRawFilter(
  event,
  {
    eventTypes,
    runId,
    graph = "",
    node = "",
    issue = "",
    milestone = "",
    family = "",
  },
) {
  if (!eventTypes.has(event.event)) return false;
  if (runId && event.runId !== runId && !event.runId.startsWith(runId)) return false;
  if (!includesIgnoreCase(event.graph, graph)) return false;
  if (!includesIgnoreCase(event.node, node)) return false;
  if (!matchesRuntimeContext(event, { issue, milestone, family })) return false;
  return true;
}

export function matchesSemanticTarget(
  event,
  {
    target = "",
    runId = "",
    graph = "",
    node = "",
    issue = "",
    milestone = "",
    family = "",
  },
) {
  if (!event.semantic_targets.includes(target)) return false;
  if (runId && event.runId !== runId && !event.runId.startsWith(runId)) return false;
  if (!includesIgnoreCase(event.graph, graph)) return false;
  if (!includesIgnoreCase(event.node, node)) return false;
  if (!matchesRuntimeContext(event, { issue, milestone, family })) return false;
  return true;
}

function formatEvent(event) {
  const family = trim(event.semantic_family || "");
  const parts = [family && family !== "infra" ? `[${family}]` : `[${event.event}]`];
  parts.push(event.runId.substring(0, 8));
  if (event.graph_label) {
    parts.push(`(${event.graph_label})`);
  } else if (event.graph) {
    parts.push(`(${event.graph})`);
  }
  if (event.prevNode && event.node) {
    parts.push(`${event.prevNode} → ${event.node}`);
  } else if (event.node) {
    parts.push(`node=${event.node}`);
  }
  if (event.issue) parts.push(`#${event.issue}`);
  if (event.milestone) parts.push(`[${event.milestone}]`);
  if (event.deliveryDecision) parts.push(`delivery=${event.deliveryDecision}`);
  if (event.review_verdict) parts.push(`review=${event.review_verdict}`);
  if (event.mergeStatus) parts.push(`merge=${event.mergeStatus}`);
  if (event.merged_count && event.merged_count !== "0") parts.push(`merged=${event.merged_count}`);
  if (event.releaseReportIssueDelivery) parts.push(`report=${event.releaseReportIssueDelivery}`);
  if (event.releaseSlackDelivery) parts.push(`slack=${event.releaseSlackDelivery}`);
  if (event.artifactUrl) parts.push(event.artifactUrl);
  return parts.join("  ");
}

function recentSemanticEvents({
  runsDir = ".hatch/runs",
  states = new Map(),
  windowMinutes = 15,
} = {}) {
  const events = [];
  const windowMs = Math.max(0, Number(windowMinutes || 0)) * 60_000;
  const sinceMs = windowMs > 0 ? Date.now() - windowMs : 0;

  for (const [runId, state] of states.entries()) {
    const out = readLifecycleEventsSince({ runsDir, runId, offset: 0 });
    for (const rawEvent of out.events) {
      const enriched = enrichSubscriptionEvent(rawEvent, { state, runsDir });
      if (!enriched.semantic_family || enriched.semantic_family === "infra") continue;
      const eventTs = Date.parse(enriched.ts || "");
      if (sinceMs > 0 && Number.isFinite(eventTs) && eventTs < sinceMs) continue;
      events.push(enriched);
    }
  }

  events.sort((left, right) => {
    const a = Date.parse(left.ts || "");
    const b = Date.parse(right.ts || "");
    return (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
  });

  return events;
}

function describeCurrentState({ activeSummary = {}, tick = null } = {}) {
  const ticks = Array.isArray(tick?.ticks) ? tick.ticks : [];
  if (ticks.length > 0) {
    const currentTick = ticks[0] || {};
    return `supervisor  ${trim(currentTick.stageLabel || currentTick.stage) || "running"}`;
  }

  const waves = Array.isArray(activeSummary?.waves) ? activeSummary.waves : [];
  const nonWave = Array.isArray(activeSummary?.non_wave_active) ? activeSummary.non_wave_active : [];
  if (waves.length > 0) {
    const wave = waves[0];
    const milestone = trim(wave?.milestone_title || "") || "(no-wave)";
    const issue = trim(wave?.current_issue_number || "");
    const stage = trim(wave?.current_issue_node || "") || "unknown";
    return `active  ${milestone}  ${issue ? `#${issue}` : "no-issue"}  ${stage}`;
  }

  const issueRow = nonWave.find((row) => {
    const graph = trim(row?.graph_label || row?.graph || "");
    return graph.includes("goal_issue_execute") || graph.includes("wave_issue_execute");
  });
  if (issueRow) {
    return `active  ${trim(issueRow.graph_label || issueRow.graph)}  ${trim(issueRow.node) || "unknown"}${issueRow.issue_number ? `  #${issueRow.issue_number}` : ""}`;
  }

  const supervisorRow = nonWave.find((row) => trim(row?.graph_label || "").includes("factory_supervisor_tick"));
  if (supervisorRow) {
    return `supervisor  ${trim(supervisorRow.node) || "running"}`;
  }

  return "idle";
}

export function buildSubscribeSnapshot({
  runsDir = ".hatch/runs",
  context = {},
  hostStatus = null,
  windowMinutes = 15,
  now = Date.now(),
  tickStatusFn = tickStatus,
} = {}) {
  const states = readAllRunStates({ runsDir });
  let activeSummary = {};
  try {
    activeSummary = factoryActiveSummary({ runsDir, now, context });
  } catch {
    activeSummary = {};
  }
  let tick = null;
  try {
    // @context:decision Subscribe snapshots must reflect the same canonical supervisor tick owner as `factory tick-status`.
    // Falling back to active-summary inference here would silently fork the operator view during the tick cutover.
    tick = tickStatusFn({ runsDir, context, now });
  } catch {
    tick = null;
  }
  const recentEvents = recentSemanticEvents({ runsDir, states, windowMinutes });
  const summary = summarizeSubscribeWindow(recentEvents, { target: "recent-window" });
  const latestEvent = recentEvents.at(-1) || null;

  return {
    health: hostStatus,
    activeSummary,
    current_state: describeCurrentState({ activeSummary, tick }),
    recent_window_minutes: Math.max(0, Number(windowMinutes || 0)),
    recent_summary: summary,
    latest_event: latestEvent
      ? {
        semantic_family: latestEvent.semantic_family,
        issue: latestEvent.issue,
        graph: latestEvent.graph_label || normalizeGraphLabel(latestEvent.graph),
        node: latestEvent.node,
        ts: latestEvent.ts,
      }
      : null,
  };
}

export function formatSubscribeSnapshot(snapshot = {}) {
  const lines = [];
  const health = snapshot.health || null;
  const activeSummary = snapshot.activeSummary || {};
  const recent = snapshot.recent_summary || {};
  const latest = snapshot.latest_event || null;

  if (health) {
    const daemonBits = [
      `daemon=${health.running ? "running" : "stopped"}`,
    ];
    if (health.pid) daemonBits.push(`pid=${health.pid}`);
    daemonBits.push(`runs=${Number(health.runCount || 0)}`);
    lines.push(`Now  ${daemonBits.join("  ")}`);
  } else {
    lines.push("Now  daemon=unknown");
  }

  lines.push(`State  ${snapshot.current_state || "unknown"}`);
  lines.push(formatFactoryActiveMinimal(activeSummary));

  const counts = recent.counts || {};
  const recentBits = [
    `window=${Number(snapshot.recent_window_minutes || 0)}m`,
    `events=${Number(recent.event_count || 0)}`,
  ];
  if (counts.goal) recentBits.push(`goal=${counts.goal}`);
  if (counts.issue) recentBits.push(`issue=${counts.issue}`);
  if (counts.review) recentBits.push(`review=${counts.review}`);
  if (counts.merge) recentBits.push(`merge=${counts.merge}`);
  if (counts.release) recentBits.push(`release=${counts.release}`);
  lines.push(`Recent  ${recentBits.join("  ")}`);

  if (latest) {
    const ageMs = Date.now() - Date.parse(latest.ts || "");
    const age = Number.isFinite(ageMs) && ageMs >= 0 ? formatDurationShort(ageMs) : "unknown";
    lines.push(
      `Last  [${latest.semantic_family}] ${latest.graph}${latest.issue ? `  #${latest.issue}` : ""}${latest.node ? `  ${latest.node}` : ""}  ${age} ago`,
    );
  } else {
    lines.push("Last  no recent semantic events");
  }

  return lines.join("\n");
}

export function summarizeSubscribeWindow(events = [], { target = "" } = {}) {
  const semanticEvents = events.filter((event) => trim(event.semantic_family) && event.semantic_family !== "infra");
  const counts = {
    goal: 0,
    issue: 0,
    review: 0,
    merge: 0,
    release: 0,
  };

  for (const event of semanticEvents) {
    if (Object.hasOwn(counts, event.semantic_family)) counts[event.semantic_family] += 1;
  }

  return {
    target: trim(target),
    event_count: semanticEvents.length,
    counts,
    first_ts: semanticEvents[0]?.ts || "",
    last_ts: semanticEvents.at(-1)?.ts || "",
    events: semanticEvents.map((event) => ({
      semantic_family: event.semantic_family,
      event: event.event,
      runId: event.runId,
      graph: event.graph_label || normalizeGraphLabel(event.graph),
      node: event.node,
      prevNode: event.prevNode,
      issue: event.issue,
      milestone: event.milestone,
      review_verdict: event.review_verdict || "",
      merge_status: event.mergeStatus || "",
      ts: event.ts,
    })),
    reached: semanticEvents.at(-1) || null,
  };
}

export function formatSubscribeSummary(summary = {}) {
  const counts = summary.counts || {};
  const target = trim(summary.target) || "raw-events";
  const parts = [
    `target=${target}`,
    `events=${Number(summary.event_count || 0)}`,
  ];
  if (counts.goal) parts.push(`goal=${counts.goal}`);
  if (counts.issue) parts.push(`issue=${counts.issue}`);
  if (counts.review) parts.push(`review=${counts.review}`);
  if (counts.merge) parts.push(`merge=${counts.merge}`);
  if (counts.release) parts.push(`release=${counts.release}`);
  const lines = [`Summary  ${parts.join("  ")}`];
  for (const event of Array.isArray(summary.events) ? summary.events.slice(-5) : []) {
    lines.push(`  ${formatEvent(event)}`);
  }
  return lines.join("\n");
}

export async function factorySubscribe({
  runsDir = ".hatch/runs",
  eventType = "",
  target = "",
  context = {},
  hostStatus = null,
  runId = "",
  graph = "",
  node = "",
  issue = "",
  milestone = "",
  family = "",
  stream = false,
  summaryWindowMinutes = 15,
  timeoutSec = 1800,
} = {}) {
  const mode = resolveSubscribeMode({ eventType, target, stream });
  if (mode.invalidEventTypes.length > 0) {
    const msg = `Invalid event type(s): ${mode.invalidEventTypes.join(", ")}. Valid: ${[...VALID_EVENTS].join(", ")}`;
    process.stderr.write(msg + "\n");
    return { error: msg };
  }
  if (target && !mode.target) {
    const msg = `Invalid target: ${target}. Valid: ${[...VALID_TARGETS].join(", ")}`;
    process.stderr.write(msg + "\n");
    return { error: msg };
  }

  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : 0;
  let prev = buildRunSnapshot(readAllRunStates({ runsDir }));
  let cursors = initializeLifecycleCursors(prev, { runsDir });
  const matched = [];
  const semanticWindow = [];
  const label = mode.semanticMode
    ? `target="${mode.target}"`
    : `events="${mode.eventTypes.size === VALID_EVENTS.size ? "*" : [...mode.eventTypes].join(",")}"`;
  const graphLabel = trim(graph) ? ` graph~${trim(graph)}` : "";
  const nodeLabel = trim(node) ? ` node~${trim(node)}` : "";
  const issueLabel = trim(issue) ? ` issue=${trim(issue).startsWith("#") ? trim(issue) : `#${trim(issue)}`}` : "";
  const milestoneLabel = trim(milestone) ? ` milestone~${trim(milestone)}` : "";
  const familyLabel = trim(family) ? ` family~${trim(family)}` : "";

  process.stderr.write(
    `Subscribing to ${label}${runId ? ` (run ${runId})` : ""}${graphLabel}${nodeLabel}${issueLabel}${milestoneLabel}${familyLabel}${stream ? " [stream]" : ""}${timeoutSec ? ` timeout=${timeoutSec}s` : ""}...\n`,
  );
  if (Number(summaryWindowMinutes || 0) > 0) {
    const snapshot = buildSubscribeSnapshot({
      runsDir,
      context,
      hostStatus,
      windowMinutes: summaryWindowMinutes,
    });
    process.stderr.write(`${formatSubscribeSnapshot(snapshot)}\n`);
  }

  return new Promise((resolve) => {
    const finish = (payload) => {
      process.off("SIGINT", handleSigint);
      resolve(payload);
    };
    const interval = setInterval(() => {
      if (deadline && Date.now() > deadline) {
        clearInterval(interval);
        const summary = summarizeSubscribeWindow(semanticWindow, { target: mode.target });
        if (summary.event_count > 0) {
          process.stderr.write(`${formatSubscribeSummary(summary)}\n`);
        }
        process.stderr.write("Timeout reached.\n");
        finish({ matched, summary, timedOut: true });
        return;
      }

      const states = readAllRunStates({ runsDir });
      const curr = buildRunSnapshot(states);
      const rawEvents = [];

      for (const [id, state] of states.entries()) {
        const cursor = cursors.get(id) || { offset: 0 };
        const out = readLifecycleEventsSince({ runsDir, runId: id, offset: cursor.offset });
        cursors.set(id, { offset: out.nextOffset });
        for (const event of out.events) {
          rawEvents.push(enrichSubscriptionEvent(event, { state, runsDir }));
        }
      }

      if (rawEvents.length === 0) {
        for (const event of diffSnapshots(prev, curr)) {
          const state = states.get(event.runId);
          rawEvents.push(enrichSubscriptionEvent(event, { state, runsDir }));
        }
      }

      prev = curr;

      for (const event of rawEvents) {
        if (event.semantic_family && event.semantic_family !== "infra") {
          semanticWindow.push(event);
        }

        const matchedEvent = mode.semanticMode
          ? matchesSemanticTarget(event, {
            target: mode.target,
            runId,
            graph,
            node,
            issue,
            milestone,
            family,
          })
          : matchesRawFilter(event, {
            eventTypes: mode.eventTypes,
            runId,
            graph,
            node,
            issue,
            milestone,
            family,
          });

        if (!matchedEvent) continue;

        matched.push(event);
        process.stdout.write(JSON.stringify(event) + "\n");
        process.stderr.write(formatEvent(event) + "\n");

        if (!mode.stream) {
          clearInterval(interval);
          const summary = summarizeSubscribeWindow(semanticWindow, { target: mode.target });
          if (summary.event_count > 0) {
            process.stderr.write(`${formatSubscribeSummary(summary)}\n`);
          }
          finish({ matched, summary, timedOut: false });
          return;
        }
      }
    }, 1000);

    const handleSigint = () => {
      clearInterval(interval);
      const summary = summarizeSubscribeWindow(semanticWindow, { target: mode.target });
      if (summary.event_count > 0) {
        process.stderr.write(`${formatSubscribeSummary(summary)}\n`);
      }
      finish({ matched, summary, timedOut: false, interrupted: true });
    };

    process.on("SIGINT", handleSigint);
  });
}
