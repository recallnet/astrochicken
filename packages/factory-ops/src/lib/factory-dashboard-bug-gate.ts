import { trim } from "./cli-helpers.ts";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSupervisorGraph(graph = "") {
  const label = trim(graph || "");
  return label.endsWith("factory_supervisor_tick.dot")
    || label.endsWith("managed_supervisor.dot")
    || label === "factory_supervisor_tick.dot"
    || label === "managed_supervisor.dot";
}

function normalizeBlockerList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const blockerKind = trim(item?.blockerKind || item?.kind || "");
      const blockerRef = trim(item?.blockerRef || "");
      const linkedGoalNumber = toNumber(item?.linked_goal_number || item?.issue_number, 0);
      const unblockCondition = trim(item?.unblockCondition || "");
      if (!blockerKind && !blockerRef && linkedGoalNumber <= 0 && !unblockCondition) return null;
      return {
        blockerKind,
        blockerRef,
        linkedGoalNumber,
        unblockCondition,
      };
    })
    .filter(Boolean);
}

export function resolveBugGateSummary({ status = {}, tick = {}, summary = {} } = {}) {
  const activeRuns = Array.isArray(status.active) ? status.active : [];
  const runningTick = Array.isArray(tick.ticks)
    ? tick.ticks.find((entry) => trim(entry?.status || "").toLowerCase() === "running")
    : null;
  const supervisorRun = activeRuns.find((row) => isSupervisorGraph(row.graph || row.graph_label));
  const supervisorSummary = (Array.isArray(summary.non_wave_active) ? summary.non_wave_active : [])
    .find((row) => isSupervisorGraph(row.graph || row.graph_label));
  const childNodes = [
    ...(Array.isArray(supervisorRun?.children) ? supervisorRun.children : []),
    ...(Array.isArray(supervisorRun?.active_children) ? supervisorRun.active_children : []),
  ]
    .map((child) => trim(child?.current_node || child?.node || ""))
    .filter(Boolean);
  const stageCandidates = [
    trim(runningTick?.stage || ""),
    trim(runningTick?.stageLabel || ""),
    trim(supervisorRun?.node || supervisorRun?.current_node || ""),
    trim(supervisorSummary?.node || supervisorSummary?.current_node || ""),
    ...childNodes,
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);
  const bugFastActive = stageCandidates.some((value) => value.includes("bug_fast"));
  const blockers = normalizeBlockerList([
    ...(Array.isArray(runningTick?.blocked_control_plane) ? runningTick.blocked_control_plane : []),
    ...(Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane : []),
    ...(Array.isArray(summary.blocked_control_plane) ? summary.blocked_control_plane : []),
  ]);
  const openBugRefs = [...new Set(
    blockers
      .map((item) => trim(item.blockerRef || (item.linkedGoalNumber > 0 ? `#${item.linkedGoalNumber}` : "")))
      .filter(Boolean),
  )];
  return {
    active: bugFastActive,
    mode: bugFastActive ? "bug-fast" : "normal",
    admission: bugFastActive ? "paused_for_bug_review" : "ready",
    open_bug_count: openBugRefs.length,
    open_bug_refs: openBugRefs,
    blockers,
  };
}
