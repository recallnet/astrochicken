import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildInlineProjectionEnv,
  resolveInlineProjectionCwd,
  runInlineProjectionSync,
} from "../../src/lib/inline-projection-runner.ts";

test("resolveInlineProjectionCwd anchors inline projection children at the repo root", () => {
  assert.equal(
    resolveInlineProjectionCwd("file:///repo/packages/factory-ops/src/lib/factory-status-canonical.ts"),
    "/repo/",
  );
});

test("runInlineProjectionSync resolves repo-owned imports from the package root", () => {
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: `
      const mod = await import(${JSON.stringify(new URL("../../src/lib/factory-status-postgres-projection.ts", import.meta.url).href)});
      process.stdout.write(typeof mod.projectFactoryStatusToPostgres);
    `,
  });

  assert.equal(String(stdout), "function");
});

test("runInlineProjectionSync resolves package dependencies even when the caller cwd is external", () => {
  const previousCwd = process.cwd();
  const externalCwd = mkdtempSync(join(tmpdir(), "inline-projection-cwd-"));
  process.chdir(externalCwd);
  try {
    const stdout = runInlineProjectionSync({
      moduleUrl: new URL("../../src/lib/factory-status-canonical.ts", import.meta.url).href,
      script: `
        const mod = await import(${JSON.stringify(new URL("../../src/lib/factory-status-postgres-projection.ts", import.meta.url).href)});
        process.stdout.write(typeof mod.projectFactoryStatusToPostgres);
      `,
    });

    assert.equal(String(stdout), "function");
  } finally {
    process.chdir(previousCwd);
  }
});

test("runInlineProjectionSync resolves workspace-owned imports used by inline projections", () => {
  const stdout = runInlineProjectionSync({
    moduleUrl: new URL("../../src/lib/factory-status-canonical.ts", import.meta.url).href,
    script: `
      const mod = await import(${JSON.stringify(new URL("../../../github-adapter/src/backend-selection-schema.ts", import.meta.url).href)});
      process.stdout.write(typeof mod.resolveBackendSelection);
    `,
  });

  assert.equal(String(stdout), "function");
});

test("runInlineProjectionSync repairs workspace bootstrap for canonical lifecycle imports", () => {
  const stdout = runInlineProjectionSync({
    moduleUrl: new URL("../../src/lib/factory-tick-canonical.ts", import.meta.url).href,
    script: `
      const mod = await import(${JSON.stringify(new URL("../../src/lib/canonical-issue-lifecycle.ts", import.meta.url).href)});
      process.stdout.write(typeof mod.listCanonicalGoalCandidatesForRepoSync);
    `,
  });

  assert.equal(String(stdout), "function");
});

test("buildInlineProjectionEnv strips hook and package-manager bookkeeping", () => {
  const env = buildInlineProjectionEnv({
    GIT_DIR: "/tmp/git-dir",
    GIT_PREFIX: "tmp-prefix",
    INIT_CWD: "/tmp/init-cwd",
    npm_execpath: "/tmp/pnpm.cjs",
    PNPM_SCRIPT_SRC_DIR: "/tmp/src",
    HATCH_CANONICAL_EVENT_STORE_URL: "postgres://example",
    PATH: process.env.PATH,
  });

  assert.equal("GIT_DIR" in env, false);
  assert.equal("GIT_PREFIX" in env, false);
  assert.equal("INIT_CWD" in env, false);
  assert.equal("npm_execpath" in env, false);
  assert.equal("PNPM_SCRIPT_SRC_DIR" in env, false);
  assert.equal(env.HATCH_CANONICAL_EVENT_STORE_URL, "postgres://example");
  assert.equal(env.PATH, process.env.PATH);
});
