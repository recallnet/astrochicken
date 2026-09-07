import {
  buildIssueCreatedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { appendCanonicalEventsWithLockTimeoutFallback } from "../lib/canonical-event-append-fallback.ts";
import { appendCanonicalEventsSync } from "../lib/canonical-event-log.ts";
import { parseJson } from "../lib/cli-helpers.ts";
import { resolveGitHubProjectionTarget } from "../lib/github-projection-target.ts";

export function createGitHubIssueFromSpec({
  repo,
  issueSpecRaw = "{}",
  ghExec,
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
  const spec = parseJson(String(issueSpecRaw || "{}"), {});
  const title = String(spec?.issue_title || "").trim();
  const body = String(spec?.issue_body || "").trim();
  const labels = normalizeLabelList(spec?.issue_labels);
  if (!repo || !title || !body) {
    return { ok: false, error: "missing_required_fields", issue_url: "" };
  }
  const canonicalReceiptEvents = [];
  const emitCanonicalReceipt = (event) => {
    canonicalReceiptEvents.push(event);
    if (typeof emitCanonicalEventFn === "function") emitCanonicalEventFn(event);
  };
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
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
  });
  const out = projectionTarget.issueCreate({ title, body, labels: [] });
  const issueUrl = String(out.url || out.stdout || "").trim();
  const numberMatch = issueUrl.match(/\/issues\/(\d+)$/);
  if (!out.ok) {
    return {
      ok: false,
      issue_url: issueUrl,
      created_issue_number: numberMatch?.[1] || "",
      status: out.status,
      stderr: out.stderr,
      rejected_labels: [],
      applied_labels: [],
    };
  }
  const labelSync = syncIssueLabels({
    issueNumber: numberMatch?.[1] || "",
    labels,
    projectionTarget,
  });
  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: labelSync.ok
      ? [
        buildIssueCreatedEvent({
          factoryId,
          runId,
          issueNumber: numberMatch?.[1] || "",
          issueUrl,
          repo,
          appliedLabels: labelSync.appliedLabels,
          rejectedLabels: labelSync.rejectedLabels,
        }),
      ]
      : [],
    emitDomainEventFn,
  });
  const persistedCanonicalEvents = [...canonicalReceiptEvents, ...canonicalEvents];
  let canonicalEventCommitCursor = 0;
  let canonicalEventPersistenceDeferred = false;
  let stderr = joinStderr(out.stderr, labelSync.stderr);
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
    ok: labelSync.ok,
    issue_url: issueUrl,
    created_issue_number: numberMatch?.[1] || "",
    status: labelSync.status,
    stderr,
    rejected_labels: labelSync.rejectedLabels,
    applied_labels: labelSync.appliedLabels,
    canonical_events: canonicalEvents,
    canonical_event_commit_cursor: canonicalEventCommitCursor,
    canonical_event_persistence_deferred: canonicalEventPersistenceDeferred,
  };
}

export function updateGitHubIssueFromSpec({
  repo,
  issueUrl = "",
  issueSpecRaw = "{}",
  ghExec,
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
  emitCanonicalEventFn,
} = {}) {
  const spec = parseJson(String(issueSpecRaw || "{}"), {});
  const title = String(spec?.issue_title || "").trim();
  const body = String(spec?.issue_body || "").trim();
  const labels = normalizeLabelList(spec?.issue_labels);
  const issueNumber = parseIssueNumber(issueUrl);
  if (!repo || !issueNumber || !title || !body) {
    return { ok: false, error: "missing_required_fields", issue_url: "" };
  }
  const projectionTarget = resolveGitHubProjectionTarget({
    repo,
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
    emitCanonicalEventFn,
  });
  const out = projectionTarget.issueEdit({ number: issueNumber, title, body });
  if (!out.ok) {
    return {
      ok: false,
      issue_url: String(issueUrl || "").trim(),
      status: out.status,
      stderr: out.stderr,
      rejected_labels: [],
      applied_labels: [],
    };
  }
  const labelSync = syncIssueLabels({
    issueNumber,
    labels,
    projectionTarget,
  });
  return {
    ok: labelSync.ok,
    issue_url: String(issueUrl || "").trim(),
    status: labelSync.status,
    stderr: joinStderr(out.stderr, labelSync.stderr),
    rejected_labels: labelSync.rejectedLabels,
    applied_labels: labelSync.appliedLabels,
  };
}

function parseIssueNumber(issueUrl = "") {
  const match = String(issueUrl || "").trim().match(/\/issues\/(\d+)$/);
  return match?.[1] ? String(match[1]) : "";
}

function normalizeLabelList(rawLabels = "") {
  return String(rawLabels || "")
    .split(",")
    .map((label) => String(label || "").trim())
    .filter(Boolean);
}

function looksLikeLabelNotFound(text = "") {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("label") && normalized.includes("not found");
}

function looksLikeNotResolved(text = "") {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("could not resolve");
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function syncIssueLabels({ issueNumber, labels = [], projectionTarget } = {}) {
  const normalizedLabels = Array.isArray(labels) ? labels : [];
  if (!issueNumber || normalizedLabels.length === 0) {
    return { ok: true, status: 0, stderr: "", rejectedLabels: [], appliedLabels: [] };
  }

  const rejectedLabels = [];
  const appliedLabels = [];
  const stderrParts = [];

  for (const label of normalizedLabels) {
    let out;
    let lastDetail = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) sleepSync(1500 * attempt);
      out = projectionTarget.issueEdit({ number: issueNumber, addLabels: [label] });
      if (out?.ok) break;
      lastDetail = String(out?.stderr || out?.stdout || "gh issue edit add-label failed");
      if (!looksLikeNotResolved(lastDetail)) break;
    }
    if (out?.ok) {
      appliedLabels.push(label);
      continue;
    }
    const detail = lastDetail || String(out?.stderr || out?.stdout || "gh issue edit add-label failed");
    stderrParts.push(detail);
    if (looksLikeLabelNotFound(detail)) {
      rejectedLabels.push(label);
      continue;
    }
    return {
      ok: false,
      status: out?.status ?? 1,
      stderr: stderrParts.join("\n"),
      rejectedLabels,
      appliedLabels,
    };
  }

  return {
    ok: true,
    status: 0,
    stderr: stderrParts.join("\n"),
    rejectedLabels,
    appliedLabels,
  };
}

function joinStderr(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}
