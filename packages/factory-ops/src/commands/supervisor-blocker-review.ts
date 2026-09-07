import {
  extractBlockerRefIssueNumber,
  isControlPlaneResolved,
  parseControlPlaneBlocker,
} from "../lib/control-plane-blocker.ts";
import { isDurablePacketType } from "../lib/packet-core.ts";
import { buildRemediationPacket } from "../lib/remediation-packet.ts";

// TODO(F-1): persist control_plane_blocker_review via persistRemediationPacket when registry promotes it to durable.
const CONTROL_PLANE_BLOCKER_REVIEW_IS_DURABLE = isDurablePacketType("control_plane_blocker_review");
void CONTROL_PLANE_BLOCKER_REVIEW_IS_DURABLE;

// ---------------------------------------------------------------------------
// Control-plane blocker action items for supervisor state snapshot
// ---------------------------------------------------------------------------

const GENERIC_UNBLOCK_PATTERNS = [
  /^$/,
  /^wait for control-plane blocker status to change\.?$/i,
  /^install or publish release floor .+\.$/i,
  /^wait for upstream bug .+ to close\.$/i,
];

function isInvalidUnblockCondition(condition = "") {
  const trimmed = String(condition || "").trim();
  return GENERIC_UNBLOCK_PATTERNS.some((re) => re.test(trimmed));
}

export function buildControlPlaneBlockerActionItems({ features = [], repo = "", ghJsonFn } = {}) {
  const MAX_BLOCKER_ITEMS = 10;
  const actionItems = [];
  const summary = [];

  const blockedFeatures = (Array.isArray(features) ? features : [])
    .filter((f) => {
      const labels = (Array.isArray(f?.labels) ? f.labels : [])
        .map((l) => String(l?.name || "").trim());
      return labels.includes("blocked-control-plane");
    })
    .slice(0, MAX_BLOCKER_ITEMS);

  for (const feature of blockedFeatures) {
    const issueNumber = Number(feature?.number || 0);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;

    const comments = typeof ghJsonFn === "function"
      ? ghJsonFn(["api", `repos/${repo}/issues/${issueNumber}/comments?per_page=100`]) || []
      : [];

    const blocker = parseControlPlaneBlocker({
      ...feature,
      comments: Array.isArray(comments) ? comments : [],
    });

    // Skip already-resolved blockers (status = resumed/rejected/superseded).
    if (isControlPlaneResolved(blocker)) continue;

    const title = String(feature?.title || "");
    const milestone = String(feature?.milestone?.title || "");
    const kind = blocker.kind || "unknown";
    const blockerRef = blocker.blockerRef || "";
    const rawUnblockCondition = String(blocker.unblockCondition || "").trim();
    const unblockCondition = isInvalidUnblockCondition(rawUnblockCondition) ? "" : rawUnblockCondition;
    const invalidUnblock = isInvalidUnblockCondition(rawUnblockCondition);

    const blockerRefIssueNumber = extractBlockerRefIssueNumber(blocker);
    const inspectionCommands = [
      `gh issue view ${issueNumber} --repo ${repo} --json number,title,body,comments,labels,milestone`,
    ];
    if (blockerRefIssueNumber) {
      inspectionCommands.push(`gh issue view ${blockerRefIssueNumber} --repo ${repo} --json state`);
    }

    actionItems.push({
      issue: issueNumber,
      title,
      problem: `CONTROL_PLANE_BLOCKER_ACTIVE: #${issueNumber} "${title}" blocked on ${kind} ${blockerRef || "(no ref)"}`,
      diagnostics: {
        blocker_kind: kind,
        blockerRef,
        unblockCondition,
        invalid_unblock_condition: invalidUnblock,
        status: blocker.status || "blocked",
        milestone,
      },
      remediation_packet: buildRemediationPacket({
        packetType: "control_plane_blocker_review",
        intent: invalidUnblock
          ? "Blocker has no concrete unblock condition and cannot be evaluated. Post status=resumed to unblock the issue."
          : "Evaluate whether the control-plane blocker's unblock condition has been met. If met, post status=resumed.",
        inspectionCommands,
        executionCommands: [
          `gh issue comment ${issueNumber} --repo ${repo} --body 'control_plane_blocker.v1:${JSON.stringify({ status: "resumed", kind, blockerRef, unblockCondition: "Supervisor determined condition met or blocker invalid." })}'`,
          `gh issue edit ${issueNumber} --repo ${repo} --remove-label blocked-control-plane`,
        ],
        verifyCommands: [
          `gh issue view ${issueNumber} --repo ${repo} --json labels,comments`,
        ],
        expectedPostconditions: [
          "issue no longer carries blocked-control-plane label",
          "a control_plane_blocker.v1 comment with status=resumed exists",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_blocker_evidence", recheck_after: "next_tick" },
      }),
      ownership_decision: "local_fix",
      ownership_reason: invalidUnblock
        ? "blocker has no concrete unblock condition — supervisor should auto-resume"
        : "supervisor should evaluate unblock condition and resume if met",
    });

    summary.push({
      issue_number: issueNumber,
      title,
      milestone,
      blocker_kind: kind,
      blockerRef,
      unblockCondition,
      invalid_unblock_condition: invalidUnblock,
    });
  }

  return { actionItems, summary };
}
