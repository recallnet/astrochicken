import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { listCanonicalPacketsSync } from "./canonical-packet-projection.ts";
import { readJsonFile } from "./io.ts";

const STALLED_THRESHOLD_MS = 15 * 60 * 1000;

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function parseIsoMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function resolveGraph(state) {
  const file = String(state?.pipelineFile || state?.pipeline || "").trim();
  if (!file) return null;
  const match = file.match(/([^/]+)$/);
  return match ? match[1] : file;
}

function resolveIssue(state) {
  const ctx = state?.context || {};
  return String(ctx.issue_number || ctx.issueNumber || "").trim() || null;
}

function resolveMilestone(state) {
  const ctx = state?.context || {};
  return String(ctx.milestone_title || ctx.milestoneTitle || "").trim() || null;
}

function expectedNextOutcomeForNode(nodeName = "") {
  const node = String(nodeName || "").trim().toLowerCase();
  if (!node) return "run state update";
  if (node === "claim_wave" || node.includes("claim_wave")) return "wave assigned";
  if (node === "dispatch_issue" || node.includes("dispatch_issue")) return "issue claimed";
  if (node === "review" || node.includes("review")) return "review decision";
  if (node === "execute_issue" || node.includes("execute_issue") || node === "build") return "issue run completes";
  return "run state update";
}

function readState(runDir) {
  const raw = readJsonFile(join(runDir, "state.json"), null);
  if (!raw || typeof raw !== "object") return null;
  return {
    runId: raw.runId ?? null,
    status: raw.status ?? null,
    currentNode: raw.currentNode ?? null,
    pipelineFile: raw.pipelineFile ?? raw.pipeline ?? null,
    startedAt: raw.startedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    createdAt: raw.createdAt ?? null,
    context: (raw.context && typeof raw.context === "object") ? raw.context : {},
    activeChildren: (raw.activeChildren && typeof raw.activeChildren === "object") ? raw.activeChildren : {},
    pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : null,
  };
}

function readLifecycleEvents(runDir, maxEvents = 10) {
  const path = join(runDir, "lifecycle-events.jsonl");
  if (!existsSync(path)) return [];
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .filter((e) => e && typeof e === "object");
  return events.slice(-maxEvents);
}

function collectOpenPackets(runsDir, runId) {
  try {
    const entries = listCanonicalPacketsSync({
      runsDir,
      runId,
      packetState: "open",
      durableOnly: false,
      excludeTerminalRuns: true,
    });
    return entries
      .map((e) => ({
        packet_type: e.packet_ref?.packet_type || e.packet?.packet_type || "",
        packet_id: e.packet_ref?.packet_id || e.packet?.packet_id || "",
        packet_state: e.packet_ref?.packet_state || e.packet?.packet_state || "",
        node_id: e.packet_ref?.node_id || e.packet?.node_id || "",
        created_at: e.packet?.created_at || "",
      }));
  } catch {
    return [];
  }
}

function listRunArtifacts(runDir) {
  const artifactsDir = join(runDir, "artifacts");
  if (!existsSync(artifactsDir)) return [];
  try {
    return readdirSync(artifactsDir).map((name) => join("artifacts", name));
  } catch {
    return [];
  }
}

/**
 * Build a run inspection projection with four top-level sections.
 *
 * @param {{ runsDir: string, runId: string, maxEvents?: number, now?: number }} opts
 * @returns {{ run: object, diagnosis: object, recent_transitions: object[], artifacts: object }}
 */
export function buildRunInspectionProjection({
  runsDir = ".hatch/runs",
  runId = "",
  maxEvents = 10,
  now = Date.now(),
} = {}) {
  const runDir = join(runsDir, runId);
  const state = existsSync(runDir) ? readState(runDir) : null;

  const run = {
    run_id: runId,
    status: state?.status ?? null,
    current_node: state?.currentNode ?? null,
    graph: state ? resolveGraph(state) : null,
    issue: state ? resolveIssue(state) : null,
    milestone: state ? resolveMilestone(state) : null,
    started_at: state?.startedAt ?? null,
    updated_at: state?.updatedAt ?? null,
    pid: state?.pid ?? null,
    context: state?.context ?? {},
  };

  const lastProgressAt = String(state?.updatedAt || state?.startedAt || "").trim();
  const lastProgressMs = parseIsoMs(lastProgressAt);
  const lastProgressAgeMs = lastProgressMs > 0 ? Math.max(0, now - lastProgressMs) : 0;

  const diagnosis = {
    stalled: lastProgressMs > 0 ? lastProgressAgeMs >= STALLED_THRESHOLD_MS : false,
    last_progress_age_ms: lastProgressAgeMs,
    stalled_threshold_ms: STALLED_THRESHOLD_MS,
    expected_next_outcome: expectedNextOutcomeForNode(state?.currentNode || ""),
  };

  const events = existsSync(runDir)
    ? readLifecycleEvents(runDir, maxEvents)
    : [];
  const recent_transitions = events.map((e) => ({
    event: e.data?.event || e.event || e.eventName || e.type || "",
    timestamp: e.time || e.timestamp || e.data?.ts || e.ts || "",
    graph_label: e.data?.graph || e.graph_label || "",
    node: e.data?.node || e.node || "",
    status: e.data?.status || e.status || "",
    payload: e.data || e.payload || {},
  }));

  const openPackets = collectOpenPackets(runsDir, runId);
  const artifactFiles = existsSync(runDir) ? listRunArtifacts(runDir) : [];

  const artifacts = {
    open_packets: openPackets,
    files: artifactFiles,
  };

  return { run, diagnosis, recent_transitions, artifacts };
}

/**
 * Format a run inspection projection for human-readable output.
 *
 * @param {{ run: object, diagnosis: object, recent_transitions: object[], artifacts: object }} projection
 * @returns {string}
 */
export function formatRunInspection(projection) {
  const { run, diagnosis, recent_transitions, artifacts } = projection;
  const lines = [];

  lines.push(`Run: ${run.run_id || "(unknown)"}`);
  lines.push(`  Status: ${run.status || "(unknown)"}  Node: ${run.current_node || "-"}  Graph: ${run.graph || "-"}`);
  if (run.issue) lines.push(`  Issue: #${run.issue}${run.milestone ? `  Milestone: ${run.milestone}` : ""}`);
  if (run.started_at) lines.push(`  Started: ${run.started_at}`);
  if (run.pid) lines.push(`  PID: ${run.pid}`);

  const ctxKeys = Object.entries(run.context || {})
    .filter(([k]) => !["issue_number", "milestone_title"].includes(k))
    .slice(0, 8);
  if (ctxKeys.length > 0) {
    lines.push(`  Context: ${ctxKeys.map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }

  lines.push("");
  lines.push("Diagnosis:");
  lines.push(`  Stalled: ${diagnosis.stalled ? "YES" : "no"}  (age ${Math.round(diagnosis.last_progress_age_ms / 1000)}s, threshold ${Math.round(diagnosis.stalled_threshold_ms / 1000)}s)`);
  lines.push(`  Expected next: ${diagnosis.expected_next_outcome}`);

  if (recent_transitions.length > 0) {
    lines.push("");
    lines.push("Recent Transitions:");
    for (const t of recent_transitions) {
      lines.push(`  ${t.timestamp || "-"}  ${t.event}  node=${t.node || "-"}  graph=${t.graph_label || "-"}`);
    }
  }

  if (artifacts.open_packets.length > 0) {
    lines.push("");
    lines.push("Open Packets:");
    for (const p of artifacts.open_packets) {
      lines.push(`  ${p.packet_type}/${p.packet_id}  state=${p.packet_state}  node=${p.node_id}`);
    }
  }

  if (artifacts.files.length > 0) {
    lines.push("");
    lines.push("Artifacts:");
    for (const f of artifacts.files) {
      lines.push(`  ${f}`);
    }
  }

  return lines.join("\n");
}
