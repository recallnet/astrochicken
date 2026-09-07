import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildTickEnv } from "./daemon-llm-isolation.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeFiniteDurationMs(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function resolveScheduledGraphLogPath(paths = {}, factoryId = "", jobId = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(paths.logsDir, `scheduled-${stamp}-${factoryId}-${jobId}.log`);
}

function extractRunIdFromScheduledGraphLog(runLogPath = "") {
  try {
    const raw = readFileSync(runLogPath, "utf8");
    const match = raw.match(/^Run:\s+(\S+)/m);
    return trim(match?.[1] || "");
  } catch {
    return "";
  }
}

function readRunContext(runsDir = "", runId = "") {
  if (!trim(runsDir) || !trim(runId)) return {};
  const statePath = path.resolve(runsDir, runId, "state.json");
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    return raw?.context && typeof raw.context === "object" ? raw.context : {};
  } catch {
    return {};
  }
}

export async function runScheduledGraph({
  runtime = {},
  job = {},
  context = {},
  paths = {},
  repoRoot = "",
  hostBaseDir = "",
  activeChildRef = { current: null },
  daemonLogPath = "",
  appendLogLineFn = () => {},
  spawnImpl = spawn,
} = {}) {
  const jobId = trim(job.id);
  const graphPath = trim(job.graph);
  if (!jobId) throw new Error("missing_scheduled_job_id");
  if (!graphPath) throw new Error("missing_scheduled_job_graph");

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const runLogPath = resolveScheduledGraphLogPath(paths, runtime.factoryId, jobId);
  const runLogStream = createWriteStream(runLogPath, { flags: "a" });
  const hatchExecutable = existsSync(path.resolve(repoRoot, "node_modules/.bin/hatch"))
    ? path.resolve(repoRoot, "node_modules/.bin/hatch")
    : "hatch";
  const env = buildTickEnv({ runtime, paths, hostBaseDir });

  const child = spawnImpl(hatchExecutable, [
    "run",
    graphPath,
    "--context",
    JSON.stringify(context),
    "--live",
  ], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  activeChildRef.current = child;
  child.stdout.on("data", (chunk) => runLogStream.write(chunk));
  child.stderr.on("data", (chunk) => runLogStream.write(chunk));

  const exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(Number(code) || 0));
  });

  activeChildRef.current = null;
  await new Promise((resolve) => {
    runLogStream.end(resolve);
  });

  const runId = extractRunIdFromScheduledGraphLog(runLogPath);
  const runContext = readRunContext(runtime.runsDir, runId);
  const endedAt = new Date().toISOString();
  const durationMs = normalizeFiniteDurationMs(Date.now() - startMs);

  appendLogLineFn(
    daemonLogPath,
    `scheduled_graph_complete job=${jobId} graph=${graphPath} run_id=${runId || "unknown"} exit=${exitCode}`,
  );

  return {
    exitCode,
    runId,
    runLogPath,
    context: runContext,
    startedAt,
    endedAt,
    durationMs,
  };
}
