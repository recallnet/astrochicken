import { join } from "node:path";

import {
  excerpt,
  findLatestSessionLog,
  listRunIds,
  parseJson,
  readRunState,
  readSessionTail,
  selectTargetRun,
} from "../lib/factory-session-log.ts";

function extractLastReview(state) {
  const records = Array.isArray(state?.records) ? state.records : [];
  for (let i = records.length - 1; i >= 0; i--) {
    const row = records[i];
    if (row?.nodeId !== "review") continue;
    const raw = row?.outcome?.output;
    const parsed = parseJson(String(raw || ""), null);
    if (parsed && typeof parsed === "object") return parsed;
    return { raw: excerpt(raw || "", 400) };
  }
  return null;
}

export function factoryAgentTrace({ runsDir = ".hatch/runs", runId = "", maxItems = 3 } = {}) {
  const states = listRunIds(runsDir)
    .map((id) => readRunState(runsDir, id))
    .filter(Boolean);
  const targetRunId = selectTargetRun(states, runId);
  if (!targetRunId) return { ok: false, error: "no_runs_found" };
  const state = states.find((s) => s?.runId === targetRunId) || readRunState(runsDir, targetRunId);
  if (!state) return { ok: false, error: "run_not_found", run_id: targetRunId };

  const sessionPath = findLatestSessionLog(state, {
    runSessionsDir: join(runsDir, targetRunId, "sessions"),
  });
  const sessionTail = readSessionTail(sessionPath, Math.max(1, Number(maxItems) || 3));

  const completedNodes = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  const recentNodes = completedNodes.slice(-3).map((node) => ({ id: node.id, completed_at: node.completedAt || "" }));

  const context = state.context || {};
  return {
    ok: true,
    run_id: state.runId,
    pipeline: state.pipelineFile || state.pipeline || "",
    status: state.status || "",
    current_node: state.currentNode || "",
    issue_number: context.issue_number || context.next_issue_number || "",
    issue_title: context.issue_title || context.next_issue_title || "",
    branch: context.branch || "",
    review_attempt: context.review_attempt || "",
    latest_assistant_text: sessionTail.latestAssistantText,
    last_tool_calls: sessionTail.toolCalls,
    last_tool_results: sessionTail.toolResults,
    last_review_result: extractLastReview(state),
    recent_nodes: recentNodes,
    session_log: sessionPath,
  };
}
