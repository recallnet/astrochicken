import { fileURLToPath } from "node:url";

import {
  extractHumanBlockerPayloadFromBody,
  parseHumanResponse,
} from "./human-blocker.ts";
import { detectStuckGoals } from "./supervisor-goal-liveness.ts";
import { detectReviewHarnessDegradation } from "./supervisor-review-harness-degradation.ts";
import { determineSupervisorGoalsToClose } from "./supervisor-sanitize-goals.ts";
import { appendCliCrashActionItems } from "./supervisor-snapshot-cli-crashes.ts";
import { appendProvisioningDriftActionItems } from "./supervisor-snapshot-provisioning-drift.ts";
import {
  hasLabel,
  asPositiveInt,
} from "./supervisor-state-collector.ts";
import { fetchIssueCommentsBatch } from "../lib/batched-github-queries.ts";
import { trim } from "../lib/cli-helpers.ts";
import { buildRemediationPacket } from "../lib/remediation-packet.ts";

const FACTORY_OPS_CLI_ENTRYPOINT = fileURLToPath(new URL("../cli.ts", import.meta.url));

export function appendSupervisorStateSnapshotActionItems({
  repo,
  normalizedTargetRepo,
  normalizedControlPlaneRepo,
  normalizedFactoryId,
  resolvedRunsDir,
  nowMs,
  features = [],
  orphanFeatures = [],
  closedGoalOwnedFeatures = [],
  mergeFollowupsMislabeled = [],
  openMergeFollowups = [],
  unlabeled = [],
  bugs = [],
  openHumanIssues = [],
  staleWaveGiveupBugs = [],
  staleTelemetry = [],
  openWaveReady = [],
  goalSubIssues = {},
  goals = [],
  ghJsonFn,
  ghPaginatedFn = () => [],
  appendActionItem,
  appendSynthesisActionItem,
  appendSynthesisActionItems,
  persistedPacketActionItems,
  persistedPacketByDedupeKey,
  snapshotErrors,
  recoverySweepFn,
  recoverySweepScope = {},
  scanCliCrashesFn,
  registryPath = "",
  skipRecoverySweep = false,
} = {}) {
  for (const o of orphanFeatures) {
    appendSynthesisActionItem({
      issue: o.number,
      title: o.title,
      problem: "feature has no parent goal (orphan)",
      remediation_packet: buildRemediationPacket({
        packetType: "orphan_feature_triage",
        intent: "Classify the feature and link it as a sub-issue of the appropriate goal.",
        inspectionCommands: [
          `gh issue view ${o.number} --repo ${repo} --json number,title,body,labels,milestone`,
          `gh issue list --repo ${repo} --state open --label goal --limit 50 --json number,title,body,labels`,
        ],
        executionCommands: [
          // @context:regression !critical Managed factory supervisor runs execute from the
          // target-repo checkout, not the control-plane repo root. Use the checked-in absolute
          // CLI entrypoint so orphan remediation stays executable regardless of cwd.
          `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor remediate-orphan-features --repo '${repo}'`,
        ],
        verifyCommands: [
          `gh issue view ${o.number} --repo ${repo} --json number,labels`,
        ],
        expectedPostconditions: [
          "feature issue is linked as a sub-issue of a goal",
          "feature issue classification is correct",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_root_cause", recheck_after: "next_tick" },
      }),
      suggested_action: "Determine which open goal this feature belongs to by matching title/content. If a matching goal exists, link the feature as a sub-issue. Only close if no parent goal can be identified after checking all open goals.",
    });
  }

  const staleOrphanRemediationGoals = determineSupervisorGoalsToClose({
    goals,
    orphanFeatures,
    allMilestones: [],
  }).filter((item) => {
    const matchingGoal = goals.find((goal) => String(goal?.number || "") === String(item.issue_number || ""));
    return String(matchingGoal?.title || "").startsWith("Goal: Supervisor Remediation — Orphan Features");
  });

  if (staleOrphanRemediationGoals.length > 0) {
    const goalNumbers = staleOrphanRemediationGoals.map((goal) => `#${goal.issue_number}`).join(", ");
    appendSynthesisActionItem({
      issue: Number(staleOrphanRemediationGoals[0]?.issue_number || 0),
      title: "Close superseded orphan-feature remediation goals",
      problem: `stale orphan-feature remediation goals remain open: ${goalNumbers}`,
      remediation_packet: buildRemediationPacket({
        packetType: "stale_supervisor_goal_cleanup",
        intent: "Close stale orphan-feature remediation goals so the supervisor only reasons over the current orphan signature.",
        inspectionCommands: staleOrphanRemediationGoals.map((goal) =>
          `gh issue view ${goal.issue_number} --repo ${repo} --json number,title,body,state,labels`),
        executionCommands: [
          // @context:regression !critical Stale orphan remediation goals are not harmless
          // backlog noise. They describe obsolete orphan sets and can re-inject bogus
          // supervisor review work, so the live healer must auto-run sanitize-goals.
          `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor sanitize-goals --repo '${repo}'`,
        ],
        verifyCommands: staleOrphanRemediationGoals.map((goal) =>
          `gh issue view ${goal.issue_number} --repo ${repo} --json number,state`),
        expectedPostconditions: [
          "superseded orphan-feature remediation goals are closed",
          "the current orphan-feature signature has at most one active remediation goal",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_root_cause", recheck_after: "next_tick" },
      }),
      suggested_action: `Close superseded remediation goals ${goalNumbers} so only the current orphan signature remains active.`,
    });
  }

  for (const feature of closedGoalOwnedFeatures) {
    const parentGoals = Array.isArray(feature.parent_goal_numbers) ? feature.parent_goal_numbers : [];
    const closedGoals = Array.isArray(feature.closed_goal_numbers) ? feature.closed_goal_numbers : [];
    const parentSummary = closedGoals.length > 0 ? closedGoals.join(", ") : parentGoals.join(", ");
    appendSynthesisActionItem({
      issue: feature.number,
      title: feature.title,
      problem: "feature remains open under a closed parent goal",
      remediation_packet: buildRemediationPacket({
        packetType: "closed_goal_feature_triage",
        intent: "Verify whether this open feature should be closed, reparented to a new follow-up goal, or whether the parent goal was closed prematurely.",
        inspectionCommands: [
          `gh issue view ${feature.number} --repo ${repo} --json number,title,body,labels,state`,
          ...parentGoals.map((goalNumber) => `gh issue view ${goalNumber} --repo ${repo} --json number,title,state,body,labels`),
        ],
        expectedPostconditions: [
          "feature is no longer treated as orphaned",
          "feature ownership under the closed goal is either resolved or explicitly reparented",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_root_cause", recheck_after: "next_tick" },
      }),
      suggested_action: `Check the closed parent goal(s) #${parentSummary}. If the feature is still valid work, explicitly reparent it to a new follow-up goal instead of treating it as orphaned.`,
    });
  }

  for (const m of mergeFollowupsMislabeled) {
    if (m.labels.includes("feature")) {
      appendSynthesisActionItem({
        issue: m.number,
        title: m.title,
        problem: "merge follow-up is mislabeled as 'feature'",
        remediation_packet: buildRemediationPacket({
          packetType: "relabel_merge_followup",
          intent: "Correct issue classification so merge follow-up work is not treated as executable feature work.",
          executionCommands: [
            `gh issue edit ${m.number} --repo ${repo} --remove-label feature --add-label merge-followup`,
          ],
          verifyCommands: [
            `gh issue view ${m.number} --repo ${repo} --json number,labels`,
          ],
          expectedPostconditions: [
            "issue no longer carries the feature label",
            "issue carries merge-followup label",
          ],
          retryPolicy: { max_attempts: 1, on_failure: "defer_with_evidence", recheck_after: "next_tick" },
        }),
        suggested_action: `gh issue edit ${m.number} --repo ${repo} --remove-label feature --add-label merge-followup`,
      });
    }
  }

  for (const mf of openMergeFollowups) {
    const affected = [...((mf.body.match(/Affected issues:\n((?:- #\d+.*\n?)+)/i) || ["", ""])[1].matchAll(/#(\d+)/g))].map((m) => m[1]);
    const ms = (mf.body.match(/Wave milestone:\s*(\S+)/i) || [])[1] || "";
    const branch = ms ? `wave/${ms}` : "";
    const inspectCmds = [`gh issue view ${mf.number} --repo ${repo} --json number,title,body,labels`, ...affected.map((n) => `gh issue view ${n} --repo ${repo} --json number,title,state,labels`)];
    if (branch) inspectCmds.push(`git branch --list '${branch}'`, `git merge-tree $(git merge-base main ${branch}) main ${branch} 2>&1 | head -5`);
    appendSynthesisActionItem({
      issue: mf.number, title: mf.title,
      problem: "open merge-followup needs triage — check if merge failure is real or already resolved. Execution branches are LOCAL worktree branches; absent from remote is normal. Check local branch existence first.",
      remediation_packet: buildRemediationPacket({
        packetType: "merge_followup_triage",
        intent: "If the execution branch exists locally and merges cleanly, or affected issues are closed, close the follow-up. Do not post observational comments — either close with a reason or defer silently.",
        inspectionCommands: inspectCmds,
        executionCommands: [`gh issue close ${mf.number} --repo ${repo} --comment \"Resolved: <reason>\"`],
        verifyCommands: [`gh issue view ${mf.number} --repo ${repo} --json state`],
        expectedPostconditions: ["merge-followup closed if non-actionable, or root-cause documented — no narration comments posted"],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_root_cause", recheck_after: "next_tick" },
      }),
      suggested_action: `Check if branch '${branch}' merges cleanly and if affected issues ${affected.map((n) => "#" + n).join(", ")} are closed. Close if resolved: gh issue close ${mf.number} --repo ${repo} --comment \"Resolved: <reason>\".`,
    });
  }

  for (const u of unlabeled) {
    appendSynthesisActionItem({
      issue: u.number,
      title: u.title,
      problem: "issue has no labels",
      remediation_packet: buildRemediationPacket({
        packetType: "unlabeled_issue_classification",
        intent: "Inspect the issue, classify it correctly, and attach it to the right factory workflow.",
        inspectionCommands: [
          `gh issue view ${u.number} --repo ${repo} --json number,title,body,labels,milestone`,
          `gh issue list --repo ${repo} --state open --label goal --limit 50 --json number,title,body,labels`,
        ],
        executionCommands: [
          `gh issue edit ${u.number} --repo ${repo} --add-label <goal|feature|bug|merge-followup>`,
        ],
        verifyCommands: [
          `gh issue view ${u.number} --repo ${repo} --json number,labels,milestone`,
        ],
        expectedPostconditions: [
          "issue has a correct type label",
          "feature issues are connected to a goal-aligned milestone when applicable",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_root_cause", recheck_after: "next_tick" },
      }),
      suggested_action: "Examine title/content to determine issue type. If it looks like a feature, add 'feature' label and link to the matching open goal as a sub-issue. If it's a bug, add 'bug' label. If it's a merge follow-up, add 'merge-followup' label. Only close if the issue is clearly stale and no parent goal can be identified.",
    });
  }

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const MAX_OLD_BUG_ACTION_ITEMS = 3;
  const staleBugs = bugs
    .map((b) => ({ ...b, __createdMs: Date.parse(String(b.createdAt || "")) }))
    .filter((b) => Number.isFinite(b.__createdMs) && ((nowMs - b.__createdMs) > ONE_HOUR_MS))
    .sort((a, b) => b.__createdMs - a.__createdMs)
    .slice(0, MAX_OLD_BUG_ACTION_ITEMS);
  for (const b of staleBugs) {
    appendSynthesisActionItem({
      issue: b.number,
      title: b.title,
      problem: "open bug older than 1 hour — verify if still reproducible",
      remediation_packet: buildRemediationPacket({
        packetType: "stale_bug_recheck",
        intent: "Re-verify stale bug status and close only if the condition is actually resolved.",
        inspectionCommands: [
          `gh issue view ${b.number} --repo ${repo} --json number,title,body,comments`,
        ],
        executionCommands: [
          `gh issue close ${b.number} --repo ${repo} --comment 'Condition resolved.'`,
        ],
        verifyCommands: [
          `gh issue view ${b.number} --repo ${repo} --json state`,
        ],
        expectedPostconditions: [
          "bug is confirmed still open with fresh evidence or closed with a resolution comment",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_repro_gap", recheck_after: "next_tick" },
      }),
      suggested_action: `gh issue view ${b.number} --repo ${repo} ; if resolved then gh issue close ${b.number} --repo ${repo} --comment 'Condition resolved.'`,
    });
  }

  // Batch-fetch comments for all human issues: 1 GraphQL call replaces N individual lookups.
  const humanIssueSlice = openHumanIssues.slice(0, 20);
  const humanIssueNumbers = humanIssueSlice
    .map((h) => asPositiveInt(h?.number))
    .filter((n) => n > 0);
  const humanCommentsMap = fetchIssueCommentsBatch({
    repo,
    issueNumbers: humanIssueNumbers,
    ghJsonFn,
  });

  for (const human of humanIssueSlice) {
    const issueNumber = asPositiveInt(human?.number);
    if (issueNumber <= 0) continue;
    const extracted = extractHumanBlockerPayloadFromBody(String(human?.body || ""));
    if (!extracted?.payload) continue;
    const payload = extracted.payload;
    const blockedIssueNumber = asPositiveInt(payload?.source_issue_number);
    const goalIssueNumber = asPositiveInt(payload?.goal_issue_number);
    const commentsData = humanCommentsMap.get(issueNumber) || { comments: [] };
    const response = parseHumanResponse(commentsData.comments || []);
    const responseStatus = trim(response?.status || "");
    appendSynthesisActionItem({
      issue: issueNumber,
      title: String(human?.title || ""),
      problem: `HUMAN_BLOCKER_OPEN: human blocker #${issueNumber}${blockedIssueNumber > 0 ? ` is blocking issue #${blockedIssueNumber}` : ""}.`,
      diagnostics: {
        blocker_kind: trim(payload?.blocker_kind || ""),
        exact_request: trim(payload?.exact_request || ""),
        why_blocked: trim(payload?.why_blocked || ""),
        unblock_condition: trim(payload?.unblock_condition || ""),
        owner_hint: trim(payload?.owner_hint || ""),
        source_issue_number: blockedIssueNumber,
        goal_issue_number: goalIssueNumber,
        response_status: responseStatus,
        response_decision_input: trim(response?.decision_input || ""),
      },
      remediation_packet: buildRemediationPacket({
        packetType: "human_blocker_recheck",
        intent: "Re-check whether the supervisor can resolve this blocker without the human. If the human has already responded or the blocker is no longer real, close the human issue and resume the blocked work.",
        inspectionCommands: [
          `gh issue view ${issueNumber} --repo ${repo} --json number,title,body,comments,state,labels`,
          blockedIssueNumber > 0 ? `gh issue view ${blockedIssueNumber} --repo ${repo} --json number,title,body,state,labels,milestone` : "",
          goalIssueNumber > 0 ? `gh issue view ${goalIssueNumber} --repo ${repo} --json number,title,body,state,labels,milestone` : "",
        ].filter(Boolean),
        executionCommands: [
          `gh issue close ${issueNumber} --repo ${repo} --comment 'Supervisor resolved or accepted the human blocker outcome; unblocking dependent work.'`,
        ],
        expectedPostconditions: [
          "either the human blocker remains open with a still-valid exact request, or it is closed because supervisor/human resolved the blocker",
          "blocked work can resume automatically once the human blocker closes",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_blocker_evidence", recheck_after: "next_tick" },
      }),
      suggested_action: `Defer by default, but first re-review human blocker #${issueNumber} against live repo/GitHub state. If the blocker can now be resolved without human input, resolve it and close the human issue. If a human response comment has already satisfied or rejected the request, apply that outcome now. Only keep the issue open while the exact missing credential, owner decision, or external input is still genuinely human-owned.`,
    });
  }

  const MAX_STALE_WAVE_GIVEUP_ACTION_ITEMS = 3;
  const staleWaveGiveupToClose = staleWaveGiveupBugs
    .map((b) => ({ ...b, __createdMs: Date.parse(String(b.createdAt || "")) }))
    .sort((a, b) => (Number.isFinite(b.__createdMs) ? b.__createdMs : 0) - (Number.isFinite(a.__createdMs) ? a.__createdMs : 0))
    .slice(0, MAX_STALE_WAVE_GIVEUP_ACTION_ITEMS);
  for (const b of staleWaveGiveupToClose) {
    appendSynthesisActionItem({
      issue: b.number,
      title: b.title,
      problem: `stale wave give-up bug reopened while source issue #${b.source_issue_number} is closed`,
      remediation_packet: buildRemediationPacket({
        packetType: "close_stale_wave_giveup_bug",
        intent: "Close stale wave give-up bugs when their source issue is already closed.",
        executionCommands: [
          `gh issue close ${b.number} --repo ${repo} --comment 'Source issue #${b.source_issue_number} is closed; suppressing stale reopen-loop bug.'`,
        ],
        verifyCommands: [
          `gh issue view ${b.number} --repo ${repo} --json state`,
        ],
        expectedPostconditions: [
          "stale reopen-loop bug is closed",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_state_conflict", recheck_after: "next_tick" },
      }),
      suggested_action: `gh issue close ${b.number} --repo ${repo} --comment 'Source issue #${b.source_issue_number} is closed; suppressing stale reopen-loop bug.'`,
    });
  }

  const rawMilestones = goals.length > 0
    ? ghPaginatedFn(`repos/${repo}/milestones?state=all&per_page=100`, [])
    : [];
  const allMilestones = (Array.isArray(rawMilestones) ? rawMilestones : []).map((m) => ({ title: m.title, state: m.state }));
  appendSynthesisActionItems(detectStuckGoals({ goals, features, milestones: allMilestones, goalSubIssues }));

  const recovery = skipRecoverySweep
    ? {}
    : (recoverySweepFn({
      runsDir: resolvedRunsDir,
      repoPath: trim(recoverySweepScope?.repoPath),
      staleMinutes: 20,
      apply: false,
      skipWorktreeScan: recoverySweepScope?.skipWorktreeScan === true,
    }) || {});
  const staleRunsRaw = Array.isArray(recovery.stale_runs) ? recovery.stale_runs : [];
  const staleRuns = staleRunsRaw.filter((s) => {
    const p = String(s?.pipeline || "");
    // Skip ephemeral test pipelines — /tmp/, /var/folders/, OS temp dirs.
    // These are integration test artifacts, not real factory work.
    return p && !p.startsWith("/tmp/") && !p.startsWith("/var/folders/") && !p.startsWith("/private/tmp/");
  });
  for (const stale of staleRuns.slice(0, 10)) {
    const reason = String(stale.reason || "stale_run_record");
    const runId = String(stale.runId || stale.run_id || "");
    const pipeline = String(stale.pipeline || "");
    const node = String(stale.currentNode || stale.current_node || "");
    const age = Number(stale.ageSeconds || stale.age_seconds || 0);
    appendSynthesisActionItem({
      problem: `RUN_LIVENESS_INCIDENT: run ${runId} appears stale (reason=${reason}, age_seconds=${age}, node=${node}, pipeline=${pipeline}).`,
      diagnostics: {
        classification_candidates: ["infra_liveness", "factory_design_heartbeat", "state_observability"],
        diagnostic_questions: [
          "Is the run process actually alive?",
          "Did heartbeat stop because process died or because heartbeat contract drifted?",
          "Is reason telemetry preserving original failure cause?",
        ],
      },
      possible_resolutions: [
        { when: "reason=pid_dead", resolution: "Treat as infra crash and re-queue goal execution; do not misclassify as feature failure." },
        { when: "reason=stale_run_record", resolution: "Inspect heartbeat/stale-threshold contract before terminalization." },
        { when: "reason=queued_ttl_exceeded|suspended_ttl_exceeded|guarded_ttl_exceeded", resolution: "Inspect scheduler/guard ownership and unblock deterministically." },
      ],
      remediation_packet: buildRemediationPacket({
        packetType: "run_liveness_recovery",
        intent: "Clean up stale runtime ownership and let the supervisor continue from durable GitHub state.",
        executionCommands: [
          `node packages/factory-ops/src/cli.ts factory recovery-sweep --runs-dir '${resolvedRunsDir}' --stale-minutes '20' --apply 'true'`,
        ],
        verifyCommands: [
          "hatch-ops factory status --json",
          "hatch-ops factory tick-status",
        ],
        expectedPostconditions: [
          "stale run ownership is cleared or reconciled",
          "next supervisor tick can reclaim work from durable GitHub state",
        ],
        retryPolicy: { max_attempts: 1, on_failure: "defer_with_runtime_diagnostics", recheck_after: "next_tick" },
      }),
      suggested_action: `Run: node packages/factory-ops/src/cli.ts factory recovery-sweep --runs-dir '${resolvedRunsDir}' --stale-minutes '20' --apply 'true'`,
    });
  }

  const cliCrashes = appendCliCrashActionItems({
    scanCliCrashesFn,
    resolvedRunsDir,
    nowMs,
    normalizedFactoryId,
    normalizedTargetRepo,
    normalizedControlPlaneRepo,
    repo,
    appendActionItem,
    appendSynthesisActionItem,
    persistedPacketActionItems,
    persistedPacketByDedupeKey,
    snapshotErrors,
  });

  appendProvisioningDriftActionItems({
    normalizedFactoryId,
    repo,
    registryPath,
    appendActionItem,
    snapshotErrors,
  });

  const reviewHarnessDegradationItem = detectReviewHarnessDegradation({
    factoryId: normalizedFactoryId,
    runsDir: resolvedRunsDir,
  });
  if (reviewHarnessDegradationItem) {
    appendActionItem(reviewHarnessDegradationItem);
  }

  return {
    staleRuns,
    cliCrashes,
  };
}
