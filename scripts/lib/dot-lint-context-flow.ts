const CONTEXT_FLOW_SEED_KEYS = Object.freeze(["__run_id", "__run_sessions_dir", "outcome", "date", "repo", "factory_id", "factory_root", "target_repo", "target_repo", "control_plane_repo", "gh_repo", "source_repos", "kind_id", "instance_id", "trust_domain", "trust_role", "window_start", "window_end", "output_dir", "runs_dir", "repo_path", "issue_labels_json", "notify_slack", "scheduled_at", "scheduled_local_date", "scheduled_job_id", "scheduled_job_type", "report_window_hours", "intake_json", "goal_issue_number", "goal_execution_mode", "goal_execution_paths", "review_cooldown_hours", "review_quarantine_threshold", "integration_command", "review_qa_command", "stalled_wave_minutes", "stale_run_minutes", "scenarios_root", "resolution_check", "capability_coding_skills", "capability_merge_skills", "agent_session_id", "branch", "worktree_dir", "execution_mode", "reviewer_session_id", "next_issue_number", "next_issue_title", "max_review_attempts", "review_evidence_path", "milestone_title", "max_parallel_low", "milestone_parallel_low_enabled", "parallel_issue", "feature", "brainstorm_issue_number", "merge_candidates", "state_snapshot", "run_id", "review_notes", "goal_issues_b64", "brainstorm_issue_body", "intent_stack", "capability_goal_decomposition_skills", "goal_context", "goal_issue", "max_concurrent_waves", "factory_tracking_issue_number", "approved_features", "has_issue", "selected_issue_number", "capability_brainstorming_skills", "decisions_b64", "goal_execution_path", "goal_routing_state", "planning_state", "release_report_issue_url", "judge_scenario_selector", "destinations_json", "instance_path", "kind_path", "has_action_items", "__composite_reason", "scenario_brief", "shipped_goals_since_last", "scenario_holdouts", "open_backlog_summary", "issue_item", "merge_item", "merge_results", "release_reporting_repo", "goal_execution_path_version", "goal_execution_path_packet_id", "LANGFUSE_PROJECT_URL"]);
const CONTEXT_FLOW_PLACEHOLDER_ATTR_KEY_HINTS = Object.freeze(["prompt", "message", "template", "path", "repo", "issue", "notes", "args", "command", "key", "value"]);
const TERMINAL_CONTRACT_OUTPUT_KEYS = new Set(["approved_features", "artifact_ingest_result", "close_milestone_status", "domain_result", "echo_output", "executable_goal_count", "executable_goals_capped", "goal_issues", "goal_terminal_path", "impl_result", "issue_urls", "managed_run_summary", "merge_result", "mutation_attempt", "open_followup_status", "release_reporting_factory_id", "release_shaping_followup_delivery", "release_slack_delivery", "scenario_path"]);

export { CONTEXT_FLOW_SEED_KEYS };

export function shouldInspectNodeAttrForPlaceholders(attrKey, placeholderAttrKeys) {
  const normalized = String(attrKey || "").trim().toLowerCase();
  if (!normalized) return false;
  if (placeholderAttrKeys.has(normalized)) return true;
  if (normalized.startsWith("action_")) return true;
  return CONTEXT_FLOW_PLACEHOLDER_ATTR_KEY_HINTS.some((token) => normalized.includes(token));
}

export function extractTemplatePlaceholders(input) {
  const text = String(input || "");
  const keys = new Set();
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "$" || text[index + 1] !== "{") continue;
    const closeIndex = text.indexOf("}", index + 2);
    if (closeIndex < 0) break;
    const raw = text.substring(index + 2, closeIndex).trim();
    if (raw && !raw.includes("${") && !raw.includes("}") && /^[A-Za-z0-9_.:/-]+$/.test(raw)) keys.add(raw);
    index = closeIndex;
  }
  return [...keys].sort((left, right) => left.localeCompare(right, "en"));
}

export function extractContextKeysList(input) {
  return [...new Set(String(input || "").split(",").map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "en"));
}

export function extractConditionKeys(conditionText) {
  const text = String(conditionText || "").trim();
  if (!text) return [];
  const operators = [">=", "<=", "!=", ">", "<", "="];
  const keys = new Set();
  for (const clauseRaw of text.split("&&")) {
    const clause = clauseRaw.trim();
    if (!clause) continue;
    let matched = false;
    for (const op of operators) {
      const index = clause.indexOf(op);
      if (index < 0) continue;
      const key = clause.substring(0, index).trim();
      if (key) keys.add(key);
      matched = true;
      break;
    }
    if (!matched) keys.add(clause);
  }
  return [...keys].sort((left, right) => left.localeCompare(right, "en"));
}

export function splitCommaSeparated(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function isReceiptOnlyOutputKey(value) {
  return /^__[\w.-]+_result$/.test(String(value || "").trim());
}

export function isResolveDefaultSelfBootstrapReference({ nodeMeta, attrName, key }) {
  const normalizedAttr = String(attrName || "").trim().toLowerCase();
  if (normalizedAttr !== "action_value" && normalizedAttr !== "source_key") return false;
  return String(nodeMeta?.outputKey || "").trim() === String(key || "").trim();
}

export function isSeedNormalizationOutput(nodeMeta) {
  const outputKey = String(nodeMeta?.outputKey || "").trim();
  if (!outputKey) return false;
  const actionId = String(nodeMeta?.attrs?.action_id || "").trim();
  if (/^common\.resolve_capability_[\w.-]+_path$/.test(actionId) && /^capability_[\w.-]+_skills$/.test(outputKey)) return true;
  if (!CONTEXT_FLOW_SEED_KEYS.includes(outputKey)) return false;
  return actionId === "common.resolve_default" || actionId === "common.resolve_factory_config";
}

export function isEmitterReceiptOutput(nodeMeta) {
  const actionId = String(nodeMeta?.attrs?.action_id || "").trim();
  return actionId.includes(".emit_") || actionId.includes(".send_");
}

export function isTerminalContractOutput({ outputKey, reachable, graphNodes, resolveNodeHandlerType }) {
  if (!TERMINAL_CONTRACT_OUTPUT_KEYS.has(String(outputKey || "").trim())) return false;
  if (!(reachable instanceof Set) || !graphNodes) return false;
  for (const nodeId of reachable) {
    const attrs = graphNodes[nodeId]?.attrs || {};
    if (resolveNodeHandlerType(attrs) === "exit") return true;
  }
  return false;
}

export function hasConsumedStructuredOutputs({ nodeMeta, consumedReferences, reachable }) {
  const outputKeys = splitCommaSeparated(nodeMeta?.attrs?.outputs);
  if (outputKeys.length === 0) return false;
  for (const outputKey of outputKeys) {
    for (const reference of consumedReferences) {
      if (reference.key !== outputKey) continue;
      if (reference.kind === "node_attr") {
        if (reference.nodeId !== nodeMeta.nodeId && reachable.has(reference.nodeId)) return true;
        continue;
      }
      if (reachable.has(reference.edgeFrom)) return true;
    }
  }
  return false;
}

export function collectProducedKeys(attrs) {
  const keys = new Set();
  const outputKey = String(attrs?.output_key || "").trim();
  if (outputKey) keys.add(outputKey);
  for (const key of splitCommaSeparated(attrs?.outputs)) keys.add(key);
  for (const key of splitCommaSeparated(attrs?.output_keys)) keys.add(key);
  for (const key of splitCommaSeparated(attrs?.export_keys)) keys.add(key);
  return keys;
}
