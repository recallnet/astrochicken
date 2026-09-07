import { basename, dirname, join } from "node:path";

import {
  buildIssueExecutionStartedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { resolveDisposableWorktreeRoot } from "../lib/canonical-worktree.ts";

function safeBranchPath(branch) {
  return String(branch || "").replace(/[^A-Za-z0-9._/-]+/g, "-");
}

function deduplicateKindPrefix(root, branchPath) {
  const kind = basename(root);
  if (kind && branchPath.startsWith(kind + "/")) {
    return branchPath.slice(kind.length + 1);
  }
  return branchPath;
}

function safeSession(branch) {
  return String(branch || "").replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function initWaveIssueWorktree({ issueNumber, repo, branch = "", worktreeDir = "", agentSessionId = "", factoryId = "", runId = "", emitDomainEventFn } = {}) {
  const issue = String(issueNumber || "").trim();
  const resolvedRepo = String(repo || process.cwd());
  const resolvedBranch = String(branch || "").trim() || `wave/${issue}`;
  let resolvedWorktreeDir = String(worktreeDir || "").trim();
  if (!resolvedWorktreeDir) {
    const root = resolveDisposableWorktreeRoot({ repoPath: resolvedRepo, kind: "wave" })
      || join(dirname(resolvedRepo), ".hatch-worktrees", "wave");
    resolvedWorktreeDir = join(root, deduplicateKindPrefix(root, safeBranchPath(resolvedBranch)));
  }
  const resolvedSession = String(agentSessionId || "").trim() || `worktree-${safeSession(resolvedBranch)}`;
  let legacy = "";
  if (resolvedBranch === `wave/${issue}`) {
    legacy = join(dirname(resolvedRepo), ".hatch-worktrees", `issue-${issue}`);
  }
  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: [
      buildIssueExecutionStartedEvent({
        factoryId,
        runId,
        issueNumber: issue,
        branch: resolvedBranch,
        worktreeDir: resolvedWorktreeDir,
        agentSessionId: resolvedSession,
      }),
    ],
    emitDomainEventFn,
  });
  return {
    branch: resolvedBranch,
    worktree_dir: resolvedWorktreeDir,
    legacy_worktree_dir: legacy,
    agent_session_id: resolvedSession,
    canonical_events: canonicalEvents,
  };
}
