import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortableChildEnv,
  isRetryableCliContextFailure,
  portableNodeBootstrapMissing,
} from "./cli-context-portability.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("buildPortableChildEnv strips pnpm bookkeeping env even for pnpm children", () => {
  const env = buildPortableChildEnv(
    {
      INIT_CWD: "/tmp/worktree",
      npm_config_user_agent: "pnpm",
      npm_config_local_prefix: "/tmp/run-gates/repo",
      npm_command: "exec",
      npm_execpath: "/tmp/pnpm.cjs",
      npm_lifecycle_event: "pre-push",
      npm_lifecycle_script: "node scripts/run-gates.mjs",
      npm_package_json: "/tmp/run-gates/package.json",
      PNPM_HOME: "/opt/pnpm",
      PNPM_STORE_PATH: "/opt/pnpm/store",
      PNPM_SCRIPT_SRC_DIR: "/tmp/run-gates",
      KEEP_ME: "yes",
    },
    { command: "pnpm" },
  );

  assert.equal(env.INIT_CWD, undefined);
  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.npm_config_local_prefix, undefined);
  assert.equal(env.npm_command, undefined);
  assert.equal(env.npm_execpath, undefined);
  assert.equal(env.npm_lifecycle_event, undefined);
  assert.equal(env.npm_lifecycle_script, undefined);
  assert.equal(env.npm_package_json, undefined);
  assert.equal(env.PNPM_HOME, undefined);
  assert.equal(env.PNPM_STORE_PATH, undefined);
  assert.equal(env.PNPM_SCRIPT_SRC_DIR, undefined);
  assert.equal(env.KEEP_ME, "yes");
});

test("buildPortableChildEnv strips package manager env for non-pnpm children", () => {
  const env = buildPortableChildEnv(
    {
      INIT_CWD: "/tmp/worktree",
      GIT_DIR: "/tmp/bare/worktrees/repo",
      GIT_PREFIX: "packages/factory-ops/",
      npm_config_user_agent: "pnpm",
      PNPM_HOME: "/opt/pnpm",
      KEEP_ME: "yes",
    },
    { command: "node" },
  );

  assert.equal(env.INIT_CWD, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_PREFIX, undefined);
  assert.equal(env.npm_config_user_agent, undefined);
  assert.equal(env.PNPM_HOME, undefined);
  assert.equal(env.KEEP_ME, "yes");
});

test("isRetryableCliContextFailure retries signal kills", () => {
  assert.equal(
    isRetryableCliContextFailure("hatch_cli_context", {
      ok: false,
      exit: 254,
      signal: null,
      output: "",
    }),
    true,
  );
});

test("isRetryableCliContextFailure retries the known transient module-resolution failures only for factory_ops_context", () => {
  const transientResolutionFailure = {
    ok: false,
    exit: 1,
    signal: null,
    output: [
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'clipanion' imported from /repo/packages/factory-ops/src/cli/commands/research.ts",
      "Node.js v22.22.1",
    ].join("\n"),
  };
  const transientCjsFailure = {
    ok: false,
    exit: 1,
    signal: null,
    output: [
      "Error: Cannot find module 'debug'",
      "Require stack:",
      "/repo/node_modules/.pnpm/extract-zip@2.0.1/node_modules/extract-zip/index.js",
      "imported from /repo/apps/hatch/dist/pipeline/handler/codergen.js",
    ].join("\n"),
  };

  assert.equal(isRetryableCliContextFailure("factory_ops_context", transientResolutionFailure), true);
  assert.equal(isRetryableCliContextFailure("factory_ops_context", transientCjsFailure), true);
  assert.equal(isRetryableCliContextFailure("hatch_cli_context", transientResolutionFailure), false);
});

test("isRetryableCliContextFailure does not retry ordinary contract failures", () => {
  assert.equal(
    isRetryableCliContextFailure("factory_ops_context", {
      ok: false,
      exit: 1,
      signal: null,
      output: "AssertionError: expected 1 to equal 0",
    }),
    false,
  );
});

test("portableNodeBootstrapMissing detects missing repo-owned links for plain node portability checks", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "cli-context-bootstrap-"));
  mkdirSync(path.join(repoRoot, "node_modules", "@hatch", "factory-ops"), { recursive: true });
  writeFileSync(path.join(repoRoot, "node_modules", "@hatch", "factory-ops", "package.json"), "{}\n");

  assert.equal(portableNodeBootstrapMissing(repoRoot), true);

  for (const relativePath of [
    "packages/factory-ops/node_modules/@hatch/factory-core/package.json",
    "packages/factory-ops/node_modules/@hatch/github-adapter/package.json",
    "packages/factory-ops/node_modules/@recallnet/factory-telemetry/package.json",
    "packages/factory-ops/node_modules/clipanion/package.json",
    "packages/factory-ops/node_modules/hatch/package.json",
    "packages/factory-ops/node_modules/pg/package.json",
    "packages/github-adapter/node_modules/@hatch/factory-core/package.json",
    "packages/github-adapter/node_modules/zod/package.json",
    "apps/hatch/node_modules/@hatch/factory-core/package.json",
    "apps/hatch/node_modules/@recallnet/factory-telemetry/package.json",
  ]) {
    const absolutePath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "{}\n");
  }

  assert.equal(portableNodeBootstrapMissing(repoRoot), false);
});
