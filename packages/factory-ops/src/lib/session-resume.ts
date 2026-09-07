import { existsSync } from "node:fs";
import path from "node:path";

import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

import { readJsonFile } from "./io.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function sanitizeSessionPath(value = "") {
  return trim(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function compactObject(value = {}) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === "" || entry === null || entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

function resolveInventoryPath({ repoRoot = ".", factoryId = "" } = {}) {
  return path.resolve(String(repoRoot || "."), "factories", trim(factoryId) || "mothership", "inventory", "llm-role-session-baseline.json");
}

function loadInventoryRoutes({ repoRoot = ".", factoryId = "", readJsonFileFn = readJsonFile } = {}) {
  const inventory = readJsonFileFn(resolveInventoryPath({ repoRoot, factoryId }), null);
  return Array.isArray(inventory?.nodes) ? inventory.nodes : [];
}

function firstRouteForClass(routes = [], className = "") {
  const needle = trim(className);
  return routes.find((entry) => trim(entry?.class).replace(/^\./, "") === needle) || null;
}

function resolveResumeProfile({ traceKind = "", routes = [] } = {}) {
  const normalized = trim(traceKind).toLowerCase();
  const className = normalized === "manager"
    ? "supervisor"
    : (["coder", "reviewer", "judge"].includes(normalized) ? normalized : "");
  if (!className) return null;
  const route = firstRouteForClass(routes, className);
  if (!route) return null;
  const provider = trim(route.provider);
  const model = trim(route.model);
  if (!provider || !model) return null;
  return {
    class_name: className,
    provider,
    model,
    tool_mode: className === "coder" || className === "supervisor" ? "coding" : "read_only",
  };
}

function resolveSessionDir({ context = {}, sessionId = "", traceKind = "" } = {}) {
  const normalizedSession = sanitizeSessionPath(sessionId);
  if (!normalizedSession) return "";
  const normalizedTrace = trim(traceKind).toLowerCase();
  const runSessionsDir = trim(context.__run_sessions_dir);
  if (runSessionsDir) return path.resolve(runSessionsDir, normalizedSession);
  const repo = trim(context.repo);
  const waveSessionsDir = trim(context.wave_sessions_dir);
  if (repo && waveSessionsDir && normalizedTrace === "coder") {
    return path.resolve(repo, waveSessionsDir, normalizedSession);
  }
  return "";
}

function resolveResumeCwd({ context = {}, traceKind = "" } = {}) {
  const worktreeDir = trim(context.worktree_dir);
  if (worktreeDir) return path.resolve(worktreeDir);
  const repo = trim(context.repo);
  if (repo) return path.resolve(repo);
  return "";
}

export function resolveHistoricalResumeTarget({
  state = {},
  factoryId = "",
  traceKind = "",
  repoRoot = ".",
  readJsonFileFn = readJsonFile,
  existsSyncFn = existsSync,
} = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  const sessionId = trim(context.agent_session_id || context.session_id || context["hatch.session_id"]);
  const sessionDir = resolveSessionDir({ context, sessionId, traceKind });
  const cwd = resolveResumeCwd({ context, traceKind });
  if (!sessionId || !sessionDir || !cwd) return null;
  if (!existsSyncFn(sessionDir) || !existsSyncFn(cwd)) return null;

  const routes = loadInventoryRoutes({ repoRoot, factoryId, readJsonFileFn });
  const profile = resolveResumeProfile({ traceKind, routes });
  if (!profile) return null;

  return compactObject({
    factory_id: trim(factoryId),
    run_id: trim(state?.runId),
    session_id: sessionId,
    session_dir: sessionDir,
    cwd,
    provider: profile.provider,
    model: profile.model,
    tool_mode: profile.tool_mode,
    trace_kind: trim(traceKind).toLowerCase(),
    status: trim(state?.status || ""),
  });
}

export async function createResumableSessionRuntime({
  target = {},
  createAgentSessionFn = createAgentSession,
  createCodingToolsFn = createCodingTools,
  createReadOnlyToolsFn = createReadOnlyTools,
  AuthStorageCtor = AuthStorage,
  ModelRegistryCtor = ModelRegistry,
  DefaultResourceLoaderCtor = DefaultResourceLoader,
  SessionManagerImpl = SessionManager,
  SettingsManagerImpl = SettingsManager,
} = {}) {
  const normalized = target && typeof target === "object" ? target : {};
  const provider = trim(normalized.provider);
  const modelId = trim(normalized.model);
  const cwd = trim(normalized.cwd);
  const sessionDir = trim(normalized.session_dir);
  if (!provider || !modelId || !cwd || !sessionDir) {
    throw new Error("resumable_session_target_invalid");
  }

  const authStorage = AuthStorageCtor.create();
  const modelRegistry = new ModelRegistryCtor(authStorage);
  const model = modelRegistry.find(provider, modelId);
  if (!model) throw new Error(`resumable_session_model_unavailable:${provider}/${modelId}`);

  const resourceLoader = new DefaultResourceLoaderCtor();
  if (typeof resourceLoader.reload === "function") await resourceLoader.reload();
  const tools = normalized.tool_mode === "read_only"
    ? createReadOnlyToolsFn(cwd)
    : createCodingToolsFn(cwd);
  const sessionManager = SessionManagerImpl.continueRecent(cwd, sessionDir);
  const settingsManager = SettingsManagerImpl.inMemory({
    compaction: { enabled: true, reserveTokens: 98304, keepRecentTokens: 32768 },
  });
  const created = await createAgentSessionFn({
    cwd,
    model,
    thinkingLevel: "high",
    tools,
    sessionManager,
    settingsManager,
    resourceLoader,
    authStorage,
    modelRegistry,
  });
  const session = created?.session;
  if (!session) throw new Error("resumable_session_missing_session");
  return {
    session,
    subscribe(listener) {
      return typeof session.subscribe === "function" ? session.subscribe(listener) : (() => {});
    },
    async prompt(message = "") {
      await session.prompt(trim(message));
    },
    async compact() {
      if (typeof session.compact === "function") await session.compact();
    },
    dispose() {
      if (typeof session.dispose === "function") session.dispose();
    },
  };
}
