import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  BRIDGE_UNAVAILABLE,
  NOT_STREAMING,
  SESSION_NOT_FOUND,
  SessionTransportError,
  createSessionTransport,
} from "../../src/lib/session-transport.ts";

function makeSocketMock() {
  const emitter = new EventEmitter();
  const writes = [];

  emitter.destroyed = false;
  emitter.write = (value = "") => {
    writes.push(String(value));
    return true;
  };
  emitter.destroy = () => {
    if (emitter.destroyed) return;
    emitter.destroyed = true;
    emitter.emit("close");
  };

  return {
    socket: emitter,
    writes,
  };
}

function popRpcRequest(writes = []) {
  const line = String(writes.shift() || "").trim();
  assert.ok(line, "expected JSON-RPC request write");
  return JSON.parse(line);
}

function emitRpcResult(socket, { id = "", result = {} } = {}) {
  socket.emit("data", `${JSON.stringify({ id, result })}\n`);
}

function emitRpcError(socket, { id = "", code = "", message = "" } = {}) {
  socket.emit("data", `${JSON.stringify({ id, error: { code, message } })}\n`);
}

test("session transport subscribe lifecycle sets and clears isStreaming", async () => {
  const { socket, writes } = makeSocketMock();

  const transport = createSessionTransport({
    factoryId: "mothership",
    target: { run_id: "run-live", trace_kind: "coder" },
    resolveHostPathsFn: () => ({ socketDir: "/tmp/mothership/sockets" }),
    dialBridgeFn: async () => socket,
  });

  const events = [];
  const unsubscribe = transport.subscribe((event) => {
    events.push(event);
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const subscribeRequest = popRpcRequest(writes);
  assert.equal(subscribeRequest.method, "session.subscribe");
  assert.equal(subscribeRequest.params.target.run_id, "run-live");
  emitRpcResult(socket, { id: subscribeRequest.id, result: { streaming: true } });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(transport.isStreaming(), true);
  assert.equal(events.some((entry) => entry?.type === "session_transport.connected"), true);

  socket.emit("data", `${JSON.stringify({ type: "assistant.delta", text: "hello" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.some((entry) => entry?.type === "assistant.delta"), true);

  unsubscribe();
  assert.equal(transport.isStreaming(), false);
  assert.equal(socket.destroyed, true);
});

test("steer and followUp reject with not_streaming when no active stream", async () => {
  const transport = createSessionTransport({
    factoryId: "mothership",
    target: { run_id: "run-live", trace_kind: "coder" },
    resolveHostPathsFn: () => ({ socketDir: "/tmp/mothership/sockets" }),
    dialBridgeFn: async () => {
      throw new Error("bridge unavailable during lazy subscribe");
    },
  });

  await assert.rejects(
    transport.steer("nudge"),
    (error) => error instanceof SessionTransportError && error.code === NOT_STREAMING,
  );

  await assert.rejects(
    transport.followUp("queue this"),
    (error) => error instanceof SessionTransportError && error.code === NOT_STREAMING,
  );
});

test("bridge unavailable maps to bridge_unavailable", async () => {
  const transport = createSessionTransport({
    factoryId: "mothership",
    target: { run_id: "run-404", trace_kind: "coder" },
    resolveHostPathsFn: () => ({ socketDir: "/tmp/mothership/sockets" }),
    dialBridgeFn: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  let errorEventCode = "";
  const unsubscribe = transport.subscribe((event) => {
    if (event?.type === "session_transport.error") errorEventCode = String(event.code || "");
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(transport.isStreaming(), false);
  assert.equal(errorEventCode, BRIDGE_UNAVAILABLE);
  unsubscribe();
});

test("unknown or stale session maps to session_not_found", async () => {
  const { socket, writes } = makeSocketMock();

  const transport = createSessionTransport({
    factoryId: "mothership",
    target: { run_id: "stale-run", trace_kind: "coder" },
    resolveHostPathsFn: () => ({ socketDir: "/tmp/mothership/sockets" }),
    dialBridgeFn: async () => socket,
  });

  const unsubscribe = transport.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  const subscribeRequest = popRpcRequest(writes);
  emitRpcError(socket, {
    id: subscribeRequest.id,
    code: "session_not_found",
    message: "session not found",
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(transport.isStreaming(), false);

  await assert.rejects(
    transport.steer("retry"),
    (error) => error instanceof SessionTransportError && error.code === SESSION_NOT_FOUND,
  );

  unsubscribe();
});

test("steer and followUp send deterministic bridge methods once streaming", async () => {
  const { socket, writes } = makeSocketMock();

  const transport = createSessionTransport({
    factoryId: "mothership",
    target: { run_id: "run-live", trace_kind: "reviewer" },
    resolveHostPathsFn: () => ({ socketDir: "/tmp/mothership/sockets" }),
    dialBridgeFn: async () => socket,
  });

  const unsubscribe = transport.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  const subscribeRequest = popRpcRequest(writes);
  emitRpcResult(socket, { id: subscribeRequest.id, result: { streaming: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const steerPromise = transport.steer("please stop after current tool");
  const steerRequest = popRpcRequest(writes);
  assert.equal(steerRequest.method, "session.steer");
  assert.equal(steerRequest.params.message, "please stop after current tool");
  emitRpcResult(socket, { id: steerRequest.id, result: { ok: true } });
  await steerPromise;

  const followPromise = transport.followUp("follow up after idle");
  const followRequest = popRpcRequest(writes);
  assert.equal(followRequest.method, "session.follow_up");
  assert.equal(followRequest.params.message, "follow up after idle");
  emitRpcResult(socket, { id: followRequest.id, result: { ok: true } });
  await followPromise;

  unsubscribe();
});
