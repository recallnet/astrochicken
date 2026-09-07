import { createGhCliAdapter, runGhCli } from "@hatch/github-adapter";

import {
  buildIssueCloseAppliedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { appendCanonicalEventsSync } from "../lib/canonical-event-log.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";
import { resolveGitHubProjectionTarget } from "../lib/github-projection-target.ts";

function isWaveMarker(issue = {}) {
  return /^Wave Ready:\s+/.test(String(issue?.title || ""));
}

function normalizeIssueNumbers(items = []) {
  return [...new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item || "").trim())
      .filter((item) => item && item !== "0"),
  )];
}

function milestoneOpenIssueNumbers({
  milestoneTitle = "",
  listMilestoneOpenIssuesFn,
  repo = "",
  execGh = runGhCli,
} = {}) {
  if (!repo || !milestoneTitle) return [];
  const issues = typeof listMilestoneOpenIssuesFn === "function"
    ? listMilestoneOpenIssuesFn([
      "issue", "list", "--repo", repo, "--state", "open", "--milestone", milestoneTitle,
      "--limit", "300", "--json", "number,title,labels",
    ], [])
    : createGhCliAdapter({
      repo,
      ghFn: typeof execGh === "function"
        ? (args, options) => execGh(args, options)
        : undefined,
    }).issueList({
      state: "open",
      milestone: milestoneTitle,
      limit: 300,
      fields: "number,title,labels",
    });
  return normalizeIssueNumbers(
    (Array.isArray(issues) ? issues : [])
      .filter((issue) => !isWaveMarker(issue))
      .map((issue) => String(issue?.number || "")),
  );
}

function buildProjectionTarget({
  repo = "",
  execGh = runGhCli,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  if (githubProjectionTarget) {
    const emitReceipt = ({ operation = "", targetRef = "", issueNumber = "", ok = false, status = 0, stderr = "", error = "" } = {}) => {
      if (typeof emitCanonicalEventFn !== "function") return;
      emitCanonicalEventFn({
        event_family: "github.projection.receipt",
        payload: {
          operation,
          target_ref: targetRef,
          issue_number: trim(issueNumber),
          ok: Boolean(ok),
          status: Number(status || 0),
          stderr: trim(stderr),
          error: trim(error),
        },
      });
    };
    return {
      repo,
      issueComment({ number, body }) {
        const result = githubProjectionTarget.issueComment({ number, body });
        emitReceipt({
          operation: "issue_comment",
          targetRef: `issues/${number}`,
          issueNumber: String(number),
          ok: result?.ok,
          status: result?.status,
          stderr: result?.stderr,
          error: result?.error,
        });
        return result;
      },
      issueClose({ number, reason }) {
        const result = githubProjectionTarget.issueClose({ number, reason });
        emitReceipt({
          operation: "issue_close",
          targetRef: `issues/${number}`,
          issueNumber: String(number),
          ok: result?.ok,
          status: result?.status,
          stderr: result?.stderr,
          error: result?.error,
        });
        return result;
      },
    };
  }

  if (!repo) {
    return {
      repo,
      issueComment({ number, body }) {
        return execGh([
          "issue", "comment", String(number),
          "--repo", repo,
          "--body", String(body || ""),
        ]);
      },
      issueClose({ number, reason }) {
        return execGh([
          "issue", "close", String(number),
          "--repo", repo,
          "--reason", String(reason || ""),
        ]);
      },
    };
  }

  return resolveGitHubProjectionTarget({
    repo,
    ghExec: execGh,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
}

/**
 * Close all issues that were approved and merged as part of a wave.
 * Called after the single-branch merge succeeds.
 *
 * @param {Object} opts
 * @param {string} opts.repo - owner/repo
 * @param {string} opts.mergeCandidatesRaw - JSON array of impl_result items (each has issue_number)
 * @param {string} opts.runId - current run ID for audit trail
 * @param {string} opts.milestoneTitle - wave milestone title
 * @param {(args: string[]) => { ok: boolean, stdout?: string, stderr?: string }} [opts.execGh]
 * @param {(args: string[], fallback?: any[]) => any[]} [opts.listMilestoneOpenIssuesFn]
 * @returns {{ closed: string[], failed: string[], closed_count: number, failed_count: number }}
 */
export function closeMergedIssues({
  repo = "",
  mergeCandidatesRaw = "[]",
  runId = "",
  factoryId = "",
  milestoneTitle = "",
  execGh = runGhCli,
  githubProjectionTarget,
  listMilestoneOpenIssuesFn,
  emitDomainEventFn,
  emitCanonicalEventFn,
  appendCanonicalEventsFn = appendCanonicalEventsSync,
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
} = {}) {
  const candidates = parseJson(String(mergeCandidatesRaw || "[]"), []);
  const arr = Array.isArray(candidates) ? candidates : [];
  const closed = [];
  const failed = [];
  const canonicalReceiptEvents = [];
  const emitCanonicalReceipt = (event) => {
    canonicalReceiptEvents.push(event);
    if (typeof emitCanonicalEventFn === "function") emitCanonicalEventFn(event);
  };
  const projectionTarget = buildProjectionTarget({
    repo,
    execGh,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn: emitCanonicalReceipt,
  });
  const candidateIssueNumbers = normalizeIssueNumbers(arr.map((item) => String(item?.issue_number || "")));
  const milestoneIssueNumbers = milestoneOpenIssueNumbers({
    milestoneTitle,
    listMilestoneOpenIssuesFn,
    repo,
    execGh,
  });
  const issueNumbers = normalizeIssueNumbers([...candidateIssueNumbers, ...milestoneIssueNumbers]);
  const canonicalEvents = [];

  for (const issueNumber of issueNumbers) {
    const comment = `Merged as part of wave \`${milestoneTitle || "unknown"}\` (run: ${runId || "unknown"}).`;
    projectionTarget.issueComment({
      number: issueNumber,
      body: comment,
    });

    const closeResult = projectionTarget.issueClose({
      number: issueNumber,
      reason: "completed",
    });

    canonicalEvents.push(...dispatchCanonicalDomainEvents({
      events: [
        buildIssueCloseAppliedEvent({
          factoryId,
          runId,
          issueNumber,
          repo,
          closeStatus: closeResult?.ok ? "closed" : "failed",
          reason: "completed",
          error: closeResult?.error || closeResult?.stderr || "",
        }),
      ],
      emitDomainEventFn,
    }));

    if (closeResult?.ok) {
      closed.push(issueNumber);
    } else {
      failed.push(issueNumber);
    }
  }

  const persistedCanonicalEvents = [...canonicalReceiptEvents, ...canonicalEvents];
  let canonicalEventCommitCursor = 0;
  if (factoryId && persistedCanonicalEvents.length > 0 && typeof appendCanonicalEventsFn === "function") {
    // @context:integration !critical Merged-issue closure is a GitHub projection, not the
    // lifecycle truth. Persist the projection receipts and close-applied event together so
    // reconciliation can prove what we intended even if GitHub drifts or partially fails.
    canonicalEventCommitCursor = Number(appendCanonicalEventsFn({
      events: persistedCanonicalEvents,
      runsDir,
      context: {
        ...context,
        factory_id: factoryId,
        canonical_event_store_url: context?.canonical_event_store_url,
      },
      repoRoot,
      surface: "canonical issue lifecycle",
    }) || 0);
  }

  const result = {
    closed,
    failed,
    closed_count: closed.length,
    failed_count: failed.length,
  };
  if (persistedCanonicalEvents.length > 0 || canonicalEventCommitCursor > 0) {
    result.canonical_events = persistedCanonicalEvents;
    result.canonical_event_commit_cursor = canonicalEventCommitCursor;
  }
  return result;
}
