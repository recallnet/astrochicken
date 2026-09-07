import { join } from "node:path";

import { collectFactoryProgressMetrics, formatFactoryProgressMetrics } from "./factory-progress-metrics.ts";
import { readAllRunStates, readState, resolveGraph, resolveIssue, resolveMilestone, duration } from "./factory-status.ts";
import { parseJson } from "../lib/cli-helpers.ts";
import { FACTORY_INSIGHT_EVENTS, normalizeOutcomeEvent } from "../lib/factory-insight-contract.ts";
import { ensureInsightEvent } from "../lib/insight-contract.ts";


/**
 * Extract outcome metadata from a completed run's state.
 * Returns a flat object with the key fields that matter for monitoring.
 */
export function extractRunOutcome(state) {
  if (!state) return {};
  const ctx = state.context || {};
  const graphPath = state.pipeline || state.pipelineFile || state.graph || "";
  const graphFile = String(graphPath).split("/").pop() || "";
  const out = {};

  // wave_issue_execute outcomes
  if (graphFile === "wave_issue_execute.dot") {
    out.review_verdict = ctx.review_verdict || "";
    out.review_failed = ctx.review_failed || "";
    out.review_attempt = ctx.review_attempt || "";
    out.review_route_reason = ctx.review_route_reason || "";
    out.precheck_reason = ctx.precheck_reason || "";
    out.snapshot_sha = (ctx.snapshot_sha || "").substring(0, 7);
    if (ctx.review_notes) out.review_notes_excerpt = ctx.review_notes.substring(0, 120);

    const impl = parseJson(ctx.impl_result || "{}", {});
    if (impl && typeof impl === "object") {
      out.impl_review_failed = impl.review_failed || "";
      out.disposition = impl.disposition || "";
      out.decision_confidence = impl.decision_confidence || "";
      if (!out.review_notes_excerpt && impl.review_notes) {
        out.review_notes_excerpt = String(impl.review_notes).substring(0, 120);
      }
    }

    if (!out.review_verdict && out.disposition) out.review_verdict = out.disposition;
    if (!out.review_failed && out.impl_review_failed) out.review_failed = out.impl_review_failed;
  }

  // milestone_execute outcomes
  if (graphFile === "milestone_execute.dot") {
    const completed = parseJson(ctx.completed_issues, []);
    const processed = parseJson(ctx.processed_issues, []);
    const implResults = parseJson(ctx.impl_results, []);
    out.completed_count = completed.length;
    out.processed_count = processed.length;
    out.impl_results_count = implResults.length;
    out.approved = implResults.filter(r => r.review_failed === "false").map(r => "#" + r.issue_number);
    out.failed = implResults.filter(r => r.review_failed === "true").map(r => "#" + r.issue_number);
  }

  // wave_execute outcomes
  if (graphFile === "wave_execute.dot") {
    out.has_merge_candidates = ctx.has_merge_candidates || "";
    out.merged_count = ctx.merged_count || "0";
    out.failed_count = ctx.failed_count || "0";
    out.merge_status = ctx.merge_status || "";
    out.branch = ctx.branch || "";
    out.claim_reason = ctx.claim_reason || "";
  }

  // supervisor tick
  if (graphFile === "factory_supervisor_tick.dot") {
    out.milestone = ctx.milestone_title || "";
  }

  return out;
}

/**
 * Build a snapshot of all run states, keyed by run ID.
 */
function snapshot(runsDir) {
  const map = new Map();
  for (const [id, s] of readAllRunStates({ runsDir })) {
    map.set(id, {
      status: s.status || "unknown",
      node: s.currentNode || "",
      graph: s.graph || "",
      graphShort: resolveGraph(s),
      issue: resolveIssue(s),
      milestone: resolveMilestone(s),
    });
  }
  return map;
}

/**
 * Diff two snapshots and return enriched events.
 */
function diff(prev, curr, runsDir) {
  const events = [];
  const ts = new Date().toISOString();

  for (const [id, c] of curr) {
    const p = prev.get(id);
    if (!p) continue;
    if (p.status === c.status) continue;

    const kind = c.status === "completed" ? FACTORY_INSIGHT_EVENTS.COMPLETE
      : ["failed", "guarded", "guarded_terminal", "blocked", "terminal"].includes(c.status) ? FACTORY_INSIGHT_EVENTS.FAIL
      : null;
    if (!kind) continue;

    // Enrich with outcome metadata from the final state
    const state = readState(join(runsDir, id));
    const outcome = extractRunOutcome(state);

    const normalized = ensureInsightEvent(normalizeOutcomeEvent({
      event: kind,
      runId: id,
      graph: c.graphShort,
      node: c.node,
      issue: c.issue,
      milestone: c.milestone,
      ts,
      ...outcome,
    }, { state }));

    events.push({
      ...normalized,
      ...outcome,
    });
  }
  return events;
}

/**
 * Format a single enriched event for human display.
 */
export function formatWatchEvent(evt) {
  const tag = evt.event === "complete" ? "OK" : "FAIL";
  const parts = [`[${tag}]`];
  if (evt.issue) parts.push(`#${evt.issue}`);
  const graphShort = String(evt.graph || "").split("/").pop() || evt.runId.substring(0, 8);
  parts.push(graphShort);
  if (evt.milestone) parts.push(`[${evt.milestone}]`);

  // Issue-level detail
  if (evt.review_verdict) {
    if (evt.review_verdict === "approve") {
      parts.push("APPROVED");
    } else if (evt.review_verdict === "revise") {
      parts.push(`revise(${evt.review_attempt})`);
    } else if (["done_elsewhere", "enhancement_only", "not_done", "uncertain"].includes(String(evt.review_verdict))) {
      const conf = evt.decision_confidence ? `/${evt.decision_confidence}` : "";
      parts.push(`${evt.review_verdict}${conf}`);
    } else {
      parts.push(String(evt.review_verdict));
    }
  }

  // Milestone-level detail
  if (evt.approved?.length > 0) parts.push(`approved=${evt.approved.join(",")}`);
  if (evt.failed?.length > 0) parts.push(`failed=${evt.failed.join(",")}`);

  // Wave-level detail
  if (evt.merge_status) parts.push(`merge=${evt.merge_status}`);
  if (evt.merged_count && evt.merged_count !== "0") parts.push(`merged=${evt.merged_count}`);
  if (evt.claim_reason) parts.push(`claim=${evt.claim_reason}`);

  if (evt.review_route_reason) parts.push(`route=${evt.review_route_reason}`);
  if (evt.precheck_reason) parts.push(`precheck=${evt.precheck_reason}`);

  // Excerpt
  if (evt.review_notes_excerpt) {
    const note = evt.review_notes_excerpt.replace(/\n/g, " ").substring(0, 80);
    parts.push(`"${note}"`);
  }

  return parts.join("  ");
}

/**
 * Format the final summary after timeout.
 */
export function formatWatchSummary(events, elapsedMs) {
  if (events.length === 0) return `No events in ${duration(elapsedMs)}.`;

  const lines = [`${events.length} event(s) in ${duration(elapsedMs)}:`, ""];
  for (const evt of events) {
    lines.push("  " + formatWatchEvent(evt));
  }

  // Aggregate stats
  const issueEvents = events.filter(e => e.graph?.includes("wave_issue_execute"));
  const approved = issueEvents.filter(e => e.review_verdict === "approve");
  const revised = issueEvents.filter(e => e.review_verdict === "revise" || e.review_failed === "true");
  const bypassed = issueEvents.filter(e => ["done_elsewhere", "enhancement_only", "not_done", "uncertain"].includes(String(e.review_verdict || "")));
  const mergeEvents = events.filter(e => e.graph?.includes("wave_execute"));

  lines.push("");
  if (issueEvents.length > 0) {
    lines.push(`Issues: ${approved.length} approved, ${revised.length} failed/revised, ${bypassed.length} bypassed-review`);
  }
  if (mergeEvents.length > 0) {
    const m = mergeEvents[mergeEvents.length - 1];
    lines.push(`Merge: ${m.merge_status || "none"} (${m.merged_count || 0} merged, ${m.failed_count || 0} failed)`);
  }

  return lines.join("\n");
}

/**
 * Watch factory events for a given timeout, enriching each with outcome metadata.
 * Returns a structured summary suitable for monitoring.
 */
export async function factoryWatch({ runsDir = ".hatch/runs", timeoutSec = 300, stream = false, repo = "", progressIntervalSec = 60 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  let prev = snapshot(runsDir);
  const events = [];
  const progressEvents = [];
  const progressIntervalMs = Math.max(0, Number(progressIntervalSec || 0)) * 1000;
  let lastProgressAt = 0;

  process.stderr.write(`Watching factory events for ${timeoutSec}s...\n`);

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now > deadline) {
        clearInterval(interval);
        const summary = formatWatchSummary(events, timeoutSec * 1000);
        process.stderr.write("\n" + summary + "\n");
        process.stdout.write(JSON.stringify({ events, progress_events: progressEvents, summary }, null, 2) + "\n");
        resolve({ events, progressEvents, summary });
        return;
      }

      if (repo && progressIntervalMs > 0 && (lastProgressAt === 0 || now - lastProgressAt >= progressIntervalMs)) {
        const metrics = collectFactoryProgressMetrics({ repo, runsDir });
        const evt = {
          ...ensureInsightEvent(normalizeOutcomeEvent(
            { event: FACTORY_INSIGHT_EVENTS.PROGRESS, ts: new Date().toISOString(), ...metrics },
            { state: {} },
          )),
          ...metrics,
        };
        progressEvents.push(evt);
        if (stream) process.stderr.write(formatFactoryProgressMetrics(metrics) + "\n");
        process.stdout.write(JSON.stringify(evt) + "\n");
        lastProgressAt = now;
      }

      const curr = snapshot(runsDir);
      const newEvents = diff(prev, curr, runsDir);
      prev = curr;

      for (const evt of newEvents) {
        events.push(evt);
        if (stream) {
          process.stderr.write(formatWatchEvent(evt) + "\n");
        }
        process.stdout.write(JSON.stringify(evt) + "\n");
      }
    }, 2000);

    process.on("SIGINT", () => {
      clearInterval(interval);
      const elapsed = timeoutSec * 1000 - (deadline - Date.now());
      const summary = formatWatchSummary(events, elapsed);
      process.stderr.write("\n" + summary + "\n");
      resolve({ events, progressEvents, summary, interrupted: true });
    });
  });
}
