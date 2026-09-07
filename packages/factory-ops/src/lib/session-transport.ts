import { createConnection } from "node:net";
import { join } from "node:path";

import { resolveHostPaths } from "../commands/factory-host-lifecycle.ts";

export const BRIDGE_UNAVAILABLE = "bridge_unavailable";
export const SESSION_NOT_FOUND = "session_not_found";
export const NOT_STREAMING = "not_streaming";

export const SESSION_TRANSPORT_ERROR_CODE_BRIDGE_UNAVAILABLE = BRIDGE_UNAVAILABLE;
export const SESSION_TRANSPORT_ERROR_CODE_SESSION_NOT_FOUND = SESSION_NOT_FOUND;
export const SESSION_TRANSPORT_ERROR_CODE_NOT_STREAMING = NOT_STREAMING;
export const SESSION_TRANSPORT_ERROR_CODES = Object.freeze({
  bridge_unavailable: BRIDGE_UNAVAILABLE,
  session_not_found: SESSION_NOT_FOUND,
  not_streaming: NOT_STREAMING,
});

const REQUEST_TIMEOUT_MS = 15_000;

const SESSION_NOT_FOUND_TOKENS = [
  "session_not_found",
  "unknown_session",
  "stale_session",
  "no_active_session",
  "session missing",
  "session not found",
  "unknown session",
  "stale session",
];

const NOT_STREAMING_TOKENS = [
  "not_streaming",
  "stream_not_active",
  "streaming_required",
  "stream is not active",
  "not streaming",
];

function trim(value = "") {
  return String(value || "").trim();
}

function asErrorMessage(value = "") {
  return trim(value) || "session_transport_error";
}

function toLower(value = "") {
  return trim(value).toLowerCase();
}

function includesAnyToken(haystack = "", tokens = []) {
  const normalized = toLower(haystack);
  if (!normalized) return false;
  for (const token of tokens) {
    if (!token) continue;
    if (normalized.includes(toLower(token))) return true;
  }
  return false;
}

function normalizeBridgeErrorCode(errorLike = null) {
  const fromCode = toLower(errorLike?.code || "");
  const fromType = toLower(errorLike?.type || "");
  const fromName = toLower(errorLike?.name || "");
  const fromReason = toLower(errorLike?.reason || "");
  const fromMessage = toLower(errorLike?.message || "");
  const merged = [fromCode, fromType, fromName, fromReason, fromMessage].join(" ").trim();

  if (includesAnyToken(merged, NOT_STREAMING_TOKENS)) return NOT_STREAMING;
  if (includesAnyToken(merged, SESSION_NOT_FOUND_TOKENS)) return SESSION_NOT_FOUND;
  return BRIDGE_UNAVAILABLE;
}

function normalizeBridgeErrorMessage(errorLike = null) {
  if (!errorLike) return "session_transport_bridge_failure";
  const direct = asErrorMessage(errorLike.message || errorLike.error || "");
  if (direct) return direct;
  return "session_transport_bridge_failure";
}

function toSessionTransportError(errorLike = null, fallbackCode = BRIDGE_UNAVAILABLE) {
  if (errorLike instanceof SessionTransportError) return errorLike;

  const code = normalizeBridgeErrorCode(errorLike) || fallbackCode;
  const message = normalizeBridgeErrorMessage(errorLike);
  return new SessionTransportError(code, message, { cause: errorLike || undefined });
}

function encodeRequestLine(payload = {}) {
  return `${JSON.stringify(payload)}\n`;
}

function parseResponseLine(line = "") {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function settlePendingWithError(pending = new Map(), error = null) {
  const mapped = toSessionTransportError(error, BRIDGE_UNAVAILABLE);
  for (const [id, entry] of pending.entries()) {
    pending.delete(id);
    clearTimeout(entry.timeout);
    entry.reject(mapped);
  }
}

function parseRpcResponseError(response = {}) {
  if (!response || typeof response !== "object") return null;

  if (response.ok === false && response.error === undefined) {
    return {
      code: BRIDGE_UNAVAILABLE,
      message: "session_bridge_request_failed",
    };
  }

  if (response.error && typeof response.error === "object") {
    return {
      code: trim(response.error.code || ""),
      message: asErrorMessage(response.error.message || "session_bridge_error"),
      reason: trim(response.error.reason || ""),
    };
  }

  if (typeof response.error === "string") {
    return {
      code: trim(response.code || ""),
      message: response.error,
      reason: trim(response.reason || ""),
    };
  }

  return null;
}

export class SessionTransportError extends Error {
  constructor(code = BRIDGE_UNAVAILABLE, message = "session_transport_error", { cause = undefined } = {}) {
    super(asErrorMessage(message));
    this.name = "SessionTransportError";
    this.code = normalizeBridgeErrorCode({ code }) || BRIDGE_UNAVAILABLE;
    if (cause !== undefined) this.cause = cause;
  }
}

export function resolveSessionTransportSocketPath({
  factoryId = "",
  hostBaseDir = "",
  logsRoot = "",
  runsDir = "",
  tmpDir = "",
  socketDir = "",
  pidDir = "",
  bridgeSocketName = "session-bridge.sock",
  resolveHostPathsFn = resolveHostPaths,
} = {}) {
  const paths = resolveHostPathsFn({
    factoryId,
    baseDir: hostBaseDir,
    logsRoot,
    runsDir,
    tmpDir,
    socketDir,
    pidDir,
  });

  return {
    socketPath: join(paths.socketDir, trim(bridgeSocketName) || "session-bridge.sock"),
    hostPaths: paths,
  };
}

function defaultDial({ socketPath = "", connectTimeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy(new Error(`session_bridge_connect_timeout:${socketPath}`));
    }, Math.max(100, Number(connectTimeoutMs) || 2000));

    const onError = (error) => {
      clearTimeout(timeout);
      reject(error);
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function buildTransportTarget({
  target = null,
  runId = "",
  sessionId = "",
  traceKind = "",
  node = "",
  role = "",
  childId = "",
  parentNodeId = "",
  workerIndex = null,
} = {}) {
  const provided = target && typeof target === "object" ? target : {};
  const normalized = {
    run_id: trim(provided.run_id || runId),
    session_id: trim(provided.session_id || sessionId),
    trace_kind: trim(provided.trace_kind || traceKind),
    node: trim(provided.node || node),
    role: trim(provided.role || role),
    child_id: trim(provided.child_id || childId),
    parent_node_id: trim(provided.parent_node_id || parentNodeId),
    worker_index: Number.isFinite(Number(provided.worker_index ?? workerIndex))
      ? Number(provided.worker_index ?? workerIndex)
      : null,
  };

  const hasAnyIdentifier = Boolean(
    normalized.run_id
    || normalized.session_id
    || normalized.child_id
    || normalized.parent_node_id,
  );

  if (!hasAnyIdentifier) {
    throw new SessionTransportError(
      SESSION_NOT_FOUND,
      "session_transport_target_required",
    );
  }

  return normalized;
}

export function createSessionTransport({
  factoryId = "",
  hostBaseDir = "",
  logsRoot = "",
  runsDir = "",
  tmpDir = "",
  socketDir = "",
  pidDir = "",
  bridgeSocketName = "session-bridge.sock",
  connectTimeoutMs = 2000,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  target = null,
  runId = "",
  sessionId = "",
  traceKind = "",
  node = "",
  role = "",
  childId = "",
  parentNodeId = "",
  workerIndex = null,
  resolveHostPathsFn = resolveHostPaths,
  dialBridgeFn = defaultDial,
  spawnBridgeFn = null,
  autoSpawnBridge = false,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    throw new SessionTransportError(SESSION_NOT_FOUND, "session_transport_factory_id_required");
  }

  const resolvedSocket = resolveSessionTransportSocketPath({
    factoryId: normalizedFactoryId,
    hostBaseDir,
    logsRoot,
    runsDir,
    tmpDir,
    socketDir,
    pidDir,
    bridgeSocketName,
    resolveHostPathsFn,
  });

  const normalizedTarget = buildTransportTarget({
    target,
    runId,
    sessionId,
    traceKind,
    node,
    role,
    childId,
    parentNodeId,
    workerIndex,
  });

  const listeners = new Set();
  const pendingRequests = new Map();

  let socket = null;
  let readBuffer = "";
  let requestSeq = 0;
  let streaming = false;
  let connectPromise = null;
  let lastFailure = null;
  let spawnAttempted = false;

  function emitEvent(event = {}) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures are isolated to keep stream deterministic.
      }
    }
  }

  function resetSocket({ preserveFailure = false } = {}) {
    const previousSocket = socket;
    socket = null;
    readBuffer = "";
    streaming = false;
    if (!preserveFailure) lastFailure = null;

    if (previousSocket && typeof previousSocket.destroy === "function" && !previousSocket.destroyed) {
      previousSocket.destroy();
    }
  }

  function handleSocketData(chunk) {
    readBuffer += String(chunk || "");
    const lines = readBuffer.split("\n");
    readBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = trim(line);
      if (!trimmed) continue;
      const payload = parseResponseLine(trimmed);
      if (!payload) continue;

      const responseId = payload.id === undefined || payload.id === null ? "" : String(payload.id);
      if (responseId && pendingRequests.has(responseId)) {
        const pending = pendingRequests.get(responseId);
        pendingRequests.delete(responseId);
        clearTimeout(pending.timeout);

        const responseError = parseRpcResponseError(payload);
        if (responseError) {
          pending.reject(toSessionTransportError(responseError, BRIDGE_UNAVAILABLE));
          continue;
        }

        pending.resolve(payload.result ?? payload.data ?? payload);
        continue;
      }

      emitEvent(payload);
    }
  }

  function bindSocket(nextSocket) {
    socket = nextSocket;

    socket.on("data", handleSocketData);
    socket.on("error", (error) => {
      lastFailure = toSessionTransportError(error, BRIDGE_UNAVAILABLE);
    });
    socket.on("close", () => {
      const failure = lastFailure || new SessionTransportError(BRIDGE_UNAVAILABLE, "session_bridge_closed");
      settlePendingWithError(pendingRequests, failure);
      streaming = false;
      if (listeners.size > 0) {
        emitEvent({
          type: "session_transport.error",
          code: failure.code,
          message: failure.message,
        });
      }
      socket = null;
      readBuffer = "";
    });
  }

  function nextRequestId() {
    requestSeq += 1;
    return String(requestSeq);
  }

  function sendRequest(method = "", params = {}) {
    if (!socket || socket.destroyed) {
      return Promise.reject(new SessionTransportError(BRIDGE_UNAVAILABLE, "session_bridge_disconnected"));
    }

    const id = nextRequestId();
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new SessionTransportError(BRIDGE_UNAVAILABLE, `session_bridge_timeout:${method}`));
      }, Math.max(100, Number(requestTimeoutMs) || REQUEST_TIMEOUT_MS));

      pendingRequests.set(id, { resolve, reject, timeout });

      try {
        socket.write(encodeRequestLine(payload));
      } catch (error) {
        pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(toSessionTransportError(error, BRIDGE_UNAVAILABLE));
      }
    });
  }

  async function dialWithOptionalSpawn() {
    try {
      return await dialBridgeFn({
        socketPath: resolvedSocket.socketPath,
        connectTimeoutMs,
        factoryId: normalizedFactoryId,
        target: normalizedTarget,
      });
    } catch (error) {
      if (!autoSpawnBridge || typeof spawnBridgeFn !== "function" || spawnAttempted) {
        throw error;
      }
      spawnAttempted = true;
      await Promise.resolve(spawnBridgeFn({
        socketPath: resolvedSocket.socketPath,
        factoryId: normalizedFactoryId,
        target: normalizedTarget,
      }));
      return dialBridgeFn({
        socketPath: resolvedSocket.socketPath,
        connectTimeoutMs,
        factoryId: normalizedFactoryId,
        target: normalizedTarget,
      });
    }
  }

  async function ensureStreamingConnection() {
    if (streaming && socket && !socket.destroyed) return;
    if (connectPromise) {
      await connectPromise;
      return;
    }

    connectPromise = (async () => {
      const nextSocket = await dialWithOptionalSpawn();
      bindSocket(nextSocket);

      const response = await sendRequest("session.subscribe", {
        target: normalizedTarget,
      });

      if (response && response.streaming === false) {
        throw new SessionTransportError(NOT_STREAMING, "session_bridge_not_streaming");
      }

      streaming = true;
      lastFailure = null;
      emitEvent({
        type: "session_transport.connected",
        target: normalizedTarget,
      });
    })();

    try {
      await connectPromise;
    } catch (error) {
      const mapped = toSessionTransportError(error, BRIDGE_UNAVAILABLE);
      lastFailure = mapped;
      resetSocket({ preserveFailure: true });
      emitEvent({
        type: "session_transport.error",
        code: mapped.code,
        message: mapped.message,
      });
    } finally {
      connectPromise = null;
    }
  }

  async function sendSteering(method = "", message = "") {
    const trimmedMessage = trim(message);
    if (!trimmedMessage) return;

    if (!streaming || !socket || socket.destroyed) {
      if (lastFailure) throw lastFailure;
      throw new SessionTransportError(NOT_STREAMING, "session_transport_not_streaming");
    }

    try {
      await sendRequest(method, {
        target: normalizedTarget,
        message: trimmedMessage,
      });
    } catch (error) {
      const mapped = toSessionTransportError(error, BRIDGE_UNAVAILABLE);
      lastFailure = mapped;
      throw mapped;
    }
  }

  return {
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("session_transport_listener_required");
      }

      listeners.add(listener);
      void ensureStreamingConnection();

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size > 0) return;
        resetSocket();
      };
    },

    async steer(message = "") {
      await sendSteering("session.steer", message);
    },

    async followUp(message = "") {
      await sendSteering("session.follow_up", message);
    },

    isStreaming() {
      return Boolean(streaming && socket && !socket.destroyed);
    },
  };
}
