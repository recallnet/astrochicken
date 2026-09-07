import { createGhCliAdapter, createGitHubProjectionTarget } from "../../../github-adapter/src/github-adapter.ts";
import {
  buildIssueSubIssueLinkAppliedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { appendCanonicalEventsWithLockTimeoutFallback } from "../lib/canonical-event-append-fallback.ts";
import { appendCanonicalEventsSync } from "../lib/canonical-event-log.ts";
import { normalizeIssueSubIssueLinkTransition } from "../lib/canonical-issue-lifecycle.ts";
import { resolveGitHubProjectionTarget } from "../lib/github-projection-target.ts";

/**
 * List sub-issues of a goal issue via the GitHub sub-issues API.
 *
 * @param {{ repo: string, goalNumber: string|number, ghPaginatedFn?: Function }} opts
 * @returns {Array<{ number: number, title: string, state: string, labels: Array<{name: string}> }>}
 */
export function listGoalSubIssues({
  repo,
  goalNumber,
  adapter,
  ghPaginatedFn,
} = {}) {
  const effectiveRepo = repo || adapter?.repo;
  if (!effectiveRepo || !goalNumber) return [];
  const githubAdapter = adapter
    || (typeof ghPaginatedFn === "function"
      ? {
        repo: effectiveRepo,
        listSubIssues: ({ number } = {}) => ghPaginatedFn(`repos/${effectiveRepo}/issues/${number}/sub_issues?per_page=100`, []),
      }
      : createGhCliAdapter({ repo: effectiveRepo }));
  const raw = githubAdapter.listSubIssues({ number: goalNumber });
  return (Array.isArray(raw) ? raw : []).map((i) => ({
    number: Number(i.number),
    title: String(i.title || ""),
    state: String(i.state || "").toLowerCase(),
    labels: (Array.isArray(i.labels) ? i.labels : []).map((l) => ({
      name: String(l.name || l || ""),
    })),
    blocked_by_count: Number(i.issue_dependencies_summary?.blocked_by ?? 0),
  }));
}

/**
 * Add a sub-issue relationship: child becomes a sub-issue of parent.
 *
 * @param {{ repo: string, parentNumber: string|number, childNumber: string|number, ghFn?: Function }} opts
 * @returns {{ ok: boolean, parent: string, child: string, error: string }}
 */
export function addSubIssue({
  repo,
  parentNumber,
  childNumber,
  ghExec,
  adapter,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  mutationContext = null,
  mutationContextJson = "",
  env = process.env,
  appendAuditRecordFn,
  auditHostBaseDir = "",
  auditLogPath = "",
  auditHomeDir,
  emitDomainEventFn,
  emitCanonicalEventFn,
  appendCanonicalEventsFn = appendCanonicalEventsSync,
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
} = {}) {
  const effectiveRepo = String(repo || adapter?.repo || githubProjectionTarget?.repo || "").trim();
  const parent = String(parentNumber || "").trim();
  const child = String(childNumber || "").trim();
  if (!effectiveRepo || !parent || !child) {
    return { ok: false, parent, child, error: "missing_required_args" };
  }
  const projectionReceiptEvents = [];
  const emitCanonicalReceipt = (event) => {
    projectionReceiptEvents.push(event);
    if (typeof emitCanonicalEventFn === "function") emitCanonicalEventFn(event);
  };
  const projectionTarget = githubProjectionTarget
    ? {
      repo: effectiveRepo,
      addSubIssue: ({ parentNumber, childNumber }) => {
        const result = githubProjectionTarget.addSubIssue({ parentNumber, childNumber });
        emitCanonicalReceipt({
          event_family: "github.projection.receipt",
          payload: {
            operation: "add_sub_issue",
            target_ref: `issues/${parentNumber}/sub_issues/${childNumber}`,
            issue_number: String(childNumber),
            ok: Boolean(result?.ok),
            status: Number(result?.status || 0),
            stderr: String(result?.stderr || ""),
            error: String(result?.error || ""),
            parent_issue_number: String(parentNumber),
            child_issue_number: String(childNumber),
          },
        });
        return result;
      },
    }
    : (adapter
      ? createGitHubProjectionTarget({
        adapter,
        factoryId,
        runId,
        emitCanonicalEventFn: emitCanonicalReceipt,
      })
      : resolveGitHubProjectionTarget({
        repo: effectiveRepo,
        ghExec,
        githubProjectionTarget,
        factoryId,
        runId,
        mutationContext,
        mutationContextJson,
        env,
        appendAuditRecordFn,
        auditHostBaseDir,
        auditLogPath,
        auditHomeDir,
        emitCanonicalEventFn: emitCanonicalReceipt,
      }));
  const result = projectionTarget.addSubIssue({ parentNumber: parent, childNumber: child });
  const lifecycle = normalizeIssueSubIssueLinkTransition({
    repo: effectiveRepo,
    issueNumber: child,
    parentIssueNumber: parent,
    linkStatus: result?.ok ? "linked" : "failed",
    error: result?.error || "",
  });
  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: [
      buildIssueSubIssueLinkAppliedEvent({
        factoryId,
        runId,
        issueNumber: lifecycle.issue_number,
        parentIssueNumber: lifecycle.parent_issue_number,
        repo: lifecycle.repo,
        linkStatus: lifecycle.link_status,
        error: lifecycle.error,
      }),
    ],
    emitDomainEventFn,
  });
  const persistedCanonicalEvents = [...projectionReceiptEvents, ...canonicalEvents];
  let canonicalEventCommitCursor = 0;
  let canonicalEventPersistenceDeferred = false;
  let stderr = String(result?.stderr || "");
  if (factoryId && persistedCanonicalEvents.length > 0 && typeof appendCanonicalEventsFn === "function") {
    const appendResult = appendCanonicalEventsWithLockTimeoutFallback({
      appendCanonicalEventsFn,
      appendArgs: {
        events: persistedCanonicalEvents,
        runsDir,
        context: {
          ...context,
          factory_id: factoryId,
          canonical_event_store_url: context?.canonical_event_store_url,
        },
        repoRoot,
        surface: "canonical issue lifecycle",
      },
      stderr,
    });
    canonicalEventCommitCursor = appendResult.canonicalEventCommitCursor;
    canonicalEventPersistenceDeferred = appendResult.canonicalEventPersistenceDeferred;
    stderr = appendResult.stderr;
  }
  return {
    ...result,
    stderr,
    canonical_events: persistedCanonicalEvents,
    canonical_event_commit_cursor: canonicalEventCommitCursor,
    canonical_event_persistence_deferred: canonicalEventPersistenceDeferred,
  };
}

/**
 * Check if all sub-issues of a goal are closed.
 *
 * @param {{ repo: string, goalNumber: string|number, ghPaginatedFn?: Function }} opts
 * @returns {{ all_closed: boolean, total: number, open: number, closed: number, sub_issues: Array }}
 */
export function checkAllSubIssuesClosed({
  repo,
  goalNumber,
  adapter,
  ghPaginatedFn = ghJsonPaginated,
} = {}) {
  const subIssues = listGoalSubIssues({ repo, goalNumber, adapter, ghPaginatedFn });
  const open = subIssues.filter((i) => i.state === "open");
  const closed = subIssues.filter((i) => i.state !== "open");
  return {
    all_closed: open.length === 0 && subIssues.length > 0,
    total: subIssues.length,
    open: open.length,
    closed: closed.length,
    sub_issues: subIssues,
  };
}
