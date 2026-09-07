import assert from "node:assert/strict";
import test from "node:test";

import {
  createResumableSessionRuntime,
  resolveHistoricalResumeTarget,
} from "../../src/lib/session-resume.ts";

test("resolveHistoricalResumeTarget derives resumable metadata from completed run state", () => {
  const reads = [];
  const target = resolveHistoricalResumeTarget({
    factoryId: "mothership",
    repoRoot: "/repo",
    traceKind: "reviewer",
    state: {
      runId: "run-1",
      status: "completed",
      context: {
        agent_session_id: "issue-2174-review",
        __run_sessions_dir: "/tmp/runs/run-1/sessions",
        worktree_dir: "/tmp/worktrees/2174",
      },
    },
    readJsonFileFn: (filePath) => {
      reads.push(filePath);
      return {
        nodes: [
          { class: "reviewer", provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
        ],
      };
    },
    existsSyncFn: (candidate) => candidate === "/tmp/runs/run-1/sessions/issue-2174-review" || candidate === "/tmp/worktrees/2174",
  });

  assert.equal(reads.length, 1);
  assert.equal(target.session_id, "issue-2174-review");
  assert.equal(target.session_dir, "/tmp/runs/run-1/sessions/issue-2174-review");
  assert.equal(target.cwd, "/tmp/worktrees/2174");
  assert.equal(target.provider, "openrouter");
  assert.equal(target.model, "anthropic/claude-sonnet-4.6");
  assert.equal(target.tool_mode, "read_only");
});

test("createResumableSessionRuntime continues persisted session with matching tool mode", async () => {
  const calls = {};
  const fakeSession = {
    prompt: async (message) => {
      calls.prompt = message;
    },
    subscribe(listener) {
      listener({ type: "assistant.delta", text: "restored" });
      return () => {
        calls.unsubscribed = true;
      };
    },
    dispose() {
      calls.disposed = true;
    },
  };

  const runtime = await createResumableSessionRuntime({
    target: {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      cwd: "/tmp/worktree",
      session_dir: "/tmp/sessions/issue-2174-review",
      tool_mode: "read_only",
    },
    AuthStorageCtor: {
      create() {
        calls.authStorage = true;
        return { kind: "auth" };
      },
    },
    ModelRegistryCtor: class {
      constructor(authStorage) {
        calls.authStorageRef = authStorage;
      }

      find(provider, model) {
        calls.modelLookup = `${provider}/${model}`;
        return { provider, id: model };
      }
    },
    DefaultResourceLoaderCtor: class {
      async reload() {
        calls.loaderReloaded = true;
      }
    },
    SessionManagerImpl: {
      continueRecent(cwd, sessionDir) {
        calls.sessionManager = { cwd, sessionDir };
        return { cwd, sessionDir };
      },
    },
    SettingsManagerImpl: {
      inMemory(options) {
        calls.settings = options;
        return { options };
      },
    },
    createReadOnlyToolsFn(cwd) {
      calls.readOnlyTools = cwd;
      return ["ro"];
    },
    createCodingToolsFn(cwd) {
      calls.codingTools = cwd;
      return ["rw"];
    },
    createAgentSessionFn: async (options) => {
      calls.sessionOptions = options;
      return { session: fakeSession };
    },
  });

  const events = [];
  const unsubscribe = runtime.subscribe((event) => events.push(event));
  await runtime.prompt("continue from here");
  unsubscribe();
  runtime.dispose();

  assert.equal(calls.modelLookup, "openrouter/anthropic/claude-sonnet-4.6");
  assert.deepEqual(calls.sessionManager, { cwd: "/tmp/worktree", sessionDir: "/tmp/sessions/issue-2174-review" });
  assert.equal(calls.readOnlyTools, "/tmp/worktree");
  assert.equal(calls.codingTools, undefined);
  assert.equal(calls.loaderReloaded, true);
  assert.equal(calls.prompt, "continue from here");
  assert.equal(events[0]?.type, "assistant.delta");
  assert.equal(calls.unsubscribed, true);
  assert.equal(calls.disposed, true);
});
