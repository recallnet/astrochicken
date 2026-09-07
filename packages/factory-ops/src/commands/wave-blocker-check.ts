import { trim, ghJson } from "../lib/cli-helpers.ts";
import {
  isControlPlaneResolved,
  parseControlPlaneBlocker,
} from "../lib/control-plane-blocker.ts";
import { FACTORY_OPS_ERROR_CODES } from "../lib/error-catalog.ts";



function normalizeIssueLabelName(name = "") {
  return String(name || "").trim().toLowerCase();
}

function hasBlockedControlPlaneLabel(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => normalizeIssueLabelName(label?.name || label || ""))
    .some((name) => name === "blocked-control-plane" || name === "blocked_control_plane");
}

async function fetchIssueComments({ repo = "", issue = 0, ghJsonFn = ghJson } = {}) {
  const comments = [];
  const perPage = 100;

  for (let page = 1; page <= 100; page += 1) {
    const rows = await Promise.resolve(ghJsonFn([
      "api",
      `repos/${repo}/issues/${issue}/comments?per_page=${perPage}&page=${page}`,
    ], []));
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) break;
    comments.push(...list);
    if (list.length < perPage) break;
  }

  return comments;
}

export async function checkControlPlaneBlocker({ repo = "", issue = 0, ghJsonFn = ghJson } = {}) {
  const issueNumber = Number.parseInt(String(issue || "0"), 10);
  if (!repo || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    return {
      error: "repo and issue are required",
      error_code: FACTORY_OPS_ERROR_CODES.missing_args,
    };
  }

  const issueView = await Promise.resolve(ghJsonFn([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "labels",
  ], {}));

  const labels = Array.isArray(issueView?.labels) ? issueView.labels : [];
  const comments = await fetchIssueComments({ repo, issue: issueNumber, ghJsonFn });
  const blocker = parseControlPlaneBlocker({ labels, comments });
  const labelPresent = hasBlockedControlPlaneLabel(labels);

  const hasBlockerSignal = Boolean(
    labelPresent
    || blocker?.status
    || blocker?.kind
    || blocker?.blockerRef
    || blocker?.unblockCondition,
  );

  if (!hasBlockerSignal) {
    return {
      blocker_active: false,
      status: null,
    };
  }

  if (isControlPlaneResolved(blocker)) {
    return {
      blocker_active: false,
      status: String(blocker.status || "").trim().toLowerCase() || null,
    };
  }

  return {
    blocker_active: true,
    kind: String(blocker.kind || ""),
    blockerRef: String(blocker.blockerRef || ""),
    unblockCondition: String(blocker.unblockCondition || ""),
    status: String(blocker.status || "blocked").trim().toLowerCase() || "blocked",
  };
}
