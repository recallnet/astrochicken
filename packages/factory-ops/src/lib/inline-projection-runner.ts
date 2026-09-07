import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repairWorkspaceBootstrap } from "./workspace-package-manager.ts";

// @context:regression !critical — NODE_PATH must NOT be stripped. The daemon
// script sets it to repo root node_modules so inline scripts can resolve
// workspace packages (pg, @hatch/factory-core). Stripping it caused
// module_not_found crashes that tripped the blocking circuit breaker.
const INLINE_PROJECTION_STRIP_ENV_KEYS = Object.freeze([
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
  "INIT_CWD",
  "NODE_OPTIONS",
]);

export function resolveInlineProjectionCwd(moduleUrl) {
  return new URL("../../../..", moduleUrl).pathname;
}

export function buildInlineProjectionEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (INLINE_PROJECTION_STRIP_ENV_KEYS.includes(key)) {
      delete env[key];
      continue;
    }
    if (key.startsWith("npm_") || key.startsWith("PNPM_")) {
      // @context:regression !critical Inline projection children are plain
      // Node subprocesses, not pnpm-managed entrypoints. Hook/package-manager
      // bookkeeping env can point at ephemeral temp roots and break workspace
      // package resolution inside projection imports.
      delete env[key];
    }
  }
  return env;
}

export function runInlineProjectionSync({ moduleUrl, script, env = process.env } = {}) {
  const cwd = resolveInlineProjectionCwd(moduleUrl);
  const tempDir = mkdtempSync(join(tmpdir(), "hatch-inline-projection-"));
  const scriptPath = join(tempDir, "inline-projection.mjs");
  const bootstrap = repairWorkspaceBootstrap({
    repoRoot: cwd,
    workspaceDir: cwd,
    env,
    requiredArtifacts: [],
  });
  if (!bootstrap.ok) {
    throw new Error(bootstrap.reason || "inline_projection_workspace_bootstrap_failed");
  }
  // @context:regression !critical Executing a real temporary module file is
  // more stable than `node --input-type=module -e` under the external-CWD CLI
  // portability gate. The eval form intermittently lost bare package
  // resolution (`pg`) inside imported projection modules during hook runs.
  writeFileSync(scriptPath, script, "utf8");
  try {
    return execFileSync(
      process.execPath,
      [scriptPath],
      {
        // @context:integration !critical Inline canonical projection children
        // must run from the repo root, not the caller's temp cwd. The
        // portability contracts launch CLI commands from external factory roots,
        // and canonical projections can traverse workspace-owned imports across
        // packages (`@hatch/factory-core` via github-adapter), so package-root
        // cwd is still too narrow for deterministic resolution.
        cwd,
        encoding: "utf8",
        env: buildInlineProjectionEnv(env),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}
