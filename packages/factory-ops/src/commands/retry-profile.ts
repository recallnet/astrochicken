import { join } from "node:path";

import { listRunDirs, readJsonFile } from "../lib/io.ts";

function classifyError(err = "") {
  const s = String(err || "").toLowerCase();
  if (!s) return "none";
  if (s.includes("timed out") || s.includes("timeout")) return "timeout";
  if (s.includes("rate") && s.includes("limit")) return "rate_limit";
  if (s.includes("syntax") || s.includes("parse")) return "parse";
  if (s.includes("not found") || s.includes("enoent")) return "missing_file";
  if (s.includes("auth") || s.includes("unauthorized") || s.includes("forbidden")) return "auth";
  if (s.includes("connection") || s.includes("econn") || s.includes("network")) return "network";
  return "other";
}

function nodeSummaryFromRecords(records = []) {
  const byNode = new Map();
  for (const rec of records || []) {
    const id = rec?.nodeId || "unknown";
    if (!byNode.has(id)) {
      byNode.set(id, {
        nodeId: id,
        attempts: 0,
        success: 0,
        failed: 0,
        durationsMs: 0,
        errorClasses: {},
      });
    }
    const row = byNode.get(id);
    row.attempts += 1;
    const out = rec?.outcome || {};
    const status = out.status || rec?.status || "";
    if (status === "completed") row.success += 1;
    else row.failed += 1;
    row.durationsMs += Number(out.durationMs || 0);
    const c = classifyError(out.error || "");
    row.errorClasses[c] = (row.errorClasses[c] || 0) + (c === "none" ? 0 : 1);
  }
  return Array.from(byNode.values()).sort((a, b) => b.attempts - a.attempts || b.failed - a.failed);
}

function sliceRunDirs(runsDir, last = 30, offset = 0) {
  const nLast = Math.max(1, Number(last || 30));
  const nOffset = Math.max(0, Number(offset || 0));
  const all = listRunDirs(runsDir).sort((a, b) => a.name.localeCompare(b.name));
  const end = Math.max(0, all.length - nOffset);
  const start = Math.max(0, end - nLast);
  return all.slice(start, end);
}

function aggregateProfile(runsDir, dirs, pipeline = "") {
  const runs = [];
  const pipelineNeedle = String(pipeline || "").trim().toLowerCase();
  const aggregate = {
    runCount: 0,
    totalRecords: 0,
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    byNode: new Map(),
  };

  for (const d of dirs) {
    const state = readJsonFile(join(d.path, "state.json"), null);
    if (!state) continue;
    const pipelineFile = String(state.pipelineFile || "");
    if (pipelineNeedle && !pipelineFile.toLowerCase().includes(pipelineNeedle)) continue;
    const records = Array.isArray(state.records) ? state.records : [];
    const nodes = nodeSummaryFromRecords(records);
    runs.push({
      runId: state.runId || d.name,
      pipelineFile,
      status: state.status || "unknown",
      currentNode: state.currentNode || "",
      updatedAt: state.updatedAt || "",
      records: records.length,
      nodes,
    });

    aggregate.runCount += 1;
    aggregate.totalRecords += records.length;
    for (const rec of records) {
      aggregate.totalAttempts += 1;
      const out = rec?.outcome || {};
      const status = out.status || rec?.status || "";
      if (status === "completed") aggregate.successfulAttempts += 1;
      else aggregate.failedAttempts += 1;
    }

    for (const n of nodes) {
      const key = n.nodeId;
      if (!aggregate.byNode.has(key)) {
        aggregate.byNode.set(key, {
          nodeId: key,
          attempts: 0,
          success: 0,
          failed: 0,
          durationsMs: 0,
          errorClasses: {},
        });
      }
      const row = aggregate.byNode.get(key);
      row.attempts += n.attempts;
      row.success += n.success;
      row.failed += n.failed;
      row.durationsMs += n.durationsMs;
      for (const [k, v] of Object.entries(n.errorClasses || {})) {
        row.errorClasses[k] = (row.errorClasses[k] || 0) + Number(v || 0);
      }
    }
  }

  const topNodes = Array.from(aggregate.byNode.values()).sort(
    (a, b) => b.failed - a.failed || b.attempts - a.attempts || b.durationsMs - a.durationsMs,
  );

  return {
    runsDir,
    pipelineFilter: pipelineNeedle,
    scannedRuns: runs.length,
    aggregate: {
      runCount: aggregate.runCount,
      totalRecords: aggregate.totalRecords,
      totalAttempts: aggregate.totalAttempts,
      successfulAttempts: aggregate.successfulAttempts,
      failedAttempts: aggregate.failedAttempts,
      topRetryNodes: topNodes.slice(0, 20),
    },
    runs,
  };
}

export function buildRetryProfile({ runsDir = ".hatch/runs", last = 30, offset = 0, pipeline = "" } = {}) {
  const dirs = sliceRunDirs(runsDir, last, offset);
  return aggregateProfile(runsDir, dirs, pipeline);
}

function nodeMap(profile) {
  const m = new Map();
  for (const n of profile?.aggregate?.topRetryNodes || []) m.set(n.nodeId, n);
  return m;
}

export function compareRetryProfiles(current, baseline) {
  const cur = current?.aggregate || {};
  const base = baseline?.aggregate || {};
  const curMap = nodeMap(current);
  const baseMap = nodeMap(baseline);
  const keys = new Set([...curMap.keys(), ...baseMap.keys()]);

  const byNode = Array.from(keys).map((k) => {
    const c = curMap.get(k) || { attempts: 0, failed: 0, success: 0, durationsMs: 0 };
    const b = baseMap.get(k) || { attempts: 0, failed: 0, success: 0, durationsMs: 0 };
    return {
      nodeId: k,
      attemptsDelta: (c.attempts || 0) - (b.attempts || 0),
      failedDelta: (c.failed || 0) - (b.failed || 0),
      successDelta: (c.success || 0) - (b.success || 0),
      durationDeltaMs: (c.durationsMs || 0) - (b.durationsMs || 0),
    };
  }).sort((a, b) => Math.abs(b.failedDelta) - Math.abs(a.failedDelta) || Math.abs(b.attemptsDelta) - Math.abs(a.attemptsDelta));

  return {
    current: {
      scannedRuns: current.scannedRuns,
      pipelineFilter: current.pipelineFilter || "",
      totalAttempts: cur.totalAttempts || 0,
      failedAttempts: cur.failedAttempts || 0,
    },
    baseline: {
      scannedRuns: baseline.scannedRuns,
      pipelineFilter: baseline.pipelineFilter || "",
      totalAttempts: base.totalAttempts || 0,
      failedAttempts: base.failedAttempts || 0,
    },
    deltas: {
      attemptsDelta: (cur.totalAttempts || 0) - (base.totalAttempts || 0),
      failedAttemptsDelta: (cur.failedAttempts || 0) - (base.failedAttempts || 0),
    },
    byNode: byNode.slice(0, 30),
  };
}

export function renderRetryProfileMarkdown(profile) {
  const a = profile.aggregate;
  const lines = [];
  lines.push(`# Retry Profile`);
  lines.push(`- runsDir: ${profile.runsDir}`);
  lines.push(`- pipelineFilter: ${profile.pipelineFilter || "(none)"}`);
  lines.push(`- scannedRuns: ${profile.scannedRuns}`);
  lines.push(`- totalAttempts: ${a.totalAttempts}`);
  lines.push(`- failedAttempts: ${a.failedAttempts}`);
  lines.push(`- successfulAttempts: ${a.successfulAttempts}`);
  lines.push("");
  lines.push(`## Top Retry Nodes`);
  lines.push(`| nodeId | attempts | failed | success | duration_ms |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const n of a.topRetryNodes || []) {
    lines.push(`| ${n.nodeId} | ${n.attempts} | ${n.failed} | ${n.success} | ${n.durationsMs} |`);
  }
  lines.push("");
  lines.push(`## Recent Runs`);
  lines.push(`| runId | status | currentNode | records | pipeline |`);
  lines.push(`|---|---|---|---:|---|`);
  for (const r of profile.runs.slice(-20)) {
    lines.push(`| ${r.runId} | ${r.status} | ${r.currentNode} | ${r.records} | ${r.pipelineFile} |`);
  }
  return lines.join("\n");
}

export function renderRetryCompareMarkdown(compare) {
  const lines = [];
  lines.push(`# Retry Profile Compare`);
  lines.push(`- current runs: ${compare.current.scannedRuns}`);
  lines.push(`- current pipelineFilter: ${compare.current.pipelineFilter || "(none)"}`);
  lines.push(`- baseline runs: ${compare.baseline.scannedRuns}`);
  lines.push(`- baseline pipelineFilter: ${compare.baseline.pipelineFilter || "(none)"}`);
  lines.push(`- attempts delta: ${compare.deltas.attemptsDelta}`);
  lines.push(`- failed attempts delta: ${compare.deltas.failedAttemptsDelta}`);
  lines.push("");
  lines.push(`## Node Deltas`);
  lines.push(`| nodeId | attempts_delta | failed_delta | success_delta | duration_delta_ms |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const n of compare.byNode || []) {
    lines.push(`| ${n.nodeId} | ${n.attemptsDelta} | ${n.failedDelta} | ${n.successDelta} | ${n.durationDeltaMs} |`);
  }
  return lines.join("\n");
}
