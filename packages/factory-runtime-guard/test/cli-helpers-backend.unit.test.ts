import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFactoryBackend,
  resolveBackendConfig,
} from "../src/cli-helpers.ts";

const FACTORY_CONFIG = {
  backend: {
    type: "local_fs",
    store_root: "/cfg/store",
  },
};

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "factory-runtime-guard-backend-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeFactoryConfig(storeRoot) {
  return {
    backend: {
      type: "local_fs",
      store_root: storeRoot,
    },
  };
}

function validMutationContext() {
  return {
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_test_01",
    run_id: "run_01",
    tick_id: "tick_01",
    destination_name: "goal_issues",
    capability_version: "capability.v1",
    policy_profile: "policy_pack:v1",
    runtime_version: "1.2.3",
  };
}

test("resolveBackendConfig defaults to github when no config/env is provided", () => {
  const resolved = resolveBackendConfig({
    factoryConfig: {},
    env: {},
  });

  assert.deepEqual(resolved, {
    type: "github",
    storeRoot: "",
    backendConfig: {},
  });
});

test("resolveBackendConfig reads backend.type and backend.store_root from factory config", () => {
  const resolved = resolveBackendConfig({
    factoryConfig: FACTORY_CONFIG,
    env: {},
  });

  assert.deepEqual(resolved, {
    type: "local_fs",
    storeRoot: "/cfg/store",
    backendConfig: {
      type: "local_fs",
      store_root: "/cfg/store",
    },
  });
});

test("resolveBackendConfig applies deterministic precedence (explicit > env > config > default)", () => {
  const fromConfigAndEnv = resolveBackendConfig({
    factoryConfig: FACTORY_CONFIG,
    env: {
      HATCH_BACKEND_TYPE: "github",
      HATCH_BACKEND_STORE_ROOT: "/env/store",
    },
  });
  assert.equal(fromConfigAndEnv.type, "github");
  assert.equal(fromConfigAndEnv.storeRoot, "/env/store");

  const fromExplicit = resolveBackendConfig({
    type: "github",
    storeRoot: "/explicit/store",
    factoryConfig: FACTORY_CONFIG,
    env: {
      HATCH_BACKEND_TYPE: "local_fs",
      HATCH_BACKEND_STORE_ROOT: "/env/store",
    },
  });
  assert.equal(fromExplicit.type, "github");
  assert.equal(fromExplicit.storeRoot, "/explicit/store");

  const fromEnv = resolveBackendConfig({
    factoryConfig: {},
    env: {
      HATCH_BACKEND_TYPE: "local_fs",
      HATCH_BACKEND_STORE_ROOT: "/env/store",
    },
  });
  assert.equal(fromEnv.type, "local_fs");
  assert.equal(fromEnv.storeRoot, "/env/store");
});

test("createFactoryBackend resolves github by default", () => {
  const backend = createFactoryBackend({
    repo: "o/r",
    env: {},
  });

  assert.equal(backend.repo, "o/r");
  assert.equal(typeof backend.issueList, "function");
});

test("createFactoryBackend resolves local_fs from factory config", () => {
  withTempStore((storeRoot) => {
    const backend = createFactoryBackend({
      repo: "o/r",
      factoryConfig: makeFactoryConfig(storeRoot),
      env: {},
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T00:00:00.000Z",
    });

    assert.equal(backend.repo, "o/r");
    assert.deepEqual(backend.issueList({}), []);
  });
});

test("createFactoryBackend fails closed when local_fs has no store root", () => {
  assert.throws(
    () => createFactoryBackend({
      repo: "o/r",
      factoryConfig: { backend: { type: "local_fs" } },
      env: {},
    }),
    /storeRoot is required for local_fs backend/,
  );
});

test("createFactoryBackend requires repo", () => {
  assert.throws(
    () => createFactoryBackend({
      factoryConfig: {},
      env: {},
    }),
    /repo is required/,
  );
});
