import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildTickEnv } from "./daemon-llm-isolation.ts";
import {
  DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
  DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
  evaluateDispatchLatencySlo,
  evaluateMaintenanceTickDue,
  normalizeDispatchLatencySloSeconds,
  normalizeMaintenanceIntervalSeconds,
  writeMaintenanceTickState,
} from "./dispatch-slo-policy.ts";
import { classifySupervisorFailure } from "../commands/supervisor-failure-classifier.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeTickIdle(tickIdle) {
  if (typeof tickIdle === "string") {
    const normalized = trim(tickIdle).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false" || normalized === "") return false;
  }
  return Boolean(tickIdle);
}

function normalizeFiniteDurationMs(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function resolveTickLogPath(paths = {}, factoryId = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(paths.logsDir, `tick-${stamp}-${factoryId}.log`);
}

function extractRunIdFromTickLog(tickLogPath = "") {
  try {
    const raw = readFileSync(tickLogPath, "utf8");
    const match = raw.match(/^Run:\s+(\S+)/m);
    return trim(match?.[1] || "");
  } catch {
    return "";
  }
}

function extractRunIdFromText(raw = "") {
  const match = String(raw || "").match(/^Run:\s+(\S+)/m);
  return trim(match?.[1] || "");
}

function readTickIdleFromRunState(runsDir = "", runId = "") {
  if (!runId) return false;
  const statePath = path.resolve(runsDir, runId, "state.json");
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    const value = raw?.context?.tick_idle;
    return normalizeTickIdle(value);
  } catch {
    return false;
  }
}

function inferTickFailureCrashType(evidenceText = "") {
  const normalized = String(evidenceText || "");
  if (!normalized) return "unknown";
  if (/\bmerge_marker_in_executable\b/i.test(normalized)) return "merge_marker_in_executable";
  if (/\b(ERR_MODULE_NOT_FOUND|Cannot find module|module_not_found)\b/i.test(normalized)) return "module_not_found";
  if (/\b(wave-judge-failure|judge_failure)\b/i.test(normalized)) return "judge_failure";
  if (/\b(stalled-wave-execution|stalled_execution)\b/i.test(normalized)) return "stalled_execution";
  if (/\b(managed-daemon-circuit-breaker|daemon_circuit_breaker)\b/i.test(normalized)) return "daemon_circuit_breaker";
  if (/\b(test:pre-commit-gates|build failed|tests? failed|vitest|eslint|tsc\b|build_or_test_failure)\b/i.test(normalized)) {
    return "build_or_test_failure";
  }
  return "unknown";
}

function inferTickFailureBugType(crashType = "") {
  const normalized = trim(crashType).toLowerCase();
  if (normalized === "build_or_test_failure") return "main-branch-test-failure";
  if (normalized === "judge_failure") return "wave-judge-failure";
  if (normalized === "stalled_execution") return "stalled-wave-execution";
  if (normalized === "daemon_circuit_breaker") return "managed-daemon-circuit-breaker";
  if (normalized && normalized !== "unknown") return "factory-cli-runtime-crash";
  return "managed-daemon-circuit-breaker";
}

function deriveCircuitBreakerSeverity(crashType = "") {
  const normalized = trim(crashType).toLowerCase();
  if (normalized === "module_not_found" || normalized === "merge_marker_in_executable") return "blocking";
  if (normalized === "judge_failure" || normalized === "stalled_execution") return "informational";
  return "degrading";
}

function resolveResolutionType(severity = "") {
  const normalized = trim(severity).toLowerCase();
  if (normalized === "blocking") return "trip_and_route_foreman";
  if (normalized === "informational") return "log";
  return "cooldown_auto_retry";
}

export function classifyTickFailureTombstone({
  runtime = {},
  tickId = "",
  runId = "",
  exitCode = 1,
  evidenceText = "",
  graphPath = "",
} = {}) {
  const crashType = inferTickFailureCrashType(evidenceText);
  const bugType = inferTickFailureBugType(crashType);
  const classifier = classifySupervisorFailure({
    bugType,
    sourceRepo: runtime.targetRepo,
    controlPlaneRepo: runtime.controlPlaneRepo || runtime.targetRepo,
    factoryId: runtime.factoryId,
    evidence: {
      crash_type: crashType,
      pipeline: trim(graphPath || runtime.dispatchGraph || runtime.supervisorGraph || ""),
    },
  });
  const severity = deriveCircuitBreakerSeverity(crashType);
  const tombstoneId = trim(runId) || trim(tickId) || "tick-failure";

  return {
    tombstone_id: tombstoneId,
    bug_type: bugType,
    classification: {
      classification: classifier.classification,
      severity,
      crash_type: classifier.crash_type || crashType,
      rationale: classifier.rationale || "tick_failure_evidence",
      resolution_type: resolveResolutionType(severity),
    },
    evidence: {
      exit_code: Number(exitCode) || 1,
      run_id: trim(runId),
      tick_id: trim(tickId),
      excerpt: String(evidenceText || "").trim(),
    },
  };
}

export async function runTick({
  runtime = {},
  paths = {},
  repoRoot = "",
  hostBaseDir = "",
  activeChildRef = { current: null },
  daemonLogPath = "",
  appendLogLineFn = () => {},
  spawnImpl = spawn,
  nowMsFn = Date.now,
} = {}) {
  const tickStartAtIso = new Date().toISOString();
  const tickStartMs = nowMsFn();
  const tickLogPath = resolveTickLogPath(paths, runtime.factoryId);
  const tickId = path.basename(tickLogPath, ".log");
  const tickLogStream = createWriteStream(tickLogPath, { flags: "a" });
  const dispatchLatencySloSeconds = normalizeDispatchLatencySloSeconds(
    runtime.dispatchLatencySloSeconds,
    DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
  );
  const maintenanceIntervalSeconds = normalizeMaintenanceIntervalSeconds(
    runtime.maintenanceIntervalSeconds,
    DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
  );

  const hatchExecutable = existsSync(path.resolve(repoRoot, "node_modules/.bin/hatch"))
    ? path.resolve(repoRoot, "node_modules/.bin/hatch")
    : "hatch";

  const tickEnv = buildTickEnv({ runtime, paths, hostBaseDir });

  const contextPayload = JSON.stringify({
    repo: runtime.contextRepoPath,
    target_repo: runtime.targetRepo,
    gh_repo: runtime.targetRepo,
    factory_id: runtime.factoryId,
  });

  const runGraph = async (graphPath = "", graphRole = "tick") => {
    const resolvedGraphPath = trim(graphPath);
    if (!resolvedGraphPath) {
      return {
        exitCode: 0,
        runId: "",
        tickIdle: false,
        graphPath: "",
        graphRole,
      };
    }

    tickLogStream.write(`\n[graph_start role=${graphRole} graph=${resolvedGraphPath}]\n`);
    const graphStartMs = nowMsFn();
    let graphLog = "";
    const hatchArgs = [
      "run",
      resolvedGraphPath,
    ];
    if (trim(runtime.factoryRoot)) {
      hatchArgs.push("--factory-root", trim(runtime.factoryRoot));
    }
    hatchArgs.push(
      "--context",
      contextPayload,
      "--live",
    );
    const child = spawnImpl(hatchExecutable, hatchArgs, {
      cwd: repoRoot,
      env: tickEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeChildRef.current = child;
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      graphLog += text;
      tickLogStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      graphLog += text;
      tickLogStream.write(chunk);
    });

    const exitCode = await new Promise((resolve) => {
      child.on("error", () => resolve(1));
      child.on("exit", (code) => resolve(Number(code) || 0));
    });

    activeChildRef.current = null;

    const runId = extractRunIdFromText(graphLog);
    return {
      exitCode,
      runId,
      tickIdle: readTickIdleFromRunState(runtime.runsDir, runId),
      graphPath: resolvedGraphPath,
      graphRole,
      durationMs: normalizeFiniteDurationMs(nowMsFn() - graphStartMs),
    };
  };

  const dispatchRun = await runGraph(runtime.dispatchGraph || runtime.supervisorGraph, "dispatch");
  const dispatchSlo = evaluateDispatchLatencySlo({
    dispatchDurationMs: dispatchRun.durationMs,
    dispatchLatencySloSeconds,
  });
  appendLogLineFn(
    daemonLogPath,
    `dispatch_latency_slo status=${dispatchSlo.ok ? "ok" : "breach"} duration_ms=${dispatchSlo.duration_ms} slo_seconds=${dispatchSlo.slo_seconds} overage_ms=${dispatchSlo.overage_ms}`,
  );

  let maintenanceRun = null;
  let maintenanceDecision = {
    due: false,
    reason: "maintenance_graph_not_configured",
    remaining_ms: 0,
    interval_seconds: maintenanceIntervalSeconds,
    last_completed_at: "",
  };
  if (
    dispatchRun.exitCode === 0
    && trim(runtime.supervisorGraph)
    && trim(runtime.supervisorGraph) !== trim(dispatchRun.graphPath)
  ) {
    maintenanceDecision = evaluateMaintenanceTickDue({
      factoryId: runtime.factoryId,
      rootDir: repoRoot,
      nowMs: nowMsFn(),
      maintenanceIntervalSeconds,
    });
    if (maintenanceDecision.due) {
      maintenanceRun = await runGraph(runtime.supervisorGraph, "maintenance");
      if (maintenanceRun.exitCode === 0) {
        writeMaintenanceTickState({
          factoryId: runtime.factoryId,
          rootDir: repoRoot,
          completedAt: new Date().toISOString(),
          runId: maintenanceRun.runId,
          tickId,
        });
      }
    } else {
      appendLogLineFn(
        daemonLogPath,
        `maintenance_tick_skipped reason=${maintenanceDecision.reason} remaining_ms=${maintenanceDecision.remaining_ms} interval_seconds=${maintenanceDecision.interval_seconds}`,
      );
    }
  }

  await new Promise((resolve) => {
    tickLogStream.end(resolve);
  });

  const effectiveRun = maintenanceRun && maintenanceRun.exitCode !== 0
    ? maintenanceRun
    : dispatchRun.exitCode !== 0
      ? dispatchRun
      : dispatchRun;
  const exitCode = dispatchRun.exitCode !== 0
    ? dispatchRun.exitCode
    : maintenanceRun?.exitCode || 0;
  const runId = trim(effectiveRun.runId || extractRunIdFromTickLog(tickLogPath));
  const tickIdle = Boolean(dispatchRun.tickIdle);
  const failureEvidence = exitCode === 0 ? "" : readFileSync(tickLogPath, "utf8");
  const failureTombstone = exitCode === 0
    ? null
    : classifyTickFailureTombstone({
      runtime,
      tickId,
      runId,
      exitCode,
      evidenceText: failureEvidence,
      graphPath: effectiveRun.graphPath || runtime.dispatchGraph || runtime.supervisorGraph,
    });
  const tickEndAtIso = new Date().toISOString();
  const durationMs = normalizeFiniteDurationMs(nowMsFn() - tickStartMs);
  appendLogLineFn(
    daemonLogPath,
    `tick_complete run_id=${runId || "unknown"} tick_id=${tickId} tick_idle=${tickIdle ? "true" : "false"} exit=${exitCode} dispatch_duration_ms=${dispatchRun.durationMs} maintenance_duration_ms=${maintenanceRun?.durationMs || 0} dispatch_slo_status=${dispatchSlo.ok ? "ok" : "breach"} maintenance_reason=${maintenanceDecision.reason}`,
  );

  return {
    exitCode,
    tickIdle,
    runId,
    tickId,
    tickLogPath,
    failureTombstone,
    startedAt: tickStartAtIso,
    endedAt: tickEndAtIso,
    durationMs,
    dispatchDurationMs: dispatchRun.durationMs,
    dispatchSlo,
    maintenanceDurationMs: maintenanceRun?.durationMs || 0,
    maintenanceDecision,
  };
}
