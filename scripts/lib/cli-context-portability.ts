import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const GIT_HOOK_ENV_KEYS = Object.freeze([
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
  "NODE_OPTIONS",
  "NODE_PATH",
]);

const PORTABLE_NODE_BOOTSTRAP_CHECKS = Object.freeze([
  ["node_modules", "@hatch", "factory-ops", "package.json"],
  ["packages", "factory-ops", "node_modules", "@hatch", "factory-core", "package.json"],
  ["packages", "factory-ops", "node_modules", "@hatch", "github-adapter", "package.json"],
  ["packages", "factory-ops", "node_modules", "@recallnet", "factory-telemetry", "package.json"],
  ["packages", "factory-ops", "node_modules", "clipanion", "package.json"],
  ["packages", "factory-ops", "node_modules", "hatch", "package.json"],
  ["packages", "factory-ops", "node_modules", "pg", "package.json"],
  ["packages", "github-adapter", "node_modules", "@hatch", "factory-core", "package.json"],
  ["packages", "github-adapter", "node_modules", "zod", "package.json"],
  ["apps", "hatch", "node_modules", "@hatch", "factory-core", "package.json"],
  ["apps", "hatch", "node_modules", "@recallnet", "factory-telemetry", "package.json"],
]);

export function buildPortableChildEnv(baseEnv = process.env, { command } = {}) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (GIT_HOOK_ENV_KEYS.includes(key)) {
      delete env[key];
      continue;
    }
    if (key === "INIT_CWD") {
      delete env[key];
      continue;
    }
    if (key.startsWith("npm_") || key.startsWith("PNPM_")) {
      // @context:regression !critical Portability checks must model an operator
      // shell, not inherit hook-owned pnpm bookkeeping. Under git hooks these
      // vars can point at temp package roots and corrupt nested workspace
      // resolution for both `pnpm exec vitest` and direct node children.
      delete env[key];
    }
  }
  return env;
}

export function portableNodeBootstrapMissing(repoRoot = process.cwd()) {
  return PORTABLE_NODE_BOOTSTRAP_CHECKS.some((segments) => !existsSync(path.resolve(repoRoot, ...segments)));
}

function repairPortableNodeBootstrap(baseEnv = process.env) {
  const repoRoot = process.cwd();
  if (!existsSync(path.resolve(repoRoot, "package.json"))) return;
  if (!existsSync(path.resolve(repoRoot, "node_modules", ".pnpm"))) return;
  if (!existsSync(path.resolve(repoRoot, "scripts", "postinstall-bootstrap.mjs"))) return;
  if (!portableNodeBootstrapMissing(repoRoot)) return;
  spawnSync(process.execPath, ["scripts/postinstall-bootstrap.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: buildPortableChildEnv(baseEnv, { command: "node" }),
    stdio: "ignore",
  });
}

export function runOnce(label, command, args, baseEnv = process.env) {
  if (command === "node") {
    repairPortableNodeBootstrap(baseEnv);
  }
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: buildPortableChildEnv(baseEnv, { command }),
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    return {
      ok: false,
      reason: "spawn_error",
      message: String(result.error),
      exit: 1,
      signal: result.signal,
      output: `${result.stdout || ""}${result.stderr || ""}`,
    };
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  return {
    ok: exitStatus === 0,
    reason: exitStatus === 0 ? "pass" : "context_model_mismatch",
    exit: exitStatus,
    signal: result.signal,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

export function isRetryableCliContextFailure(label, result) {
  if (!result || result.ok) {
    return false;
  }
  if (result.signal || result.exit >= 128) {
    return true;
  }
  // @context:regression !critical — The factory-ops portability child can
  // intermittently fail module resolution for repo-owned/runtime-owned
  // packages when spawned from the pnpm-owned portability gate under hook
  // pressure. Retry only that exact factory-ops child-resolution class so
  // real contract failures still fail closed on the first attempt.
  return (
    label === "factory_ops_context" &&
    result.exit === 1 &&
    /(ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module )/.test(result.output || "") &&
    /packages\/(factory-ops|github-adapter|factory-telemetry)|apps\/hatch/.test(result.output || "")
  );
}
