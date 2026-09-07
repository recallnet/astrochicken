import { trim, parseJson, gh } from "../lib/cli-helpers.ts";
import {
  describeUnblockCondition,
  isControlPlaneBlocked,
  isControlPlaneResolved,
  parseControlPlaneBlocker,
  serializeControlPlaneBlocker,
} from "../lib/control-plane-blocker.ts";
import { FACTORY_OPS_ERROR_CODES } from "../lib/error-catalog.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
} from "../lib/factory-label-contract.ts";

function runGh(args, stdin = "") {
  return gh(args, stdin !== undefined && stdin !== null && String(stdin).length > 0
    ? { input: String(stdin) }
    : undefined);
}


function toBlockedByComment(blockedByRaw) {
  const raw = String(blockedByRaw || "").trim();
  if (raw && raw !== "[]") return `Blocked by relationship targets: ${raw}`;
  return "BLOCKED_WITHOUT_BLOCKER_RELATIONSHIP: triage status=blocked but blocked_by is empty.";
}

function formatControlPlaneBlockerComment(blocker) {
  const serialized = serializeControlPlaneBlocker(blocker);
  const kind = blocker.kind || "upstream_bug";
  const blockerRef = blocker.blockerRef || "(unspecified)";
  const unblock = describeUnblockCondition(blocker) || "Wait for control-plane blocker status to change.";
  return [
    `Control-plane blocker metadata: ${serialized}`,
    `Blocked on ${kind} ${blockerRef} until ${unblock}`,
  ].join("\n");
}

function parseIssueView(stdout = "") {
  const parsed = parseJson(stdout, {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

function getLabelNames(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => String(label?.name || label || "").trim())
    .filter(Boolean);
}

function normalizeIssueState(value = "") {
  const state = String(value || "").trim().toLowerCase();
  return state === "closed" ? "closed" : "open";
}

function closeIssueNotPlanned({ repo = "", issue = 0, runGhFn = runGh } = {}) {
  const payload = JSON.stringify({
    state: "closed",
    state_reason: "not_planned",
  });
  return runGhFn([
    "api",
    "-X",
    "PATCH",
    `repos/${repo}/issues/${issue}`,
    "--input",
    "-",
  ], payload);
}

export function applyTriageStatus({
  repo,
  issueNumber,
  status,
  blockedByRaw = "[]",
  notes = "",
  controlPlaneBlockerRaw = "",
  runGhFn = runGh,
} = {}) {
  const issue = Number(issueNumber || 0);
  const normalizedStatus = String(status || "").trim().toLowerCase();

  if (!repo || !issue || !normalizedStatus) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.missing_args, error: "repo, issueNumber, and status are required" };
  }

  const blocker = parseControlPlaneBlocker({
    metadata: controlPlaneBlockerRaw,
    notes,
  });

  const addTriaged = runGhFn(buildIssueLabelEditArgs({
    repo,
    issueNumber: issue,
    factoryId: "mothership",
    addKeys: [FACTORY_LABEL_KEYS.TRIAGED],
  }));
  if (!addTriaged.ok) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_add_label_failed, error: addTriaged.stderr || addTriaged.stdout };
  }

  // Blocking relationships are expressed via GitHub's native blocked-by
  // field (set by sync-blocked-by), not comments or labels.

  return {
    ok: true,
    issue_number: issue,
    status: normalizedStatus,
  };
}

export function applyRejectedUpstream({
  repo,
  issue,
  blockerRef = "",
  runGhFn = runGh,
} = {}) {
  const issueNumber = Number.parseInt(String(issue || "0"), 10);
  if (!repo || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.missing_args, error: "repo and issue are required" };
  }

  const viewed = runGhFn([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "state,labels",
  ]);
  if (!viewed.ok) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_issue_view_failed, error: viewed.stderr || viewed.stdout };
  }

  const issueView = parseIssueView(viewed.stdout);
  const state = normalizeIssueState(issueView?.state);
  if (state === "closed") {
    return { ok: true, skipped: true, issueNumber };
  }

  const serialized = serializeControlPlaneBlocker({
    kind: "upstream_rejected",
    blockerRef: String(blockerRef || "").trim(),
    unblockCondition: "Upstream rejected requested control-plane change.",
    status: "rejected",
  });

  const comment = runGhFn([
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    repo,
    "--body",
    serialized,
  ]);
  if (!comment.ok) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_rejected_comment_failed, error: comment.stderr || comment.stdout };
  }

  const labelNames = getLabelNames(issueView?.labels);
  const blockedLabels = labelNames.filter((name) => {
    const lowered = String(name).trim().toLowerCase();
    return lowered === "blocked-control-plane" || lowered === "blocked_control_plane";
  });

  if (blockedLabels.length > 0) {
    const removeArgs = ["issue", "edit", String(issueNumber), "--repo", repo];
    for (const label of blockedLabels) {
      removeArgs.push("--remove-label", label);
    }
    const remove = runGhFn(removeArgs);
    if (!remove.ok) {
      return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_remove_blocked_label_failed, error: remove.stderr || remove.stdout };
    }
  }

  const addNotPlanned = runGhFn([
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    "--add-label",
    "not-planned",
  ]);
  if (!addNotPlanned.ok) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_add_not_planned_label_failed, error: addNotPlanned.stderr || addNotPlanned.stdout };
  }

  const closed = closeIssueNotPlanned({ repo, issue: issueNumber, runGhFn });
  if (!closed.ok) {
    return { ok: false, error_code: FACTORY_OPS_ERROR_CODES.triage_close_not_planned_failed, error: closed.stderr || closed.stdout };
  }

  return {
    ok: true,
    skipped: false,
    issueNumber,
  };
}
