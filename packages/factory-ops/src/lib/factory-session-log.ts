import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function parseJson(raw, fallback = null) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function readRunState(runsDir, runId) {
  try {
    return parseJson(readFileSync(join(runsDir, runId, "state.json"), "utf8"), null);
  } catch {
    return null;
  }
}

export function listRunIds(runsDir) {
  try { return readdirSync(runsDir); } catch { return []; }
}

export function excerpt(value, max = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function selectTargetRun(states, requestedRunId = "") {
  if (requestedRunId) return requestedRunId;
  const running = states.filter((s) => String(s?.status || "") === "running");
  const waveIssue = running
    .filter((s) => String(s?.pipelineFile || s?.pipeline || "").includes("wave_issue_execute.dot"))
    .sort((a, b) => parseIsoMs(b?.updatedAt) - parseIsoMs(a?.updatedAt));
  if (waveIssue[0]?.runId) return waveIssue[0].runId;
  const anyRunning = running.sort((a, b) => parseIsoMs(b?.updatedAt) - parseIsoMs(a?.updatedAt));
  return anyRunning[0]?.runId || states[0]?.runId || "";
}

function fileMtime(path) {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function walkJsonlFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  return files;
}

export function latestJsonlInDir(rootDir) {
  const files = walkJsonlFiles(rootDir);
  if (!files.length) return "";
  files.sort((a, b) => fileMtime(b) - fileMtime(a) || b.localeCompare(a));
  return files[0];
}

export function renderSessionLine(rawLine) {
  const event = parseJson(rawLine, null);
  if (!event || typeof event !== "object") return rawLine;

  if (event.type === "message") {
    const msg = event.message || {};
    const timestamp = event.timestamp ? `[${event.timestamp}] ` : "";
    if (msg.role === "assistant") {
      const textParts = Array.isArray(msg.content)
        ? msg.content.filter((part) => part?.type === "text").map((part) => String(part.text || "").trim()).filter(Boolean)
        : [];
      const toolParts = Array.isArray(msg.content)
        ? msg.content.filter((part) => part?.type === "toolCall").map((part) => `${part.name}(${JSON.stringify(part.arguments || {})})`)
        : [];
      const rendered = [...toolParts, ...textParts].filter(Boolean).join(" | ");
      return `${timestamp}assistant ${rendered}`.trim();
    }
    if (msg.role === "toolResult") {
      const text = Array.isArray(msg.content)
        ? msg.content.filter((part) => part?.type === "text").map((part) => String(part.text || "").trim()).filter(Boolean).join(" ")
        : "";
      const status = msg.isError ? "error" : "ok";
      return `${timestamp}tool:${msg.toolName || "unknown"} ${status} ${text}`.trim();
    }
  }

  if (event.type === "session") {
    return `[session] id=${event.id || ""}`.trim();
  }

  return rawLine;
}

function classifyNodeTraceKind(currentNode = "") {
  const node = String(currentNode || "").trim().toLowerCase();
  if (!node) return "run";
  if (node === "build" || node.includes("build")) return "coder";
  if (node === "review" || node.includes("review")) return "reviewer";
  if (node === "judge" || node.includes("judge")) return "judge";
  if (node.startsWith("supervisor_") || node === "resolve_conflict" || node.includes("manager")) {
    return "manager";
  }
  return "llm";
}

function normalizeRole(value = "") {
  const role = String(value || "").trim().toLowerCase();
  if (["coder", "reviewer", "manager", "judge"].includes(role)) return role;
  return "";
}

function normalizeTraceKind(value = "") {
  const traceKind = String(value || "").trim().toLowerCase();
  if (["coder", "reviewer", "manager", "judge", "run", "llm", "none"].includes(traceKind)) return traceKind;
  return "";
}

function inferRoleFromTraceKind(traceKind = "") {
  const kind = normalizeTraceKind(traceKind);
  if (["coder", "reviewer", "manager", "judge"].includes(kind)) return kind;
  return "";
}

function inferRoleFromPath(path = "") {
  const normalized = String(path || "").toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("/review/")) return "reviewer";
  if (normalized.includes("/judge/")) return "judge";
  if (normalized.includes("/supervisor_") || normalized.includes("/manager") || normalized.includes("resolve_conflict")) {
    return "manager";
  }
  if (normalized.includes("/build/") || normalized.includes("/codergen")) return "coder";
  return "";
}

function latestFromFiles(files = [], predicate = null) {
  const filtered = typeof predicate === "function" ? files.filter(predicate) : [...files];
  if (!filtered.length) return "";
  filtered.sort((a, b) => fileMtime(b) - fileMtime(a) || b.localeCompare(a));
  return filtered[0] || "";
}

function sessionPathMatch(path = "", sessionId = "") {
  if (!sessionId) return true;
  const normalizedPath = String(path || "").toLowerCase();
  const normalizedSession = String(sessionId || "").trim().toLowerCase();
  return normalizedPath.includes(`/${normalizedSession}/`) || normalizedPath.includes(normalizedSession);
}

export function resolveSessionTrace(runState, options = {}) {
  const ctx = runState?.context || {};
  const childMetadata = options.childMetadata || {};
  const explicitRole = normalizeRole(childMetadata.role) || inferRoleFromTraceKind(childMetadata.traceKind);
  const explicitTraceKind = normalizeTraceKind(childMetadata.traceKind) || explicitRole;
  const explicitSessionId = String(childMetadata.sessionId || "").trim();

  const repo = String(ctx.repo || options.repo || "").trim();
  const waveSessionsDir = String(ctx.wave_sessions_dir || "").trim();
  const effectiveAgentSessionId = explicitSessionId || String(ctx.agent_session_id || "").trim();
  const fallbackRunSessionsDir = String(
    ctx.__run_sessions_dir || options.runSessionsDir || "",
  ).trim();
  const currentNode = String(runState?.currentNode || "").trim();
  const runNodeDir = fallbackRunSessionsDir && currentNode
    ? join(fallbackRunSessionsDir, currentNode)
    : "";
  const waveSessionDir = repo && waveSessionsDir && effectiveAgentSessionId
    ? join(repo, waveSessionsDir, effectiveAgentSessionId)
    : "";

  const allRunLogs = fallbackRunSessionsDir ? walkJsonlFiles(fallbackRunSessionsDir) : [];

  if (explicitRole === "coder" && waveSessionDir) {
    const coderWaveLog = latestJsonlInDir(waveSessionDir);
    if (coderWaveLog) {
      return {
        sessionLog: coderWaveLog,
        traceKind: explicitTraceKind || "coder",
      };
    }
  }

  if (allRunLogs.length && explicitSessionId) {
    const bySession = latestFromFiles(allRunLogs, (path) => sessionPathMatch(path, explicitSessionId));
    if (bySession) {
      return {
        sessionLog: bySession,
        traceKind: explicitTraceKind || normalizeTraceKind(inferRoleFromPath(bySession)) || classifyNodeTraceKind(currentNode),
      };
    }
  }

  if (allRunLogs.length && explicitRole) {
    const byRole = latestFromFiles(allRunLogs, (path) => inferRoleFromPath(path) === explicitRole);
    if (byRole) {
      return {
        sessionLog: byRole,
        traceKind: explicitTraceKind || explicitRole,
      };
    }
  }

  // Match the active node when we can:
  // - build/edit-style work follows the wave worktree session
  // - review/supervisor/codergen work follows the per-run node session
  if (currentNode === "build" && waveSessionDir) {
    const waveLog = latestJsonlInDir(waveSessionDir);
    if (waveLog) return { sessionLog: waveLog, traceKind: explicitTraceKind || "coder" };
  }

  if (runNodeDir) {
    const nodeLog = latestJsonlInDir(runNodeDir);
    if (nodeLog) {
      return {
        sessionLog: nodeLog,
        traceKind: explicitTraceKind || classifyNodeTraceKind(currentNode),
      };
    }
  }

  if (fallbackRunSessionsDir) {
    const runLog = latestJsonlInDir(fallbackRunSessionsDir);
    if (runLog) {
      return {
        sessionLog: runLog,
        traceKind: explicitTraceKind || normalizeTraceKind(inferRoleFromPath(runLog)) || "run",
      };
    }
  }

  if (waveSessionDir) {
    const waveLog = latestJsonlInDir(waveSessionDir);
    if (waveLog) return { sessionLog: waveLog, traceKind: explicitTraceKind || "coder" };
  }

  return { sessionLog: "", traceKind: explicitTraceKind || "none" };
}

export function findLatestSessionLog(runState, options = {}) {
  return resolveSessionTrace(runState, options).sessionLog;
}

export function readSessionEntries(sessionPath) {
  if (!sessionPath) return [];
  let raw = "";
  try { raw = readFileSync(sessionPath, "utf8"); } catch { return []; }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .filter(Boolean);
}

export function readSessionTail(sessionPath, maxItems = 3) {
  const entries = readSessionEntries(sessionPath);
  let latestAssistantText = "";
  const toolCalls = [];
  const toolResults = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const event = entries[i];
    if (event?.type !== "message") continue;
    const msg = event.message || {};

    if (!latestAssistantText && msg.role === "assistant") {
      const textPart = Array.isArray(msg.content)
        ? msg.content.find((part) => part?.type === "text" && String(part?.text || "").trim())
        : null;
      if (textPart?.text) latestAssistantText = String(textPart.text);
    }

    if (msg.role === "assistant" && Array.isArray(msg.content) && toolCalls.length < maxItems) {
      for (const part of msg.content) {
        if (part?.type !== "toolCall") continue;
        toolCalls.push({
          name: String(part?.name || ""),
          timestamp: event.timestamp || "",
          arguments: excerpt(JSON.stringify(part?.arguments || {}), 200),
        });
        if (toolCalls.length >= maxItems) break;
      }
    }

    if (msg.role === "toolResult" && toolResults.length < maxItems) {
      const first = Array.isArray(msg.content) ? msg.content.find((part) => part?.type === "text") : null;
      toolResults.push({
        tool_name: String(msg.toolName || ""),
        is_error: Boolean(msg.isError),
        timestamp: event.timestamp || "",
        output: excerpt(first?.text || "", 220),
      });
    }

    if (latestAssistantText && toolCalls.length >= maxItems && toolResults.length >= maxItems) break;
  }

  return {
    latestAssistantText,
    toolCalls,
    toolResults,
  };
}
