import path from "node:path";

import { trim } from "./cli-helpers.ts";

export const DEFAULT_DISPOSABLE_WORKTREE_KINDS: readonly string[] = Object.freeze(["wave", "merge", "proposal"]);

function interpolateEnvTemplate(raw: string = "", env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  const value: string = trim(raw);
  if (!value) return "";
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_: string, key: string) => String(env?.[key] || ""));
}

function normalizeAbsolute(candidatePath: string = "", { baseDir = process.cwd() }: { baseDir?: string } = {}): string {
  const normalized: string = trim(candidatePath);
  if (!normalized) return "";
  return path.resolve(baseDir, normalized);
}

export function resolveCanonicalCheckoutPath({
  configuredPath = "",
  config = {},
  env = process.env,
  baseDir = process.cwd(),
}: {
  configuredPath?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  baseDir?: string;
} = {}): string {
  const configured: string = trim(configuredPath)
    || trim(config?.canonical_checkout_path)
    || trim(env?.HATCH_CANONICAL_CHECKOUT_PATH)
    || trim(env?.CANONICAL_CHECKOUT_PATH);
  const interpolated: string = interpolateEnvTemplate(configured, env as Record<string, string | undefined>);
  return normalizeAbsolute(interpolated, { baseDir });
}

export function isCanonicalCheckout(candidatePath: string = "", { canonicalCheckoutPath = "", baseDir = process.cwd() }: { canonicalCheckoutPath?: string; baseDir?: string } = {}): boolean {
  const candidate: string = normalizeAbsolute(candidatePath, { baseDir });
  const canonical: string = normalizeAbsolute(canonicalCheckoutPath, { baseDir });
  if (!candidate || !canonical) return false;
  return candidate === canonical;
}

export function resolveDisposableWorktreeRoot({ repoPath = "", kind = "wave" }: { repoPath?: string; kind?: string } = {}): string {
  const repo: string = normalizeAbsolute(repoPath);
  const normalizedKind: string = trim(kind);
  if (!repo || !normalizedKind) return "";
  return path.resolve(path.dirname(repo), ".hatch-worktrees", normalizedKind);
}

export function resolveApprovedDisposableWorktreeRoots({
  repoPath = "",
  kinds = DEFAULT_DISPOSABLE_WORKTREE_KINDS,
}: {
  repoPath?: string;
  kinds?: readonly string[];
} = {}): string[] {
  return Array.from(new Set((Array.isArray(kinds) ? kinds : DEFAULT_DISPOSABLE_WORKTREE_KINDS)
    .map((kind: string) => resolveDisposableWorktreeRoot({ repoPath, kind }))
    .filter(Boolean)));
}

export interface WorktreeClassification {
  path: string;
  canonical: boolean;
  repoRoot: boolean;
  approvedDisposable: boolean;
  disposableKind: string;
  approvedRoots: string[];
}

export function classifyManagedWorktreePath({
  candidatePath = "",
  repoPath = "",
  canonicalCheckoutPath = "",
  kinds = DEFAULT_DISPOSABLE_WORKTREE_KINDS,
}: {
  candidatePath?: string;
  repoPath?: string;
  canonicalCheckoutPath?: string;
  kinds?: readonly string[];
} = {}): WorktreeClassification {
  const absolutePath: string = normalizeAbsolute(candidatePath);
  const repoRoot: string = normalizeAbsolute(repoPath);
  const approvedRoots: string[] = resolveApprovedDisposableWorktreeRoots({ repoPath, kinds });
  const canonical: boolean = isCanonicalCheckout(absolutePath, { canonicalCheckoutPath });
  const repoRootMatch: boolean = Boolean(absolutePath && repoRoot && absolutePath === repoRoot);
  let disposableKind: string = "";
  let approvedDisposable: boolean = false;

  for (const root of approvedRoots) {
    if (!root) continue;
    if (absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`)) {
      approvedDisposable = true;
      disposableKind = path.basename(root);
      break;
    }
  }

  return {
    path: absolutePath,
    canonical,
    repoRoot: repoRootMatch,
    approvedDisposable,
    disposableKind,
    approvedRoots,
  };
}
