import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  latestJsonlInDir,
  listRunIds,
  readRunState,
  renderSessionLine,
  selectTargetRun,
} from "../lib/factory-session-log.ts";

function sanitizeNodePath(node = "") {
  return String(node || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readSessionLines(sessionPath) {
  let raw = "";
  try { raw = readFileSync(sessionPath, "utf8"); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean);
}

function safeReadRunState(runsDir, runId) {
  try {
    return readRunState(runsDir, runId);
  } catch {
    return null;
  }
}

function listAvailableNodeDirs(rootDir) {
  try {
    return readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry?.isDirectory?.())
      .map((entry) => entry.name)
      .sort((a, b) => String(a).localeCompare(String(b), "en"));
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function factorySessionNode({
  runsDir = ".hatch/runs",
  runId = "",
  node = "",
  lines = 20,
  follow = false,
  pollMs = 1000,
  stdout = process.stdout,
} = {}) {
  const states = listRunIds(runsDir)
    .map((id) => safeReadRunState(runsDir, id))
    .filter(Boolean);

  const resolvedRunId = selectTargetRun(states, runId);
  if (!resolvedRunId) return { ok: false, error: "no_runs_found" };

  const state = states.find((row) => row?.runId === resolvedRunId) || safeReadRunState(runsDir, resolvedRunId);
  if (!state) {
    return { ok: false, error: "run_not_found", run_id: resolvedRunId };
  }

  const sanitizedNode = sanitizeNodePath(node);
  const sessionsRoot = join(runsDir, resolvedRunId, "sessions");
  const sessionDir = join(sessionsRoot, sanitizedNode);
  const sessionLog = latestJsonlInDir(sessionDir);

  if (!sessionLog) {
    const availableNodes = listAvailableNodeDirs(sessionsRoot);
    stdout.write(`session_log_not_found run_id=${resolvedRunId} node=${sanitizedNode}\n`);
    stdout.write(`available_nodes=${availableNodes.join(",")}\n`);
    return {
      ok: false,
      error: "session_not_found_for_node",
      run_id: resolvedRunId,
      node: sanitizedNode,
      available_nodes: availableNodes,
    };
  }

  stdout.write(`session_log=${sessionLog}\n`);
  let printed = 0;
  let previousSize = 0;

  const printNewLines = () => {
    const allLines = readSessionLines(sessionLog);
    const start = printed === 0 ? Math.max(0, allLines.length - Math.max(1, Number(lines) || 20)) : printed;
    for (let idx = start; idx < allLines.length; idx++) {
      stdout.write(`${renderSessionLine(allLines[idx])}\n`);
    }
    printed = allLines.length;
    try { previousSize = statSync(sessionLog).size; } catch { previousSize = 0; }
  };

  printNewLines();
  if (!follow) {
    return {
      ok: true,
      run_id: resolvedRunId,
      session_log: sessionLog,
      node: sanitizedNode,
    };
  }

  while (true) {
    await sleep(Math.max(100, Number(pollMs) || 1000));
    let currentSize = 0;
    try {
      currentSize = statSync(sessionLog).size;
    } catch {
      return {
        ok: true,
        run_id: resolvedRunId,
        session_log: sessionLog,
        node: sanitizedNode,
      };
    }
    if (currentSize < previousSize) {
      printed = 0;
    }
    if (currentSize !== previousSize) printNewLines();
  }
}
