import assert from "node:assert/strict";
import test from "node:test";

import { buildTickEnv, resolveLlmIsolationFromConfig } from "../../src/lib/daemon-llm-isolation.ts";

test("resolveLlmIsolationFromConfig normalizes factory isolation contract", () => {
  const isolation = resolveLlmIsolationFromConfig({
    isolation: {
      authStoragePath: "~/.pi/auth-factory-a.json",
      provider: { envVar: "HATCH_MODEL_PROVIDER", value: "openai" },
      model: { envVar: "HATCH_MODEL", value: "gpt-5.4" },
    },
  });

  assert.equal(isolation.providerEnvVar, "HATCH_MODEL_PROVIDER");
  assert.equal(isolation.providerValue, "openai");
  assert.equal(isolation.modelValue, "gpt-5.4");
  assert.match(isolation.authStoragePath, /auth-factory-a\.json$/);
});

test("buildTickEnv injects factory LLM isolation into the hatch child env", () => {
  const env = buildTickEnv({
    runtime: {
      factoryId: "brainstorm",
      factoryRoot: "/tmp/factory",
      factoryConfigPath: "/tmp/factory/factory.config.json",
      runsDir: "/tmp/runs",
      targetRepo: "example-org/example-notes",
      targetRepo: "example-org/example-notes",
      contextRepoPath: "/tmp/example-notes",
      mutationContext: { instance_id: "fac_01TEST" },
      llmIsolation: {
        providerEnvVar: "HATCH_MODEL_PROVIDER",
        providerValue: "openai",
        modelEnvVar: "HATCH_MODEL",
        modelValue: "gpt-5.4",
        authStoragePath: "/tmp/auth-fac_01TEST.json",
      },
    },
    paths: {
      hostRoot: "/tmp/host",
      logsDir: "/tmp/logs",
      pidDir: "/tmp/pid",
      pidFile: "/tmp/pid/factory-daemon.pid",
      lockDir: "/tmp/pid/factory-daemon.lock",
      tmpDir: "/tmp/tmp",
      socketDir: "/tmp/socket",
    },
    hostBaseDir: "/tmp/host-base",
    processEnv: {},
  });

  assert.equal(env.HATCH_MODEL_PROVIDER, "openai");
  assert.equal(env.HATCH_MODEL, "gpt-5.4");
  assert.equal(env.HATCH_AUTH_STORAGE_PATH, "/tmp/auth-fac_01TEST.json");
});

test("buildTickEnv sets HATCH_TARGET_REPO and HATCH_TARGET_REPO from runtime", () => {
  const env = buildTickEnv({
    runtime: {
      factoryId: "brainstorm",
      targetRepo: "example-org/example-notes",
      targetRepo: "example-org/example-notes",
      mutationContext: {},
      repoRoleContext: {},
    },
    paths: {},
    processEnv: {},
  });

  assert.equal(env.HATCH_TARGET_REPO, "example-org/example-notes");
  assert.equal(env.HATCH_TARGET_REPO, "example-org/example-notes");
});

test("buildTickEnv overrides inherited HATCH_TARGET_REPO from parent process env", () => {
  const env = buildTickEnv({
    runtime: {
      factoryId: "brainstorm",
      targetRepo: "example-org/example-notes",
      targetRepo: "example-org/example-notes",
      mutationContext: {},
      repoRoleContext: {},
    },
    paths: {},
    processEnv: {
      HATCH_TARGET_REPO: "recallnet/astrochicken",
      HATCH_TARGET_REPO: "recallnet/astrochicken",
      HATCH_INSTANCE_ID: "mothership",
    },
  });

  assert.equal(env.HATCH_TARGET_REPO, "example-org/example-notes", "must override inherited HATCH_TARGET_REPO");
  assert.equal(env.HATCH_TARGET_REPO, "example-org/example-notes", "must override inherited HATCH_TARGET_REPO");
  assert.equal(env.HATCH_INSTANCE_ID, "brainstorm", "must override inherited HATCH_INSTANCE_ID");
});
