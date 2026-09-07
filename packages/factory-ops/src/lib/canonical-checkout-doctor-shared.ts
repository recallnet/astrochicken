import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyManagedWorktreePath, resolveCanonicalCheckoutPath } from "./canonical-worktree.ts";
import { trim } from "./cli-helpers.ts";
import {
  DEFAULT_GLOBAL_CLI_LINK_NAME,
  resolveCanonicalFactoryOpsCliPath,
  resolveGlobalCliLinkPath,
} from "./global-cli-link.ts";
import { loadFactoryConfig } from "../commands/factory-config-loader.ts";
import { resolveHostPaths } from "../commands/factory-host-lifecycle.ts";

const REPO_SENTINELS = new Set([
  ".git",
  ".githooks",
  "apps",
  "docs",
  "factories",
  "pnpm-lock.yaml",
  "package.json",
  "packages",
  "scripts",
  "turbo.json",
]);

export function runCommand(command = "", args = [], options = {}) {
  const out = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  return {
    ok: out.status === 0,
    status: Number(out.status ?? 1),
    stdout: String(out.stdout || "").trim(),
    stderr: String(out.stderr || "").trim(),
  };
}

export function gitAt(repoPath = "", args = [], options = {}) {
  return runCommand("git", ["-C", repoPath, ...args], options);
}

export function samePath(left = "", right = "") {
  if (!trim(left) || !trim(right)) return false;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

export function isGitWorktree(repoPath = "") {
  const resolvedRepoPath = trim(repoPath);
  if (!resolvedRepoPath || !existsSync(resolvedRepoPath)) return false;
  const out = gitAt(resolvedRepoPath, ["rev-parse", "--show-toplevel"]);
  if (!out.ok) return false;
  return samePath(out.stdout, resolvedRepoPath);
}

export function readCurrentBranch(repoPath = "") {
  const out = gitAt(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return out.ok ? trim(out.stdout) : "";
}

function readOriginUrl(repoPath = "") {
  const out = gitAt(repoPath, ["config", "--get", "remote.origin.url"]);
  return out.ok ? trim(out.stdout) : "";
}

function parseWorktreeList(raw = "") {
  const entries = [];
  let current = null;
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current?.path) entries.push(current);
      current = { path: trim(line.slice("worktree ".length)) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) current.branch = trim(line.slice("branch ".length));
    if (line === "bare") current.bare = true;
    if (line === "detached") current.detached = true;
    if (line.startsWith("locked")) current.locked = true;
    if (line.startsWith("prunable")) current.prunable = true;
  }
  if (current?.path) entries.push(current);
  return entries;
}

function readWorktreeList(repoPath = "") {
  const out = gitAt(repoPath, ["worktree", "list", "--porcelain"]);
  return out.ok ? parseWorktreeList(out.stdout) : [];
}

export function resolveCliTarget(linkPath = "") {
  const resolvedLinkPath = trim(linkPath);
  if (!resolvedLinkPath || !existsSync(resolvedLinkPath)) return "";
  try {
    if (!lstatSync(resolvedLinkPath).isSymbolicLink()) return "";
    return realpathSync(
      path.resolve(path.dirname(resolvedLinkPath), readlinkSync(resolvedLinkPath)),
    );
  } catch {
    return "";
  }
}

function isSafeToReplaceCanonicalShell(targetPath = "") {
  let entries = [];
  try {
    entries = readdirSync(targetPath).filter(Boolean);
  } catch {
    entries = [];
  }
  if (entries.length === 0) return true;
  return entries.every((entry) => !REPO_SENTINELS.has(entry));
}

function resolveSourceRepoPath(repoRoot = "", canonicalCheckoutPath = "") {
  for (const candidate of [canonicalCheckoutPath, repoRoot]) {
    if (isGitWorktree(candidate)) return path.resolve(candidate);
  }
  return "";
}

export function resolveCanonicalMirrorPath({ factoryId = "", env = process.env } = {}) {
  const paths = resolveHostPaths({
    factoryId: trim(factoryId) || "mothership",
    baseDir: env.HATCH_HOST_BASE_DIR,
    env,
  });
  return path.resolve(paths.hostDir, "git-cache", "canonical-checkout.git");
}

function buildCheck(id, ok, extra = {}) {
  return { id, ok, ...extra };
}

export function loadDoctorContext({
  repoRoot = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  linkDir = "",
  linkName = DEFAULT_GLOBAL_CLI_LINK_NAME,
} = {}) {
  const resolvedRepoRoot = path.resolve(trim(repoRoot) || process.cwd());
  const { config } = loadFactoryConfig({
    configPath: path.resolve(resolvedRepoRoot, "factories", "mothership", "factory.config.json"),
  });
  const factoryId = trim(config?.factory_id || "mothership");
  const canonicalCheckoutPath = resolveCanonicalCheckoutPath({
    config,
    env,
    baseDir: resolvedRepoRoot,
  });
  const sourceRepoPath = resolveSourceRepoPath(resolvedRepoRoot, canonicalCheckoutPath);
  return {
    repo_root: resolvedRepoRoot,
    config,
    factory_id: factoryId,
    canonical_checkout_path: canonicalCheckoutPath,
    source_repo_path: sourceRepoPath,
    origin_url: readOriginUrl(sourceRepoPath),
    link_path: resolveGlobalCliLinkPath({ homeDir, linkDir, linkName }),
    canonical_cli_path: resolveCanonicalFactoryOpsCliPath(canonicalCheckoutPath),
    mirror_path: resolveCanonicalMirrorPath({ factoryId, env }),
  };
}

export function inspectProtectedWorktreeRegistry({
  sourceRepoPath = "",
  canonicalCheckoutPath = "",
} = {}) {
  if (!sourceRepoPath) {
    return buildCheck("protected_worktree_registry_sane", false, {
      reason: "git_source_unavailable",
      entries: [],
    });
  }

  const entries = readWorktreeList(sourceRepoPath);
  const seen = new Set();
  const issues = [];
  let canonicalMatches = 0;
  for (const entry of entries) {
    const entryPath = path.resolve(String(entry?.path || ""));
    if (seen.has(entryPath)) issues.push(`duplicate_worktree:${entryPath}`);
    seen.add(entryPath);
    if (canonicalCheckoutPath && samePath(entryPath, canonicalCheckoutPath)) canonicalMatches += 1;
    const classification = classifyManagedWorktreePath({
      candidatePath: entryPath,
      repoPath: sourceRepoPath,
      canonicalCheckoutPath,
    });
    if (
      entryPath.includes(`${path.sep}.hatch-worktrees${path.sep}`)
      && !classification.approvedDisposable
    ) {
      issues.push(`unapproved_disposable_root:${entryPath}`);
    }
  }
  if (canonicalCheckoutPath && existsSync(canonicalCheckoutPath) && canonicalMatches !== 1) {
    issues.push(`canonical_worktree_registry_count:${canonicalMatches}`);
  }
  return buildCheck("protected_worktree_registry_sane", issues.length === 0, {
    reason: issues.length === 0 ? "ok" : "registry_violation",
    issues,
    entries,
  });
}

export function inspectCanonicalCheckoutState(context = {}) {
  const canonicalPath = context.canonical_checkout_path;
  const canonicalCliPath = trim(context.canonical_cli_path || "");
  const cliTarget = resolveCliTarget(context.link_path);
  const canonicalIsWorktree = Boolean(canonicalPath) && isGitWorktree(canonicalPath);
  const canonicalBranch = canonicalIsWorktree ? readCurrentBranch(canonicalPath) : "";
  return [
    buildCheck("canonical_checkout_configured", Boolean(canonicalPath), {
      reason: canonicalPath ? "ok" : "canonical_checkout_path_missing",
    }),
    buildCheck("canonical_checkout_exists", Boolean(canonicalPath && existsSync(canonicalPath)), { reason: canonicalPath && existsSync(canonicalPath) ? "ok" : "canonical_checkout_missing" }),
    buildCheck("canonical_checkout_is_worktree", canonicalIsWorktree, {
      reason: canonicalIsWorktree ? "ok" : "canonical_checkout_not_git_worktree",
    }),
    buildCheck("canonical_checkout_branch_main", canonicalBranch === "main", {
      reason: canonicalBranch === "main" ? "ok" : "canonical_checkout_not_on_main",
      branch: canonicalBranch,
    }),
    buildCheck(
      "global_cli_targets_canonical",
      Boolean(canonicalCliPath) && Boolean(cliTarget) && samePath(cliTarget, canonicalCliPath),
      {
        reason: samePath(cliTarget, canonicalCliPath) ? "ok" : "global_cli_not_canonical",
        link_path: context.link_path,
        cli_target: cliTarget,
        canonical_cli_path: canonicalCliPath,
      },
    ),
    inspectProtectedWorktreeRegistry({
      sourceRepoPath: context.source_repo_path,
      canonicalCheckoutPath: canonicalPath,
    }),
  ];
}

export function ensureMirrorRepo({ mirrorPath = "", sourceRepoPath = "" } = {}) {
  if (!mirrorPath || !sourceRepoPath) {
    return { ok: false, reason: "mirror_prerequisites_missing" };
  }
  mkdirSync(path.dirname(mirrorPath), { recursive: true });
  if (!existsSync(mirrorPath)) {
    const clone = runCommand("git", ["clone", "--bare", sourceRepoPath, mirrorPath]);
    if (!clone.ok) {
      return { ok: false, reason: "mirror_clone_failed", detail: clone.stderr || clone.stdout };
    }
  }
  const bare = runCommand("git", ["--git-dir", mirrorPath, "rev-parse", "--is-bare-repository"]);
  if (!bare.ok || bare.stdout !== "true") {
    return { ok: false, reason: "mirror_not_bare_repo", detail: bare.stderr || bare.stdout };
  }
  const fetch = runCommand("git", ["--git-dir", mirrorPath, "fetch", "--prune", "origin"]);
  if (!fetch.ok) {
    return { ok: false, reason: "mirror_fetch_failed", detail: fetch.stderr || fetch.stdout };
  }
  return { ok: true, reason: "ok" };
}

export function ensureCanonicalWorktree({
  canonicalCheckoutPath = "",
  mirrorPath = "",
} = {}) {
  if (!canonicalCheckoutPath || !mirrorPath) {
    return { ok: false, reason: "canonical_repair_prerequisites_missing" };
  }
  if (existsSync(canonicalCheckoutPath) && !isGitWorktree(canonicalCheckoutPath)) {
    if (!isSafeToReplaceCanonicalShell(canonicalCheckoutPath)) {
      return { ok: false, reason: "canonical_path_contains_unexpected_files" };
    }
    rmSync(canonicalCheckoutPath, { recursive: true, force: true });
  }
  if (!existsSync(canonicalCheckoutPath)) {
    mkdirSync(path.dirname(canonicalCheckoutPath), { recursive: true });
    const add = runCommand("git", [
      "--git-dir",
      mirrorPath,
      "worktree",
      "add",
      "--force",
      canonicalCheckoutPath,
      "main",
    ]);
    if (!add.ok) {
      return { ok: false, reason: "canonical_worktree_add_failed", detail: add.stderr || add.stdout };
    }
  }

  const checkout = gitAt(canonicalCheckoutPath, ["checkout", "--force", "main"]);
  if (!checkout.ok) {
    return { ok: false, reason: "canonical_checkout_main_failed", detail: checkout.stderr || checkout.stdout };
  }
  const fetch = gitAt(canonicalCheckoutPath, ["fetch", "--prune", "origin"]);
  if (!fetch.ok) {
    return { ok: false, reason: "canonical_fetch_failed", detail: fetch.stderr || fetch.stdout };
  }
  const hasOriginMain = gitAt(canonicalCheckoutPath, ["rev-parse", "--verify", "refs/remotes/origin/main"]);
  const resetTarget = hasOriginMain.ok ? "origin/main" : "main";
  const reset = gitAt(canonicalCheckoutPath, ["reset", "--hard", resetTarget]);
  if (!reset.ok) {
    return { ok: false, reason: "canonical_reset_failed", detail: reset.stderr || reset.stdout };
  }
  return { ok: true, reason: "ok" };
}

export function verifyRuntimeStartup({ canonicalCheckoutPath = "" } = {}) {
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/check-runtime-startup-probe.ts");
  const out = runCommand(process.execPath, [scriptPath, "--json"], {
    cwd: canonicalCheckoutPath,
  });
  if (!out.ok) {
    return { ok: false, reason: "runtime_startup_probe_failed", detail: out.stderr || out.stdout };
  }
  try {
    const parsed = JSON.parse(out.stdout || "{}");
    return {
      ok: parsed?.result === "ok",
      reason: parsed?.result === "ok" ? "ok" : "runtime_startup_probe_failed",
      probes: Array.isArray(parsed?.probes) ? parsed.probes : [],
    };
  } catch {
    return { ok: false, reason: "runtime_startup_probe_parse_failed", detail: out.stdout };
  }
}
