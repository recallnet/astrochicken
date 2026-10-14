import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveRepoRoleGuardOptions } from "../../commands/merge-guard-context.ts";
import { inspectMergeWorkspaceState } from "../../commands/merge-workspace-state.ts";
import {
  checkoutMergeWorktreeRef,
  cleanMergeWorkspaceState,
  currentMergeWorktreeHead,
  readMergeWorktreeState,
  refreshMergeWorktreeBase,
  resolveMergeBaseRef,
  setupMergeWorktree,
  writeMergeWorktreeState,
} from "../../commands/merge-worktree.ts";
import { resolveCanonicalCheckoutPath } from "../canonical-worktree.ts";
import { trim, parseJson } from "../cli-helpers.ts";
import { guardGitMutation } from "../git-mutation-guard.ts";
import {
  buildMergeConflictPacket,
  persistMergeConflictPacket,
} from "../merge-conflict-packet.ts";
import { resolveMergeTelemetryFilePath } from "../merge-resolution-telemetry-path.ts";
function isolatedGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}
function run(cmd) {
  const p = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    env: isolatedGitEnv(),
  });
  return { code: p.status ?? 1, stdout: String(p.stdout || "").trim(), stderr: String(p.stderr || "").trim() };
}
function currentBranch(repo, runFn = run) {
  const out = runFn(["git", "-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]);
  return out.code === 0 ? String(out.stdout || "").trim() : "";
}
function resolveMergeWorkspaceDir(primary = "", fallback = "") {
  return trim(primary) || trim(fallback);
}
function isDirtyWorktreeMergeFailure(stderr = "") {
  const s = String(stderr || "");
  return /would be overwritten by merge/i.test(s) || /Please commit your changes or stash them before you merge/i.test(s);
}
function hasUnmergedFiles(stderr = "") {
  return /you have unmerged files/i.test(String(stderr || ""));
}
function isUntrackedFileConflict(stderr = "") {
  return /untracked working tree files would be overwritten by merge/i.test(String(stderr || ""));
}
function extractUntrackedConflictFiles(stderr = "") {
  // Git lists conflicting untracked files one per line between the error header and the "Please move" line
  const lines = String(stderr || "").split(/\r?\n/);
  const files = [];
  let capturing = false;
  for (const line of lines) {
    if (/untracked working tree files would be overwritten/i.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing && /^\s*please move or remove/i.test(line)) break;
    if (capturing && /^\s*aborting/i.test(line)) break;
    if (capturing) {
      const trimmed = line.trim();
      if (trimmed) files.push(trimmed);
    }
  }
  return files;
}
function ensureCleanMergeState(repo) {
  const canonicalCheckoutPath = resolveCanonicalCheckoutPath();
  const branch = currentBranch(repo);
  const roleGuardOptions = resolveRepoRoleGuardOptions({ repo });
  const mergeAbortGuard = guardGitMutation({
    operation: "merge_abort_main_only",
    repoPath: repo,
    canonicalCheckoutPath,
    currentBranch: branch,
    ...roleGuardOptions,
  });
  if (!mergeAbortGuard.ok) return mergeAbortGuard;
  // Abort any in-progress merge (ignore errors if none active)
  run(["git", "-C", repo, "merge", "--abort"]);
  const rebaseAbortGuard = guardGitMutation({
    operation: "rebase_abort_main_only",
    repoPath: repo,
    canonicalCheckoutPath,
    currentBranch: branch,
    ...roleGuardOptions,
  });
  if (!rebaseAbortGuard.ok) return rebaseAbortGuard;
  // Abort any in-progress rebase (ignore errors if none active)
  run(["git", "-C", repo, "rebase", "--abort"]);
  // Clear stale index entries (UU without MERGE_HEAD) — reset index to HEAD
  // Does NOT touch working tree, so uncommitted changes survive
  run(["git", "-C", repo, "reset", "HEAD"]);
  const checkoutGuard = guardGitMutation({
    operation: "checkout_main_only",
    repoPath: repo,
    canonicalCheckoutPath,
    currentBranch: branch || "main",
    targetBranch: "main",
    ...roleGuardOptions,
  });
  if (!checkoutGuard.ok) return checkoutGuard;
  // Ensure we're on main
  run(["git", "-C", repo, "checkout", "main"]);
  return { ok: true, blocked: false, reason: "" };
}
export function assertMainBranch({ repo = "", runFn = run } = {}) {
  const resolvedRepo = String(repo || "").trim();
  if (!resolvedRepo) {
    return { ok: false, branch: "", corrected: false, error: "missing_repo" };
  }
  const current = runFn(["git", "-C", resolvedRepo, "rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = String(current.stdout || "").trim();
  if (current.code !== 0) {
    return { ok: false, branch, corrected: false, error: "git_rev_parse_failed" };
  }
  if (branch === "main") {
    return { ok: true, branch: "main", corrected: false, error: "" };
  }
  const canonicalGuard = guardGitMutation({
    operation: "checkout_main_only",
    repoPath: resolvedRepo,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    currentBranch: branch,
    targetBranch: "main",
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  });
  if (!canonicalGuard.ok) {
    return { ok: false, branch, corrected: false, error: canonicalGuard.reason };
  }
  // Wrong branch — correct it
  runFn(["git", "-C", resolvedRepo, "merge", "--abort"]);
  runFn(["git", "-C", resolvedRepo, "rebase", "--abort"]);
  runFn(["git", "-C", resolvedRepo, "reset", "HEAD"]);
  const checkout = runFn(["git", "-C", resolvedRepo, "checkout", "main"]);
  if (checkout.code !== 0) {
    return { ok: false, branch, corrected: false, error: `checkout_main_failed: ${checkout.stderr}` };
  }
  return { ok: true, branch, corrected: true, error: "" };
}
export { assertMainClean } from "../../commands/merge-assert-main-clean.ts";
export function extractMergeItem(raw = "{}") {
  const item = parseJson(String(raw || "{}"), {});
  return {
    issue_number: String(item?.issue_number || "").trim(),
    branch: String(item?.branch || "").trim(),
    worktree_dir: String(item?.worktree_dir || "").trim(),
  };
}
export function resolveMergeContext({ mergeCandidatesRaw = "[]", fallbackBranch = "", fallbackWorktreeDir = "" } = {}) {
  const candidates = parseJson(String(mergeCandidatesRaw || "[]"), []);
  const first = Array.isArray(candidates)
    ? candidates.find((entry) => entry && typeof entry === "object")
    : null;
  return {
    branch: String(first?.branch || fallbackBranch || "").trim(),
    worktree_dir: String(first?.worktree_dir || fallbackWorktreeDir || "").trim(),
  };
}
export function rebaseBranchOnMain({ repo = "", branch = "", worktreeDir = "", mergeWorktreeDir = "", remote = "origin" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "").trim();
  const resolvedWorktreeDir = resolveMergeWorkspaceDir(mergeWorktreeDir, worktreeDir);
  if (!resolvedRepo || !resolvedBranch) {
    return { rebase_status: "error", rebase_stdout: "", rebase_stderr: "missing repo or branch" };
  }
  if (resolvedWorktreeDir) {
    const mergeSetup = setupMergeWorktree({
      repo: resolvedRepo,
      branch: resolvedBranch,
      mergeWorktreeDir: resolvedWorktreeDir,
      remote,
    });
    if (mergeSetup.setup !== "true") {
      return {
        rebase_status: "error",
        rebase_stdout: "",
        rebase_stderr: mergeSetup.reason || "merge_worktree_setup_failed",
        merge_worktree_dir: resolvedWorktreeDir,
      };
    }
    const stateBefore = readMergeWorktreeState({ mergeWorktreeDir: resolvedWorktreeDir });
    const sourceBranchHead = trim(stateBefore.source_branch_head_sha)
      || trim(run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch], resolvedRepo).stdout);
    if (!sourceBranchHead) {
      return {
        rebase_status: "error",
        rebase_stdout: "",
        rebase_stderr: "missing_source_branch_head",
        merge_worktree_dir: resolvedWorktreeDir,
      };
    }
    const mergeBaseRef = refreshMergeWorktreeBase({ repo: resolvedRepo, mergeWorktreeDir: resolvedWorktreeDir, remote }).merge_base_ref;
    const reset = checkoutMergeWorktreeRef({ mergeWorktreeDir: resolvedWorktreeDir, ref: sourceBranchHead });
    if (reset.code !== 0) {
      return {
        rebase_status: "error",
        rebase_stdout: reset.stdout,
        rebase_stderr: reset.stderr || "merge_worktree_checkout_failed",
        merge_worktree_dir: resolvedWorktreeDir,
      };
    }
    const anc = run(["git", "-C", resolvedWorktreeDir, "merge-base", "--is-ancestor", mergeBaseRef, "HEAD"], resolvedWorktreeDir);
    if (anc.code === 0) {
      writeMergeWorktreeState({
        mergeWorktreeDir: resolvedWorktreeDir,
        patch: {
          source_branch_head_sha: sourceBranchHead,
          rebased_head_sha: currentMergeWorktreeHead({ mergeWorktreeDir: resolvedWorktreeDir }),
          merge_base_ref: mergeBaseRef,
          merge_phase: "rebased",
        },
      });
      return {
        rebase_status: "ready",
        rebase_stdout: "branch already contains main",
        rebase_stderr: "",
        merge_worktree_dir: resolvedWorktreeDir,
        merge_branch_head_sha: currentMergeWorktreeHead({ mergeWorktreeDir: resolvedWorktreeDir }),
      };
    }
    const rb = run(["git", "-C", resolvedWorktreeDir, "rebase", mergeBaseRef], resolvedWorktreeDir);
    if (rb.code === 0) {
      const rebasedHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedWorktreeDir });
      writeMergeWorktreeState({
        mergeWorktreeDir: resolvedWorktreeDir,
        patch: {
          source_branch_head_sha: sourceBranchHead,
          rebased_head_sha: rebasedHead,
          merge_base_ref: mergeBaseRef,
          merge_phase: "rebased",
        },
      });
      return {
        rebase_status: "ready",
        rebase_stdout: rb.stdout,
        rebase_stderr: rb.stderr,
        merge_worktree_dir: resolvedWorktreeDir,
        merge_branch_head_sha: rebasedHead,
      };
    }
    const unmerged = run(["git", "-C", resolvedWorktreeDir, "diff", "--name-only", "--diff-filter=U"], resolvedWorktreeDir);
    const conflictFiles = unmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    run(["git", "-C", resolvedWorktreeDir, "rebase", "--abort"], resolvedWorktreeDir);
    checkoutMergeWorktreeRef({ mergeWorktreeDir: resolvedWorktreeDir, ref: sourceBranchHead });
    const mg = run(["git", "-C", resolvedWorktreeDir, "merge", "--no-ff", mergeBaseRef], resolvedWorktreeDir);
    if (mg.code === 0) {
      const rebasedHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedWorktreeDir });
      writeMergeWorktreeState({
        mergeWorktreeDir: resolvedWorktreeDir,
        patch: {
          source_branch_head_sha: sourceBranchHead,
          rebased_head_sha: rebasedHead,
          merge_base_ref: mergeBaseRef,
          merge_phase: "rebased",
        },
      });
      return {
        rebase_status: "ready",
        rebase_stdout: [rb.stdout, mg.stdout].filter(Boolean).join("\n"),
        rebase_stderr: [rb.stderr, "rebase_conflict_but_worktree_merge_clean"].filter(Boolean).join("\n"),
        merge_worktree_dir: resolvedWorktreeDir,
        merge_branch_head_sha: rebasedHead,
      };
    }
    const mergeUnmerged = run(["git", "-C", resolvedWorktreeDir, "diff", "--name-only", "--diff-filter=U"], resolvedWorktreeDir);
    const mergeConflictFiles = mergeUnmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    writeMergeWorktreeState({
      mergeWorktreeDir: resolvedWorktreeDir,
      patch: {
        source_branch_head_sha: sourceBranchHead,
        merge_base_ref: mergeBaseRef,
        merge_phase: "rebase_conflict",
      },
    });
    return {
      rebase_status: "conflict",
      rebase_stdout: [rb.stdout, mg.stdout].filter(Boolean).join("\n"),
      rebase_stderr: [
        rb.stderr,
        mg.stderr,
        mergeConflictFiles.length
          ? `rebase_conflict_files=${mergeConflictFiles.join(",")}`
          : (conflictFiles.length ? `rebase_conflict_files=${conflictFiles.join(",")}` : ""),
        "conflict_scope=merge_worktree",
      ].filter(Boolean).join("\n"),
      merge_worktree_dir: resolvedWorktreeDir,
      merge_branch_head_sha: sourceBranchHead,
    };
  }
  const canonicalGuard = guardGitMutation({
    operation: "rebase_branch",
    repoPath: resolvedRepo,
    targetPath: resolvedWorktreeDir,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    currentBranch: currentBranch(resolvedRepo),
    targetBranch: resolvedBranch,
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  });
  if (!canonicalGuard.ok) {
    return { rebase_status: "error", rebase_stdout: "", rebase_stderr: canonicalGuard.reason };
  }
  // Clean any stale merge/rebase state from prior operations
  const cleanState = ensureCleanMergeState(resolvedRepo);
  if (!cleanState?.ok) {
    return { rebase_status: "error", rebase_stdout: "", rebase_stderr: cleanState.reason || "canonical_checkout_rebase_branch_blocked" };
  }
  // Check if branch is already up to date with main
  const anc = run(["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", "main", resolvedBranch]);
  if (anc.code === 0) {
    return { rebase_status: "ready", rebase_stdout: "branch already contains main", rebase_stderr: "" };
  }
  const rebaseCmd = resolvedWorktreeDir
    ? ["git", "-C", resolvedWorktreeDir, "rebase", "main"]
    : ["git", "-C", resolvedRepo, "rebase", "main", resolvedBranch];
  // Rebase the feature branch onto main
  const rb = run(rebaseCmd);
  if (rb.code === 0) {
    // Switch back to main for the merge step
    run(["git", "-C", resolvedRepo, "checkout", "main"]);
    return { rebase_status: "ready", rebase_stdout: rb.stdout, rebase_stderr: rb.stderr };
  }
  // Rebase failed — capture conflict files before aborting so the resolver has context
  const unmerged = resolvedWorktreeDir
    ? run(["git", "-C", resolvedWorktreeDir, "diff", "--name-only", "--diff-filter=U"])
    : run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"]);
  const conflictFiles = unmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Convert rebase conflicts into merge-conflict state for the resolver.
  // IMPORTANT: when a worktree is provided, keep conflict state in that worktree
  // (never in the factory root checkout), otherwise CLI/runtime source files in
  // the root can pick up conflict markers and crash subsequent nodes.
  if (resolvedWorktreeDir) {
    run(["git", "-C", resolvedWorktreeDir, "rebase", "--abort"]);
    // Merge main into the branch worktree so the resolver can use MERGE_HEAD
    // workflow without contaminating the main factory checkout.
    const mg = run(["git", "-C", resolvedWorktreeDir, "merge", "--no-ff", "main"]);
    if (mg.code === 0) {
      return {
        rebase_status: "ready",
        rebase_stdout: [rb.stdout, mg.stdout].filter(Boolean).join("\n"),
        rebase_stderr: [rb.stderr, "rebase_conflict_but_worktree_merge_clean"].filter(Boolean).join("\n"),
      };
    }
    const mergeUnmerged = run(["git", "-C", resolvedWorktreeDir, "diff", "--name-only", "--diff-filter=U"]);
    const mergeConflictFiles = mergeUnmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return {
      rebase_status: "conflict",
      rebase_stdout: [rb.stdout, mg.stdout].filter(Boolean).join("\n"),
      rebase_stderr: [
        rb.stderr,
        mg.stderr,
        mergeConflictFiles.length ? `rebase_conflict_files=${mergeConflictFiles.join(",")}` : (conflictFiles.length ? `rebase_conflict_files=${conflictFiles.join(",")}` : ""),
        "conflict_scope=worktree",
      ].filter(Boolean).join("\n"),
    };
  }
  // Legacy path (no dedicated worktree): convert to merge-conflict state in repo.
  run(["git", "-C", resolvedRepo, "rebase", "--abort"]);
  run(["git", "-C", resolvedRepo, "checkout", "main"]);
  // Attempt a merge to leave the repo in merge-conflict state for the resolver
  const mg = run(["git", "-C", resolvedRepo, "merge", "--no-ff", resolvedBranch]);
  if (mg.code === 0) {
    // Rebase had conflicts but merge didn't — branch is already mergeable
    return { rebase_status: "ready", rebase_stdout: mg.stdout, rebase_stderr: [rb.stderr, "rebase_conflict_but_merge_clean"].filter(Boolean).join("\n") };
  }
  return {
    rebase_status: "conflict",
    rebase_stdout: rb.stdout,
    rebase_stderr: [rb.stderr, conflictFiles.length ? `rebase_conflict_files=${conflictFiles.join(",")}` : ""].filter(Boolean).join("\n"),
  };
}
export function attemptDeterministicMerge({ repo = "", branch = "", mergeWorktreeDir = "", branchHeadSha = "", remote = "origin", commitMessage = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "").trim();
  const resolvedMergeWorktreeDir = trim(mergeWorktreeDir);
  const resolvedCommitMessage = String(commitMessage || "").trim();
  const mergeMessageArgs = resolvedCommitMessage ? ["-m", resolvedCommitMessage] : [];
  if (!resolvedRepo || !resolvedBranch) {
    return { merge_status: "error", merge_stdout: "", merge_stderr: "missing repo or branch" };
  }
  if (resolvedMergeWorktreeDir) {
    const mergeSetup = setupMergeWorktree({
      repo: resolvedRepo,
      branch: resolvedBranch,
      mergeWorktreeDir: resolvedMergeWorktreeDir,
      remote,
    });
    if (mergeSetup.setup !== "true") {
      return {
        merge_status: "error",
        merge_stdout: "",
        merge_stderr: mergeSetup.reason || "merge_worktree_setup_failed",
        merge_worktree_dir: resolvedMergeWorktreeDir,
      };
    }
    const stateBefore = readMergeWorktreeState({ mergeWorktreeDir: resolvedMergeWorktreeDir });
    const mergeBaseRef = refreshMergeWorktreeBase({ repo: resolvedRepo, mergeWorktreeDir: resolvedMergeWorktreeDir, remote }).merge_base_ref;
    const candidateHead = trim(branchHeadSha)
      || trim(stateBefore.rebased_head_sha)
      || trim(stateBefore.source_branch_head_sha)
      || currentMergeWorktreeHead({ mergeWorktreeDir: resolvedMergeWorktreeDir })
      || trim(run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch], resolvedRepo).stdout);
    if (!candidateHead) {
      return {
        merge_status: "error",
        merge_stdout: "",
        merge_stderr: "missing_merge_branch_head",
        merge_worktree_dir: resolvedMergeWorktreeDir,
      };
    }
    const alreadyMerged = run(["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", candidateHead, mergeBaseRef], resolvedRepo);
    if (alreadyMerged.code === 0) {
      writeMergeWorktreeState({
        mergeWorktreeDir: resolvedMergeWorktreeDir,
        patch: {
          merge_phase: "already_merged",
          merge_base_ref: mergeBaseRef,
          merge_branch_head_sha: candidateHead,
        },
      });
      return {
        merge_status: "already_merged",
        merge_stdout: "already merged",
        merge_stderr: "",
        merge_worktree_dir: resolvedMergeWorktreeDir,
        merge_branch_head_sha: candidateHead,
      };
    }
    const reset = checkoutMergeWorktreeRef({ mergeWorktreeDir: resolvedMergeWorktreeDir, ref: mergeBaseRef });
    if (reset.code !== 0) {
      return {
        merge_status: "error",
        merge_stdout: reset.stdout,
        merge_stderr: reset.stderr || "merge_worktree_reset_failed",
        merge_worktree_dir: resolvedMergeWorktreeDir,
      };
    }
    const mg = run(["git", "-C", resolvedMergeWorktreeDir, "merge", "--no-ff", ...mergeMessageArgs, candidateHead], resolvedMergeWorktreeDir);
    if (mg.code === 0) {
      const mergedHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedMergeWorktreeDir });
      writeMergeWorktreeState({
        mergeWorktreeDir: resolvedMergeWorktreeDir,
        patch: {
          merge_phase: "merged",
          merge_base_ref: mergeBaseRef,
          merge_branch_head_sha: candidateHead,
          merged_head_sha: mergedHead,
        },
      });
      return {
        merge_status: "merged",
        merge_stdout: mg.stdout,
        merge_stderr: mg.stderr,
        merge_worktree_dir: resolvedMergeWorktreeDir,
        merge_branch_head_sha: candidateHead,
        merged_head_sha: mergedHead,
      };
    }
    if (isUntrackedFileConflict(mg.stderr)) {
      const conflictFiles = extractUntrackedConflictFiles(mg.stderr);
      if (conflictFiles.length > 0) {
        for (const f of conflictFiles) {
          run(["mv", "-f", join(resolvedMergeWorktreeDir, f), join(resolvedMergeWorktreeDir, `${f}.merge-backup`)]);
        }
        const retry = run(["git", "-C", resolvedMergeWorktreeDir, "merge", "--no-ff", ...mergeMessageArgs, candidateHead], resolvedMergeWorktreeDir);
        if (retry.code === 0) {
          for (const f of conflictFiles) {
            run(["rm", "-f", join(resolvedMergeWorktreeDir, `${f}.merge-backup`)]);
          }
          const mergedHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedMergeWorktreeDir });
          writeMergeWorktreeState({
            mergeWorktreeDir: resolvedMergeWorktreeDir,
            patch: {
              merge_phase: "merged",
              merge_base_ref: mergeBaseRef,
              merge_branch_head_sha: candidateHead,
              merged_head_sha: mergedHead,
            },
          });
          return {
            merge_status: "merged",
            merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
            merge_stderr: [mg.stderr, `auto_heal=untracked_backup files=${conflictFiles.join(",")}`, retry.stderr].filter(Boolean).join("\n"),
            merge_worktree_dir: resolvedMergeWorktreeDir,
            merge_branch_head_sha: candidateHead,
            merged_head_sha: mergedHead,
          };
        }
        for (const f of conflictFiles) {
          run(["mv", "-f", join(resolvedMergeWorktreeDir, `${f}.merge-backup`), join(resolvedMergeWorktreeDir, f)]);
        }
      }
    }
    if (isDirtyWorktreeMergeFailure(mg.stderr)) {
      run(["git", "-C", resolvedMergeWorktreeDir, "merge", "--abort"], resolvedMergeWorktreeDir);
      const retry = run(["git", "-C", resolvedMergeWorktreeDir, "merge", "--autostash", "--no-ff", ...mergeMessageArgs, candidateHead], resolvedMergeWorktreeDir);
      if (retry.code === 0) {
        const mergedHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedMergeWorktreeDir });
        writeMergeWorktreeState({
          mergeWorktreeDir: resolvedMergeWorktreeDir,
          patch: {
            merge_phase: "merged",
            merge_base_ref: mergeBaseRef,
            merge_branch_head_sha: candidateHead,
            merged_head_sha: mergedHead,
          },
        });
        return {
          merge_status: "merged",
          merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
          merge_stderr: [mg.stderr, "auto_heal=autostash", retry.stderr].filter(Boolean).join("\n"),
          merge_worktree_dir: resolvedMergeWorktreeDir,
          merge_branch_head_sha: candidateHead,
          merged_head_sha: mergedHead,
        };
      }
      const retryUnmerged = run(["git", "-C", resolvedMergeWorktreeDir, "diff", "--name-only", "--diff-filter=U"], resolvedMergeWorktreeDir);
      const retryHasConflicts = retryUnmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0;
      return {
        merge_status: retryHasConflicts ? "conflict" : "error",
        merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
        merge_stderr: [mg.stderr, "auto_heal=autostash", retry.stderr].filter(Boolean).join("\n"),
        merge_worktree_dir: resolvedMergeWorktreeDir,
        merge_branch_head_sha: candidateHead,
      };
    }
    const unmerged = run(["git", "-C", resolvedMergeWorktreeDir, "diff", "--name-only", "--diff-filter=U"], resolvedMergeWorktreeDir);
    const hasConflicts = unmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0;
    writeMergeWorktreeState({
      mergeWorktreeDir: resolvedMergeWorktreeDir,
      patch: {
        merge_phase: hasConflicts ? "merge_conflict" : "merge_error",
        merge_base_ref: mergeBaseRef,
        merge_branch_head_sha: candidateHead,
      },
    });
    return {
      merge_status: hasConflicts ? "conflict" : "error",
      merge_stdout: mg.stdout,
      merge_stderr: mg.stderr,
      merge_worktree_dir: resolvedMergeWorktreeDir,
      merge_branch_head_sha: candidateHead,
    };
  }
  const canonicalGuard = guardGitMutation({
    operation: "merge_branch",
    repoPath: resolvedRepo,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    currentBranch: currentBranch(resolvedRepo),
    targetBranch: resolvedBranch,
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  });
  if (!canonicalGuard.ok) {
    return { merge_status: "error", merge_stdout: "", merge_stderr: canonicalGuard.reason };
  }
  // Clean any stale merge/rebase state from prior operations
  const cleanState = ensureCleanMergeState(resolvedRepo);
  if (!cleanState?.ok) {
    return { merge_status: "error", merge_stdout: "", merge_stderr: cleanState.reason || "canonical_checkout_merge_branch_blocked" };
  }
  const anc = run(["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", resolvedBranch, "main"]);
  if (anc.code === 0) {
    return { merge_status: "already_merged", merge_stdout: "already merged", merge_stderr: "" };
  }
  const mg = run(["git", "-C", resolvedRepo, "merge", "--no-ff", ...mergeMessageArgs, resolvedBranch]);
  if (mg.code === 0) {
    return { merge_status: "merged", merge_stdout: mg.stdout, merge_stderr: mg.stderr };
  }
  // Deterministic auto-heal path for untracked file conflicts: the branch adds a
  // file that already exists locally as untracked. Back up the untracked files,
  // retry the merge, then clean up. The branch version wins because it is the
  // intentional, reviewed version; the local untracked file is stale leftovers.
  if (isUntrackedFileConflict(mg.stderr)) {
    const conflictFiles = extractUntrackedConflictFiles(mg.stderr);
    if (conflictFiles.length > 0) {
      for (const f of conflictFiles) {
        run(["mv", "-f", join(resolvedRepo, f), join(resolvedRepo, f + ".merge-backup")]);
      }
      const retry = run(["git", "-C", resolvedRepo, "merge", "--no-ff", ...mergeMessageArgs, resolvedBranch]);
      if (retry.code === 0) {
        // Merge succeeded — clean up backups (branch version is now tracked)
        for (const f of conflictFiles) {
          run(["rm", "-f", join(resolvedRepo, f + ".merge-backup")]);
        }
        return {
          merge_status: "merged",
          merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
          merge_stderr: [mg.stderr, `auto_heal=untracked_backup files=${conflictFiles.join(",")}`, retry.stderr].filter(Boolean).join("\n"),
        };
      }
      // Merge still failed — restore backups
      for (const f of conflictFiles) {
        run(["mv", "-f", join(resolvedRepo, f + ".merge-backup"), join(resolvedRepo, f)]);
      }
      // Fall through to normal error handling
    }
  }
  // Deterministic auto-heal path for dirty worktree merges: retry with autostash.
  if (isDirtyWorktreeMergeFailure(mg.stderr)) {
    run(["git", "-C", resolvedRepo, "merge", "--abort"]);
    const retry = run(["git", "-C", resolvedRepo, "merge", "--autostash", "--no-ff", ...mergeMessageArgs, resolvedBranch]);
    if (retry.code === 0) {
      return {
        merge_status: "merged",
        merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
        merge_stderr: [mg.stderr, "auto_heal=autostash", retry.stderr].filter(Boolean).join("\n"),
      };
    }
    const retryUnmerged = run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"]);
    const retryHasConflicts = retryUnmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0;
    if (retryHasConflicts) {
      return {
        merge_status: "conflict",
        merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
        merge_stderr: [mg.stderr, "auto_heal=autostash", retry.stderr].filter(Boolean).join("\n"),
      };
    }
    return {
      merge_status: "error",
      merge_stdout: [mg.stdout, retry.stdout].filter(Boolean).join("\n"),
      merge_stderr: [mg.stderr, "auto_heal=autostash", retry.stderr].filter(Boolean).join("\n"),
    };
  }
  const unmerged = run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"]);
  const hasConflicts = unmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0;
  if (hasConflicts) {
    return { merge_status: "conflict", merge_stdout: mg.stdout, merge_stderr: mg.stderr };
  }
  return { merge_status: "error", merge_stdout: mg.stdout, merge_stderr: mg.stderr };
}
function isPushRejected(stderr = "") {
  const s = String(stderr || "");
  return /non-fast-forward/i.test(s) || /fetch first/i.test(s) || /failed to push some refs/i.test(s) || /rejected/i.test(s);
}
// @context:decision !critical Classify push failures: rejected (rebase needed) vs hook_failed (code fix needed) vs error.
function classifyPushFailure(stderr = "") {
  if (isPushRejected(stderr)) return "rejected";
  const s = String(stderr || "").toLowerCase();
  return ["[pre-push]", "hook", "run-gates"].some((sig) => s.includes(sig)) ? "hook_failed" : "error";
}
export function pushMainBranch({ repo = "", branch = "main", remote = "origin", mergeWorktreeDir = "", mergedHeadSha = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "main").trim() || "main";
  const resolvedRemote = String(remote || "origin").trim() || "origin";
  const resolvedMergeWorktreeDir = trim(mergeWorktreeDir);
  const resolvedMergedHeadSha = trim(mergedHeadSha);
  if (!resolvedRepo) {
    return { push_status: "error", push_stdout: "", push_stderr: "missing repo" };
  }
  const canonicalCheckoutPath = resolveCanonicalCheckoutPath();
  if (resolvedMergeWorktreeDir) {
    // Ensure canonical checkout is on main before running the mutation guard.
    // A coder agent may have left the canonical checkout on a wave branch;
    // we must correct that first so the ff-only merge targets main.
    const currentCanonicalBranch = currentBranch(resolvedRepo);
    const checkout = currentCanonicalBranch === resolvedBranch
      ? { code: 0, stdout: "", stderr: "" }
      : run(["git", "-C", resolvedRepo, "checkout", resolvedBranch], resolvedRepo);
    if (checkout.code !== 0) {
      return { push_status: "error", push_stdout: checkout.stdout, push_stderr: checkout.stderr || `unable to checkout ${resolvedBranch}` };
    }
    const branchAfterCheckout = currentBranch(resolvedRepo);
    const ffGuard = guardGitMutation({
      operation: "fast_forward_main_only",
      repoPath: resolvedRepo,
      canonicalCheckoutPath,
      currentBranch: branchAfterCheckout || resolvedBranch,
      targetBranch: resolvedBranch,
      ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
    });
    if (!ffGuard.ok) {
      return { push_status: "error", push_stdout: "", push_stderr: ffGuard.reason };
    }
    run(["git", "-C", resolvedRepo, "fetch", resolvedRemote, resolvedBranch], resolvedRepo);
    const remoteHead = run(["git", "-C", resolvedRepo, "rev-parse", `${resolvedRemote}/${resolvedBranch}`], resolvedRepo);
    const localHead = run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch], resolvedRepo);
    let mergeHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "HEAD"], resolvedMergeWorktreeDir);
    if ((mergeHead.code !== 0 || !trim(mergeHead.stdout)) && resolvedMergedHeadSha) {
      // Merge worktree unavailable but caller provided the merged commit SHA —
      // verify it exists in the repo and use it directly.
      const verify = run(["git", "-C", resolvedRepo, "cat-file", "-t", resolvedMergedHeadSha], resolvedRepo);
      if (verify.code === 0 && trim(verify.stdout) === "commit") {
        mergeHead = { code: 0, stdout: resolvedMergedHeadSha, stderr: "" };
      }
    }
    if (mergeHead.code !== 0 || !trim(mergeHead.stdout)) {
      return { push_status: "error", push_stdout: "", push_stderr: trim(mergeHead.stderr) || "missing_merge_worktree_head" };
    }
    if (trim(remoteHead.stdout) && trim(localHead.stdout) && trim(remoteHead.stdout) !== trim(localHead.stdout)) {
      const sync = run(["git", "-C", resolvedRepo, "merge", "--ff-only", `${resolvedRemote}/${resolvedBranch}`], resolvedRepo);
      if (sync.code !== 0) {
        return {
          push_status: "conflict",
          push_stdout: [checkout.stdout, sync.stdout].filter(Boolean).join("\n"),
          push_stderr: [checkout.stderr, sync.stderr].filter(Boolean).join("\n"),
        };
      }
    }
    let candidateAncestor = run(["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", resolvedBranch, trim(mergeHead.stdout)], resolvedRepo);
    if (candidateAncestor.code !== 0) {
      // Main moved forward since rebase — attempt incremental re-rebase of
      // the merge worktree onto current main (never mutates local main).
      const reRebase = run(["git", "-C", resolvedMergeWorktreeDir, "rebase", resolvedBranch], resolvedMergeWorktreeDir);
      if (reRebase.code !== 0) {
        run(["git", "-C", resolvedMergeWorktreeDir, "rebase", "--abort"], resolvedMergeWorktreeDir);
        return {
          push_status: "conflict",
          push_stdout: "",
          push_stderr: `merge_worktree_head_not_descended_from_${resolvedBranch}`,
        };
      }
      mergeHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "HEAD"], resolvedMergeWorktreeDir);
      candidateAncestor = run(["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", resolvedBranch, trim(mergeHead.stdout)], resolvedRepo);
      if (candidateAncestor.code !== 0) {
        return {
          push_status: "conflict",
          push_stdout: "",
          push_stderr: `merge_worktree_head_not_descended_from_${resolvedBranch}`,
        };
      }
    }
    const ff = run(["git", "-C", resolvedRepo, "merge", "--ff-only", trim(mergeHead.stdout)], resolvedRepo);
    if (ff.code !== 0) {
      return { push_status: "conflict", push_stdout: ff.stdout, push_stderr: ff.stderr || "ff_only_merge_failed" };
    }
    const push = run(["git", "-C", resolvedRepo, "push", resolvedRemote, `${resolvedBranch}:${resolvedBranch}`], resolvedRepo);
    if (push.code === 0) {
      return {
        push_status: "pushed",
        push_stdout: [ff.stdout, push.stdout].filter(Boolean).join("\n"),
        push_stderr: [ff.stderr, push.stderr].filter(Boolean).join("\n"),
      };
    }
    const pushStderr = [ff.stderr, push.stderr].filter(Boolean).join("\n");
    return { push_status: isPushRejected(push.stderr) ? "conflict" : "error", push_failure_reason: classifyPushFailure(push.stderr), push_stdout: [ff.stdout, push.stdout].filter(Boolean).join("\n"), push_stderr: pushStderr };
  }
  const branchBefore = currentBranch(resolvedRepo);
  const pushGuard = guardGitMutation({
    operation: "push_main_verified",
    repoPath: resolvedRepo,
    canonicalCheckoutPath,
    currentBranch: branchBefore || resolvedBranch,
    targetBranch: resolvedBranch,
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  });
  if (!pushGuard.ok) {
    return { push_status: "error", push_stdout: "", push_stderr: pushGuard.reason };
  }
  if (branchBefore && branchBefore !== resolvedBranch) {
    const checkoutGuard = guardGitMutation({
      operation: "checkout_main_only",
      repoPath: resolvedRepo,
      canonicalCheckoutPath,
      currentBranch: branchBefore,
      targetBranch: resolvedBranch,
      ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
    });
    if (!checkoutGuard.ok) {
      return { push_status: "error", push_stdout: "", push_stderr: checkoutGuard.reason };
    }
  }
  const checkout = branchBefore === resolvedBranch
    ? { code: 0, stdout: "", stderr: "" }
    : run(["git", "-C", resolvedRepo, "checkout", resolvedBranch]);
  if (checkout.code !== 0) {
    return { push_status: "error", push_stdout: checkout.stdout, push_stderr: checkout.stderr || `unable to checkout ${resolvedBranch}` };
  }
  run(["git", "-C", resolvedRepo, "fetch", resolvedRemote, resolvedBranch]);
  const push = run(["git", "-C", resolvedRepo, "push", resolvedRemote, `${resolvedBranch}:${resolvedBranch}`]);
  if (push.code === 0) {
    return { push_status: "pushed", push_stdout: push.stdout, push_stderr: push.stderr };
  }
  if (!isPushRejected(push.stderr)) {
    return { push_status: "error", push_failure_reason: classifyPushFailure(push.stderr), push_stdout: push.stdout, push_stderr: push.stderr };
  }
  if (guardGitMutation({
    operation: "push_main_verified",
    repoPath: resolvedRepo,
    canonicalCheckoutPath,
    currentBranch: resolvedBranch,
    targetBranch: resolvedBranch,
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  }).ok && guardGitMutation({
    operation: "rebase_branch",
    repoPath: resolvedRepo,
    canonicalCheckoutPath,
    currentBranch: resolvedBranch,
    targetBranch: resolvedBranch,
    ...resolveRepoRoleGuardOptions({ repo: resolvedRepo }),
  }).blocked) {
    return { push_status: "conflict", push_stdout: push.stdout, push_stderr: [push.stderr, "canonical_checkout_rebase_blocked"].filter(Boolean).join("\n") };
  }
  const rb = run(["git", "-C", resolvedRepo, "rebase", `${resolvedRemote}/${resolvedBranch}`]);
  if (rb.code === 0) {
    const retry = run(["git", "-C", resolvedRepo, "push", resolvedRemote, `${resolvedBranch}:${resolvedBranch}`]);
    if (retry.code === 0) {
      return {
        push_status: "pushed",
        push_stdout: [push.stdout, retry.stdout].filter(Boolean).join("\n"),
        push_stderr: [push.stderr, "auto_heal=rebase_remote_main", rb.stderr, retry.stderr].filter(Boolean).join("\n"),
      };
    }
    const retryStderr = [push.stderr, "auto_heal=rebase_remote_main", rb.stderr, retry.stderr].filter(Boolean).join("\n");
    return { push_status: isPushRejected(retry.stderr) ? "conflict" : "error", push_failure_reason: classifyPushFailure(retry.stderr), push_stdout: [push.stdout, retry.stdout].filter(Boolean).join("\n"), push_stderr: retryStderr };
  }
  const unmerged = run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"]);
  const hasConflicts = unmerged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0;
  const rbStderr = [push.stderr, rb.stderr].filter(Boolean).join("\n");
  return { push_status: hasConflicts ? "conflict" : "error", push_failure_reason: classifyPushFailure(rbStderr), push_stdout: [push.stdout, rb.stdout].filter(Boolean).join("\n"), push_stderr: rbStderr };
}
export function verifyPushResolution({ repo = "", branch = "main", remote = "origin" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "main").trim() || "main";
  const resolvedRemote = String(remote || "origin").trim() || "origin";
  if (!resolvedRepo) {
    return { resolution_status: "unresolved", resolution_notes: "missing repo" };
  }
  run(["git", "-C", resolvedRepo, "fetch", resolvedRemote, resolvedBranch]);
  const unmerged = run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"]).stdout;
  if (String(unmerged || "").trim()) {
    return { resolution_status: "unresolved", resolution_notes: `Unmerged paths remain: ${unmerged}` };
  }
  const localHead = run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch]);
  const remoteHead = run(["git", "-C", resolvedRepo, "rev-parse", `${resolvedRemote}/${resolvedBranch}`]);
  if (localHead.code === 0 && remoteHead.code === 0 && localHead.stdout && remoteHead.stdout && localHead.stdout === remoteHead.stdout) {
    return { resolution_status: "resolved", resolution_notes: `${resolvedRemote}/${resolvedBranch} matches local ${resolvedBranch}` };
  }
  return {
    resolution_status: "unresolved",
    resolution_notes: `remote_mismatch local=${localHead.stdout || ""} remote=${remoteHead.stdout || ""}`.trim(),
  };
}
export function verifyPushRecovery({
  repo = "",
  branch = "main",
  remote = "origin",
  mergeWorktreeDir = "",
} = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "main").trim() || "main";
  const resolvedRemote = String(remote || "origin").trim() || "origin";
  const resolvedMergeWorktreeDir = trim(mergeWorktreeDir);
  if (!resolvedRepo) {
    return { resolution_status: "unresolved", resolution_notes: "missing repo" };
  }
  if (!resolvedMergeWorktreeDir) {
    return { resolution_status: "unresolved", resolution_notes: "missing merge worktree dir" };
  }
  run(["git", "-C", resolvedRepo, "fetch", resolvedRemote, resolvedBranch]);
  const canonicalUnmerged = trim(run(["git", "-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"], resolvedRepo).stdout);
  if (canonicalUnmerged) {
    return { resolution_status: "unresolved", resolution_notes: `canonical_unmerged_paths=${canonicalUnmerged}` };
  }
  const worktreeUnmerged = trim(run(["git", "-C", resolvedMergeWorktreeDir, "diff", "--name-only", "--diff-filter=U"], resolvedMergeWorktreeDir).stdout);
  if (worktreeUnmerged) {
    return { resolution_status: "unresolved", resolution_notes: `merge_worktree_unmerged_paths=${worktreeUnmerged}` };
  }
  const canonicalMergeHead = run(["git", "-C", resolvedRepo, "rev-parse", "-q", "--verify", "MERGE_HEAD"], resolvedRepo);
  if (canonicalMergeHead.code === 0 && trim(canonicalMergeHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "canonical_merge_in_progress" };
  }
  const canonicalRebaseHead = run(["git", "-C", resolvedRepo, "rev-parse", "-q", "--verify", "REBASE_HEAD"], resolvedRepo);
  if (canonicalRebaseHead.code === 0 && trim(canonicalRebaseHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "canonical_rebase_in_progress" };
  }
  const worktreeMergeHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "-q", "--verify", "MERGE_HEAD"], resolvedMergeWorktreeDir);
  if (worktreeMergeHead.code === 0 && trim(worktreeMergeHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "merge_worktree_merge_in_progress" };
  }
  const worktreeRebaseHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "-q", "--verify", "REBASE_HEAD"], resolvedMergeWorktreeDir);
  if (worktreeRebaseHead.code === 0 && trim(worktreeRebaseHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "merge_worktree_rebase_in_progress" };
  }
  const localHead = run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch], resolvedRepo);
  const remoteHead = run(["git", "-C", resolvedRepo, "rev-parse", `${resolvedRemote}/${resolvedBranch}`], resolvedRepo);
  if (localHead.code !== 0 || !trim(localHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: `missing_local_${resolvedBranch}_head` };
  }
  if (remoteHead.code !== 0 || !trim(remoteHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: `missing_remote_${resolvedRemote}/${resolvedBranch}_head` };
  }
  const localTracksRemote = run(
    ["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", trim(localHead.stdout), trim(remoteHead.stdout)],
    resolvedRepo,
  );
  if (localTracksRemote.code !== 0 && trim(localHead.stdout) !== trim(remoteHead.stdout)) {
    return {
      resolution_status: "unresolved",
      resolution_notes: `canonical_${resolvedBranch}_not_fast_forwardable_to_${resolvedRemote}/${resolvedBranch}`,
    };
  }
  const mergeHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "HEAD"], resolvedMergeWorktreeDir);
  if (mergeHead.code !== 0 || !trim(mergeHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "missing_merge_worktree_head" };
  }
  const mergeHeadDescendsRemote = run(
    ["git", "-C", resolvedRepo, "merge-base", "--is-ancestor", trim(remoteHead.stdout), trim(mergeHead.stdout)],
    resolvedRepo,
  );
  if (mergeHeadDescendsRemote.code !== 0) {
    return {
      resolution_status: "unresolved",
      resolution_notes: `merge_worktree_head_not_descended_from_${resolvedRemote}/${resolvedBranch}`,
    };
  }
  return {
    resolution_status: "resolved",
    resolution_notes: `push_recovery_verified merge_head=${trim(mergeHead.stdout)} local=${trim(localHead.stdout)} remote=${trim(remoteHead.stdout)}`,
  };
}
function parseCommits(lines = []) {
  return lines
    .map((ln) => String(ln || "").split("\t"))
    .filter((parts) => parts.length >= 2 && parts[0])
    .map(([hash, subject, body]) => {
      const m = String(body || "").match(/(^|\n)PI-Session:\s*(.+)\s*$/m);
      return { hash, subject: subject || "", pi_session: m ? String(m[2] || "").trim() : "" };
    });
}
export function buildConflictPacket({
  repo = "",
  branch = "",
  issueNumber = "",
  mergeCandidates = "",
  mergeStderr = "",
  worktreeDir = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "").trim();
  const resolvedWorktreeDir = String(worktreeDir || "").trim();
  const issue = String(issueNumber || "").trim();
  const conflictRepo = resolvedWorktreeDir || resolvedRepo;
  let conflictFiles = run(["git", "-C", conflictRepo, "diff", "--name-only", "--diff-filter=U"]).stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Fallback: parse rebase_conflict_files from stderr when git diff finds no UU files
  // (e.g., worktree state cleaned between nodes, but rebase stderr recorded the conflicts)
  if (conflictFiles.length === 0 && mergeStderr) {
    const match = String(mergeStderr).match(/rebase_conflict_files=([^\n]+)/);
    if (match) {
      conflictFiles = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  const historyRepo = resolvedRepo || conflictRepo;
  const branchLines = run(["git", "-C", historyRepo, "log", "--pretty=format:%H%x09%s%x09%b", `main..${resolvedBranch}`]).stdout.split(/\r?\n/);
  const branchCommits = parseCommits(branchLines);
  let mainCommits = [];
  if (conflictFiles.length > 0) {
    const cmd = ["git", "-C", historyRepo, "log", "--pretty=format:%H%x09%s%x09%b", "-n", "30", "main", "--", ...conflictFiles];
    mainCommits = parseCommits(run(cmd).stdout.split(/\r?\n/));
  }
  let mergeCandidateIssues = [];
  if (mergeCandidates) {
    try {
      const parsed = JSON.parse(String(mergeCandidates));
      mergeCandidateIssues = (Array.isArray(parsed) ? parsed : []).map((c) => String(c?.issue_number || "").trim()).filter(Boolean);
    } catch { /* non-JSON — ignore */ }
  }
  const packet = buildMergeConflictPacket({
    repo: resolvedRepo,
    branch: resolvedBranch,
    issueNumber: issue,
    worktreeDir: resolvedWorktreeDir,
    conflictFiles,
    branchCommits,
    mainCommitsTouchingConflicts: mainCommits,
    mergeCandidateIssues,
    mergeStderr: String(mergeStderr || ""),
    notes: "Use commit subjects and PI-Session trailers to recover intent and resolve conflicts. For dirty_worktree failures, deterministically clear local merge blockers and complete merge.",
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });
  const persisted = persistMergeConflictPacket({ repo: resolvedRepo || conflictRepo, packet });
  const baseResult = { conflict_packet_path: persisted.packet_path, conflict_packet_id: packet.packet_id, conflict_packet_schema_version: packet.schema_version, conflict_packet_storage_class: persisted.storage_class };
  if (String(nodeId || "").trim() === "build_push_failure_packet") { // @context:integration !critical Push recovery consumes push_failure_* aliases for the generic merge_conflict_packet.
    return { ...baseResult, push_failure_packet_path: persisted.packet_path, push_failure_packet_id: packet.packet_id, push_failure_packet_schema_version: packet.schema_version, push_failure_packet_storage_class: persisted.storage_class };
  }
  return baseResult;
}
export function finalizeMergeCommit({ repo = "", worktreeDir = "", expectedBranch = "", commitMessage = "", runFn = run } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedWorktreeDir = String(worktreeDir || "").trim();
  const resolvedExpectedBranch = String(expectedBranch || "").trim();
  const targetRepo = resolvedWorktreeDir || resolvedRepo;
  if (!targetRepo) {
    return { finalize_status: "ok", finalize_reason: "no_repo", finalize_detail: "" };
  }
  // Check current branch — if expectedBranch is set and we're on the wrong branch,
  // try to switch (the LLM may have left the repo on a different branch).
  if (resolvedExpectedBranch) {
    const currentBranch = runFn(["git", "-C", targetRepo, "rev-parse", "--abbrev-ref", "HEAD"]);
    const current = String(currentBranch.stdout || "").trim();
    if (current && current !== resolvedExpectedBranch) {
      const checkout = runFn(["git", "-C", targetRepo, "checkout", resolvedExpectedBranch]);
      if (checkout.code !== 0) {
        return {
          finalize_status: "needs_retry",
          finalize_reason: "wrong_branch",
          finalize_detail: `expected ${resolvedExpectedBranch}, on ${current}, checkout failed: ${checkout.stderr}`,
        };
      }
    }
  }
  // Check if MERGE_HEAD exists — if not, nothing to finalize
  const mh = runFn(["git", "-C", targetRepo, "rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (mh.code !== 0 || !mh.stdout) {
    return { finalize_status: "ok", finalize_reason: "no_merge_head", finalize_detail: "" };
  }
  // Check for unmerged paths (conflict markers in index)
  const unmerged = runFn(["git", "-C", targetRepo, "diff", "--name-only", "--diff-filter=U"]).stdout;
  if (String(unmerged || "").trim()) {
    return { finalize_status: "needs_retry", finalize_reason: "unmerged_paths", finalize_detail: unmerged.trim() };
  }
  // Check for residual conflict markers in staged files
  const staged = runFn(["git", "-C", targetRepo, "diff", "--cached", "--name-only"]).stdout;
  const stagedFiles = String(staged || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const f of stagedFiles) {
    const contents = runFn(["git", "-C", targetRepo, "show", `:${f}`]);
    if (contents.code === 0 && /^<{7}\s/m.test(String(contents.stdout || ""))) {
      return { finalize_status: "needs_retry", finalize_reason: "conflict_markers_remain", finalize_detail: f };
    }
  }
  // MERGE_HEAD present, no conflicts — finalize
  const resolvedMessage = String(commitMessage || "").trim();
  const commitArgs = resolvedMessage
    ? ["git", "-C", targetRepo, "commit", "-m", resolvedMessage]
    : ["git", "-C", targetRepo, "commit", "--no-edit"];
  const commit = runFn(commitArgs);
  if (commit.code === 0) {
    return { finalize_status: "ok", finalize_reason: "merge_committed", finalize_detail: "" };
  }
  // @context:decision !critical Distinguish hook failures (QA gate, fixable by editing code) from git state errors.
  const isHookFailure = ["[pre-commit]", "hook", "run-gates"].some((sig) => commit.stderr.toLowerCase().includes(sig));
  return { finalize_status: "needs_retry", finalize_reason: isHookFailure ? "hook_failed" : "commit_failed", finalize_detail: commit.stderr };
}
export function verifyConflictResolution({ repo = "", branch = "", worktreeDir = "", mergeWorktreeDir = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "").trim();
  const resolvedWorktreeDir = resolveMergeWorkspaceDir(mergeWorktreeDir, worktreeDir);
  const resolutionRepo = resolvedWorktreeDir || resolvedRepo;
  const {
    unmerged,
    mergeHeadPresent,
    rebaseApplyPresent,
    rebaseMergePresent,
    dirtyEntries,
  } = inspectMergeWorkspaceState({ repo: resolutionRepo });
  if (unmerged) return { resolution_status: "unresolved", resolution_notes: `Unmerged paths remain: ${unmerged}` };
  if (mergeHeadPresent) return { resolution_status: "unresolved", resolution_notes: "MERGE_HEAD present; merge commit not finalized" };
  if (rebaseApplyPresent || rebaseMergePresent) {
    return { resolution_status: "unresolved", resolution_notes: "Rebase still in progress; continue the rebase until rebase-apply/rebase-merge is gone" };
  }
  if (dirtyEntries.length > 0) {
    return {
      resolution_status: "unresolved",
      resolution_notes: `Worktree/index still dirty after conflict resolution: ${dirtyEntries.join(", ")}`,
    };
  }
  if (resolvedBranch) {
    const historyRepo = resolvedRepo || resolutionRepo;
    if (resolvedWorktreeDir) {
      const state = readMergeWorktreeState({ mergeWorktreeDir: resolvedWorktreeDir });
      const mergeBaseRef = trim(state.merge_base_ref) || resolveMergeBaseRef({ repo: historyRepo });
      const worktreeHead = currentMergeWorktreeHead({ mergeWorktreeDir: resolvedWorktreeDir });
      const includesMain = run(["git", "-C", historyRepo, "merge-base", "--is-ancestor", mergeBaseRef, worktreeHead], historyRepo);
      if (includesMain.code !== 0) {
        return { resolution_status: "unresolved", resolution_notes: "Merge worktree head does not yet include main after conflict resolution" };
      }
      return { resolution_status: "resolved", resolution_notes: "Conflict resolved in merge worktree" };
    }
    const anc = run(["git", "-C", historyRepo, "merge-base", "--is-ancestor", resolvedBranch, "main"]);
    if (anc.code !== 0) return { resolution_status: "unresolved", resolution_notes: "Branch is not yet merged into main" };
  }
  return { resolution_status: "resolved", resolution_notes: "Conflict resolved and merge finalized" };
}
export function runMergeIntegration({ repo = "", integrationCommand = "", worktreeDir = "", mergeWorktreeDir = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const executionDir = resolveMergeWorkspaceDir(mergeWorktreeDir, worktreeDir) || resolvedRepo || process.cwd();
  const command = String(integrationCommand || "").trim();
  if (!command) {
    return {
      integration_command: "",
      integration_exit_code: 0,
      integration_stdout: "",
      integration_stderr: "",
      integration_duration_ms: 0,
      integration_legacy_text: "integration_exit_code=0 (no command)",
    };
  }
  const startedAt = Date.now();
  const exec = spawnSync("sh", ["-c", command], {
    encoding: "utf8",
    cwd: executionDir,
  });
  const durationMs = Math.max(0, Date.now() - startedAt);
  const exitCode = Number.isInteger(exec.status) ? exec.status : 1;
  const errorText = exec.error ? String(exec.error.message || exec.error) : "";
  return {
    integration_command: command,
    integration_exit_code: exitCode,
    integration_stdout: String(exec.stdout || ""),
    integration_stderr: [String(exec.stderr || ""), errorText].filter(Boolean).join("\n"),
    integration_duration_ms: durationMs,
    integration_legacy_text: `integration_exit_code=${exitCode}`,
  };
}
function resolveIntegrationLegacyText(raw = "") {
  const parsed = parseJson(String(raw || ""), {});
  const explicit = String(parsed?.integration_legacy_text || "").trim();
  if (explicit) return explicit;
  const code = Number(parsed?.integration_exit_code);
  return Number.isFinite(code) ? `integration_exit_code=${code}` : "";
}
export function buildMergeReport({ issueNumber = "", branch = "", mergeStatus = "", notes = "", integrationResultRaw = "", mergeResolver = "", pathTaken = "" } = {}) {
  const baseNotes = String(notes || "").trim();
  const integrationLegacyText = resolveIntegrationLegacyText(integrationResultRaw);
  const mergedNotes = [baseNotes, integrationLegacyText].filter(Boolean).join(" ").trim();
  const resolvedPathTaken = String(pathTaken || "").trim() || "merge";
  const resolvedMergeResolver = String(mergeResolver || "").trim() || "unknown";
  return {
    issue_number: String(issueNumber || ""),
    branch: String(branch || ""),
    merge_status: String(mergeStatus || "").trim(),
    notes: mergedNotes,
    path_taken: resolvedPathTaken,
    "hatch.merge.resolver": resolvedMergeResolver,
  };
}
function nullableText(value = "") {
  const normalized = trim(value);
  return normalized ? normalized : null;
}
export function emitResolutionFailure({
  recurrenceKey = "",
  resolutionNotes = "",
  resolutionCheck = "",
  branch = "",
  issue = "",
  runId = "",
  factoryId = "",
  runsDir = "",
} = {}) {
  const paths = resolveMergeTelemetryFilePath({ factoryId, runsDir });
  mkdirSync(paths.eventsDir, { recursive: true });
  const event = {
    event: "merge_conflict_llm_resolution_failure",
    recurrence_key: trim(recurrenceKey),
    resolution_notes: nullableText(resolutionNotes),
    resolution_check: nullableText(resolutionCheck),
    branch: trim(branch),
    issue: trim(issue),
    run_id: trim(runId),
    factory_id: paths.factoryId,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(paths.filePath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
export { countResolutionFailures, buildGoalScopedMergeMessage } from "./merge-goal-message.ts";
