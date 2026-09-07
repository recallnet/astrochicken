import { spawnSync } from "node:child_process";

function trim(value = "") {
  return String(value || "").trim();
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function runGit(args = [], { repoPath = ".", spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn("git", args, { encoding: "utf8", cwd: repoPath });
  return {
    ok: Number(result?.status) === 0,
    status: Number.isFinite(Number(result?.status)) ? Number(result.status) : 1,
    stdout: trim(result?.stdout),
    stderr: trim(result?.stderr),
  };
}

export function parseGitShortStat(raw = "") {
  const text = trim(raw);
  if (!text) {
    return {
      added: 0,
      deleted: 0,
      files_changed: 0,
      text: "+0 -0",
    };
  }

  const fileMatch = text.match(/(\d+)\s+files?\s+changed/i);
  const addMatch = text.match(/(\d+)\s+insertions?\(\+\)/i);
  const delMatch = text.match(/(\d+)\s+deletions?\(-\)/i);

  const files_changed = toInt(fileMatch?.[1], 0);
  const added = toInt(addMatch?.[1], 0);
  const deleted = toInt(delMatch?.[1], 0);

  return {
    added,
    deleted,
    files_changed,
    text: `+${added} -${deleted}`,
  };
}

function degradedDiff(reason = "diff_unavailable") {
  return {
    added: 0,
    deleted: 0,
    files_changed: 0,
    text: "+0 -0",
    degraded: true,
    reason: String(reason || "diff_unavailable"),
  };
}

function resolveMainRef({ repoPath = ".", spawnSyncFn = spawnSync } = {}) {
  const preferredMain = runGit(["rev-parse", "main"], { repoPath, spawnSyncFn });
  if (preferredMain.ok && preferredMain.stdout) return preferredMain.stdout;

  const head = runGit(["rev-parse", "HEAD"], { repoPath, spawnSyncFn });
  if (head.ok && head.stdout) return head.stdout;
  return "";
}

export function computeDiffStats({
  repoPath = ".",
  sinceIso = "",
  nowIso = "",
  spawnSyncFn = spawnSync,
} = {}) {
  const sinceMs = Date.parse(String(sinceIso || ""));
  if (!Number.isFinite(sinceMs)) return degradedDiff("invalid_since_iso");

  const nowMs = Date.parse(String(nowIso || ""));
  if (nowIso && !Number.isFinite(nowMs)) return degradedDiff("invalid_now_iso");

  const inside = runGit(["rev-parse", "--is-inside-work-tree"], { repoPath, spawnSyncFn });
  if (!inside.ok) return degradedDiff("git_repo_unavailable");

  const mainRef = resolveMainRef({ repoPath, spawnSyncFn });
  if (!mainRef) return degradedDiff("git_main_ref_unavailable");

  const baseResult = runGit(["rev-list", "-1", `--before=${sinceIso}`, mainRef], { repoPath, spawnSyncFn });
  let baseRef = baseResult.ok ? trim(baseResult.stdout) : "";
  if (!baseRef) {
    const firstCommit = runGit(["rev-list", "--max-parents=0", "-n", "1", mainRef], { repoPath, spawnSyncFn });
    if (!firstCommit.ok || !firstCommit.stdout) return degradedDiff("git_commit_history_unavailable");
    baseRef = trim(firstCommit.stdout);
  }

  const shortstat = runGit(["diff", "--shortstat", `${baseRef}..${mainRef}`], { repoPath, spawnSyncFn });
  if (!shortstat.ok) return degradedDiff("git_diff_failed");

  return {
    ...parseGitShortStat(shortstat.stdout),
    degraded: false,
    reason: null,
  };
}
