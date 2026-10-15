import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isCanonicalCheckout, resolveCanonicalCheckoutPath } from "./canonical-worktree.ts";

export const DEFAULT_GLOBAL_CLI_LINK_NAME = "hatch-ops";

function readJsonIfExists(filePath = "") {
  if (!filePath || !existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function unlinkIfPresent(linkPath = "") {
  if (!linkPath) return;
  try {
    lstatSync(linkPath);
  } catch {
    return;
  }
  unlinkSync(linkPath);
}

export function resolveGlobalCliLinkPath({ homeDir = os.homedir(), linkDir = "", linkName = DEFAULT_GLOBAL_CLI_LINK_NAME } = {}) {
  const baseDir = linkDir || path.resolve(homeDir, ".local", "share", "pnpm");
  return path.resolve(baseDir, linkName);
}

export function resolveCanonicalFactoryOpsCliPath(canonicalCheckoutPath = "") {
  const resolvedCanonicalCheckoutPath = String(canonicalCheckoutPath || "").trim();
  if (!resolvedCanonicalCheckoutPath) return "";
  return path.resolve(resolvedCanonicalCheckoutPath, "packages", "factory-ops", "src", "cli.ts");
}

export function relinkGlobalCli({
  repoRoot = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  linkDir = "",
  linkName = DEFAULT_GLOBAL_CLI_LINK_NAME,
} = {}) {
  const currentRepoRoot = path.resolve(String(repoRoot || process.cwd()));
  const configPath = path.resolve(currentRepoRoot, "factories", "mothership", "factory.config.json");
  const config = readJsonIfExists(configPath);
  const canonicalCheckoutPath = resolveCanonicalCheckoutPath({ config, env, baseDir: currentRepoRoot });
  const linkPath = resolveGlobalCliLinkPath({ homeDir, linkDir, linkName });
  const linkBaseDir = path.dirname(linkPath);

  if (!canonicalCheckoutPath || !existsSync(canonicalCheckoutPath)) {
    return {
      ok: false,
      relinked: false,
      reason: "canonical_checkout_missing",
      current_repo_root: currentRepoRoot,
      canonical_checkout_path: canonicalCheckoutPath,
      link_path: linkPath,
    };
  }

  if (!isCanonicalCheckout(currentRepoRoot, { canonicalCheckoutPath })) {
    return {
      ok: false,
      relinked: false,
      reason: "current_checkout_not_canonical",
      current_repo_root: currentRepoRoot,
      canonical_checkout_path: canonicalCheckoutPath,
      link_path: linkPath,
    };
  }

  const cliSource = resolveCanonicalFactoryOpsCliPath(canonicalCheckoutPath);
  if (!existsSync(cliSource)) {
    return {
      ok: false,
      relinked: false,
      reason: "canonical_cli_missing",
      current_repo_root: currentRepoRoot,
      canonical_checkout_path: canonicalCheckoutPath,
      cli_source: cliSource,
      link_path: linkPath,
    };
  }

  mkdirSync(linkBaseDir, { recursive: true });
  const relativeTarget = path.relative(linkBaseDir, cliSource);
  try {
    if (lstatSync(linkPath).isSymbolicLink() && readlinkSync(linkPath) === relativeTarget) {
      return {
        ok: true,
        relinked: true,
        reason: "already_linked",
        current_repo_root: currentRepoRoot,
        canonical_checkout_path: canonicalCheckoutPath,
        cli_source: cliSource,
        link_path: linkPath,
      };
    }
  } catch {
    // Remove broken or incompatible links before recreating them.
  }

  try {
    unlinkIfPresent(linkPath);
  } catch {
    // Fall through to symlink creation attempt.
  }

  symlinkSync(relativeTarget, linkPath);
  return {
    ok: true,
    relinked: true,
    reason: "linked",
    current_repo_root: currentRepoRoot,
    canonical_checkout_path: canonicalCheckoutPath,
    cli_source: cliSource,
    link_path: linkPath,
  };
}
