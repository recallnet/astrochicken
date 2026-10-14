import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot";
const goalRunDotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot";
const waveIssueExecuteDotPath = "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot";
const waveExecuteDotPath = "docs/contracts/workflow-ir/mothership/goal_execute.dot";
const GOAL_RUN_IRREVERSIBLE_TYPED_ACTION_MARKERS = [
  'action_id="goal.persist_decomposition_packet"',
  'action_id="goal.materialize_approved_plan"',
];
void GOAL_RUN_IRREVERSIBLE_TYPED_ACTION_MARKERS;

function parseDotNodes(dot = "") {
  const text = String(dot || "");
  const nodes = new Map();
  const startRegex = /^\s*([A-Za-z0-9_]+)\s*\[/gm;

  for (const match of text.matchAll(startRegex)) {
    const nodeId = match[1];
    const startIdx = match.index + match[0].lastIndexOf("[");
    let i = startIdx + 1;
    let inDouble = false;
    let escaped = false;

    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inDouble && ch === "]") {
        break;
      }
    }

    if (i >= text.length) continue;

    const raw = text.slice(match.index, i + 1);

    let prompt = "";
    const promptStart = raw.indexOf('prompt="');
    if (promptStart >= 0) {
      let j = promptStart + 'prompt="'.length;
      let escapedPrompt = false;
      for (; j < raw.length; j += 1) {
        const ch = raw[j];
        if (escapedPrompt) {
          escapedPrompt = false;
          continue;
        }
        if (ch === "\\") {
          escapedPrompt = true;
          continue;
        }
        if (ch === '"') {
          break;
        }
      }
      prompt = raw.slice(promptStart + 'prompt="'.length, j);
    }

    nodes.set(nodeId, {
      id: nodeId,
      raw,
      prompt,
    });
  }

  return nodes;
}

// @context:regression Canonical DOT rendering may compress multiple edges into a chain.
function parseDotEdges(dot = "") {
  const edges = [];
  for (const match of String(dot).matchAll(/^\s*([A-Za-z0-9_]+(?:\s*->\s*[A-Za-z0-9_]+)+)/gm)) {
    const nodes = match[1].split(/\s*->\s*/);
    for (let i = 1; i < nodes.length; i += 1) edges.push([nodes[i - 1], nodes[i]]);
  }
  return edges;
}

function buildAdjacency(edges = []) {
  const forward = new Map();
  const reverse = new Map();

  for (const [from, to] of edges) {
    if (!forward.has(from)) forward.set(from, new Set());
    if (!reverse.has(to)) reverse.set(to, new Set());
    forward.get(from).add(to);
    reverse.get(to).add(from);
  }

  return { forward, reverse };
}

function hasPath(graph = new Map(), start = "", target = "", maxDepth = 30) {
  if (!start || !target) return false;
  if (start === target) return true;

  const visited = new Set([start]);
  const queue = [{ node: start, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const nextNodes = graph.get(node);
    if (!nextNodes) continue;
    for (const next of nextNodes) {
      if (next === target) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ node: next, depth: depth + 1 });
    }
  }

  return false;
}

function hasBranchLink({ helperNodeId = "", signalNodeId = "", forward = new Map(), reverse = new Map() } = {}) {
  return hasPath(forward, helperNodeId, signalNodeId) || hasPath(reverse, helperNodeId, signalNodeId);
}

test("decompose extracts approval/attempt normalization into typed in-process helpers", () => {
  const dot = readFileSync(dotPath, "utf8");
  const nodes = parseDotNodes(dot);
  assert.match(dot, /typed_action_transport_mode = "enforced"/);
  assert.match(dot, /load_intent_stack/);
  assert.match(String(nodes.get("load_intent_stack")?.raw || ""), /action_id="common\.resolve_intent_stack"/);
  assert.match(dot, /Intent stack JSON:/);
  assert.match(String(nodes.get("resolve_decompose_auto_approve")?.raw || ""), /action_id="common\.resolve_boolean"/);
  assert.match(String(nodes.get("normalize_approved")?.raw || ""), /action_id="common\.normalize_approved"/);
  assert.match(String(nodes.get("inc_attempts")?.raw || ""), /action_id="common\.increment_counter"/);
});

test("decompose fallback prefers reviewed features and emits fallback defect telemetry before bootstrap paths", () => {
  const dot = readFileSync(dotPath, "utf8");
  const nodes = parseDotNodes(dot);
  assert.match(String(nodes.get("inspect_fallback")?.raw || ""), /action_id="common\.inspect_json_pair"/);
  assert.match(String(nodes.get("inspect_approved")?.raw || ""), /action_id="common\.inspect_json_pair"/);
  assert.match(String(nodes.get("emit_retry_fallback_defect")?.raw || ""), /action_id="goal\.emit_fallback_defect"/);
  assert.match(String(nodes.get("emit_retry_fallback_defect")?.raw || ""), /action_trigger_reason="decompose_retry_exhausted"/);
  assert.match(String(nodes.get("fallback")?.raw || ""), /action_id="goal\.fallback_feature_pair"/);
  assert.match(String(nodes.get("normalize_features")?.raw || ""), /action_id="goal\.normalize_approved_features"/);
  assert.match(String(nodes.get("normalize_features")?.raw || ""), /action_goal_number="\$\{issue_number\}"/);
  assert.doesNotMatch(dot, /goal (run --op )?build-fallback-features/);
  assert.match(dot, /inspect_fallback -> emit_retry_fallback_defect \[input_key="goal_issue"\]/);
  assert.match(dot, /emit_retry_fallback_defect -> fallback \[input_key="goal_issue"\]/);
  assert.match(dot, /fallback -> normalize_features \[input_key="goal_issue"\]/);
  assert.match(dot, /inspect_approved -> normalize_features \[input_key="goal_issue"\]/);
  assert.match(dot, /normalize_features\s*->\s*done/);
});

test("decompose retry fallback defect emission locks canonical trigger reason", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /emit_retry_fallback_defect\s*\[/);
  assert.match(dot, /emit_retry_fallback_defect[\s\S]*action_trigger_reason="decompose_retry_exhausted"/);
});

test("decompose normalization routes approved features through the typed normalization owner", () => {
  const dot = readFileSync(dotPath, "utf8");
  const nodes = parseDotNodes(dot);
  const normalizeFeaturesNode = String(nodes.get("normalize_features")?.raw || "");

  assert.match(normalizeFeaturesNode, /action_id="goal\.normalize_approved_features"/);
  assert.match(normalizeFeaturesNode, /action_approved_features="\$\{approved_features\}"/);
  assert.match(normalizeFeaturesNode, /action_goal_number="\$\{issue_number\}"/);
  assert.match(normalizeFeaturesNode, /action_goal_issue_json="\$\{goal_issue\}"/);
  assert.doesNotMatch(normalizeFeaturesNode, /build-fallback-features/);
});

test("decompose fallback normalization passes issue_number hint on the deterministic normalize branch", () => {
  const dot = readFileSync(dotPath, "utf8");
  const normalizeNode = dot.match(/normalize_features\s*\[[\s\S]*?\]/)?.[0] || "";
  assert.match(normalizeNode, /action_goal_number="\$\{issue_number\}"/);
});

test("decompose initializes parse diagnostics deterministically", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /init_parse_diagnostics[\s\S]*decompose_parse_status/);
  assert.match(dot, /init_parse_diagnostics[\s\S]*decompose_parse_source/);
  assert.match(dot, /not_inspected/);
});

test("decompose supports complexity-floor auto-approve with conservative fallback", () => {
  const dot = readFileSync(dotPath, "utf8");
  const proposeTaskPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/propose.md", "utf8");
  const reviewTaskPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/review.md", "utf8");
  const analyzeTaskPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/analyze.md", "utf8");

  assert.match(dot, /resolve_decompose_auto_approve[\s\S]*action_id="common\.resolve_boolean"/);
  assert.match(dot, /inspect_proposed_features[\s\S]*action_id="common\.count_feature_objects"/);
  assert.match(dot, /assess_decompose_auto_approve[\s\S]*outputs="skip,auto_approve,approved,approved_features,factory_request_goal_graph,review_notes,reason,decompose_complexity,hatch_ceremony_pipeline,hatch_ceremony_skipped,hatch_ceremony_skip_reason,hatch_ceremony_reason"/);
  assert.match(dot, /assess_decompose_auto_approve[\s\S]*action_id="ceremony\.decompose_auto_approve"/);
  assert.match(dot, /decompose_auto_gate -> inspect_approved \[condition="auto_approve=true"\]/);
  assert.match(dot, /decompose_auto_gate -> load_goal_decompose_review_task_prompt \[condition="auto_approve!=true"\]/);
  assert.match(dot, /Complexity floor signal:/);
  assert.match(proposeTaskPrompt, /Primary objective: propose the smallest set of real product increments that (would materially satisfy the goal if they shipped|covers EVERY deliverable extracted above)/);
  assert.match(proposeTaskPrompt, /Do not replace the goal with decomposition continuity work, fallback scaffolding, or meta-factory support work/);
  assert.match(proposeTaskPrompt, /Prefer real shipped deliverables over enabling scaffolding/);
  assert.match(proposeTaskPrompt, /If a goal asks for multiple concrete asset types .* preserve those deliverables in the feature plan/);
  assert.match(reviewTaskPrompt, /The decomposition ships the goal itself, not merely scaffolding, fallback continuity, or future-work enablement/);
  assert.match(reviewTaskPrompt, /If all proposed features landed, the original goal would be (materially satisfied|FULLY satisfied)/);

  assert.match(analyzeTaskPrompt, /Include `goal_request_type` in goal_context/);
  assert.match(analyzeTaskPrompt, /goal_request_type.*factory_request/s);
  assert.match(analyzeTaskPrompt, /factory_request_bucket_contract\.required_buckets/);
  assert.match(analyzeTaskPrompt, /reusable_capability_gaps/);
  assert.match(analyzeTaskPrompt, /reusable_policy_profile_gaps/);
  assert.match(analyzeTaskPrompt, /factory_instance_wiring/);
  assert.match(analyzeTaskPrompt, /domain_specific_residues/);

  assert.match(proposeTaskPrompt, /Factory-request bucket contract/);
  assert.match(proposeTaskPrompt, /factory_request_bucket/);
  assert.match(proposeTaskPrompt, /factory_request_bucket_text/);
  assert.match(proposeTaskPrompt, /reusable_capability_gaps/);
  assert.match(proposeTaskPrompt, /reusable_policy_profile_gaps/);
  assert.match(proposeTaskPrompt, /factory_instance_wiring/);
  assert.match(proposeTaskPrompt, /domain_specific_residues/);
  assert.match(proposeTaskPrompt, /Factory-request goal-graph contract/);
  assert.match(proposeTaskPrompt, /factory_request_goal_graph/);
  assert.match(proposeTaskPrompt, /final_instantiation/);
  assert.match(proposeTaskPrompt, /goal_edges/);

  assert.match(reviewTaskPrompt, /Factory-request review contract/);
  assert.match(reviewTaskPrompt, /factory_request_bucket_text/);
  assert.match(reviewTaskPrompt, /factory_request_goal_graph/);
  assert.match(reviewTaskPrompt, /goal_edges/);
  assert.match(reviewTaskPrompt, /Reject the plan when either reusable bucket/);
});

test("decompose propose/review prompts cover meta-factory targets and inspect proposed feature count before auto-approve", () => {
  const dot = readFileSync(dotPath, "utf8");
  const nodes = parseDotNodes(dot);
  const edges = parseDotEdges(dot);
  const { forward } = buildAdjacency(edges);
  const proposeTaskPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/propose.md", "utf8");
  const reviewTaskPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/review.md", "utf8");

  const proposeNode = nodes.get("propose");
  assert.ok(proposeNode, "propose node must exist");
  assert.match(
    proposeTaskPrompt,
    /Meta-factory improvement goals/,
    "propose prompt must include explicit meta-factory goal shape guidance",
  );
  assert.match(
    proposeTaskPrompt,
    /CRITICAL OUTPUT CONTRACT/,
    "propose prompt must include the critical output contract",
  );

  const reviewNode = nodes.get("review");
  assert.ok(reviewNode, "review node must exist");
  assert.match(
    reviewTaskPrompt,
    /meta-factory improvement goals/i,
    "review prompt must include parallel named-target coverage rule",
  );

  const inspectNode = nodes.get("inspect_proposed_features");
  assert.ok(inspectNode, "inspect_proposed_features node must exist");
  assert.match(
    String(inspectNode.raw || ""),
    /action_id="common\.count_feature_objects"/,
    "inspect_proposed_features must use count_feature_objects",
  );

  const injectRetryNode = nodes.get("inject_retry_signal");
  assert.ok(injectRetryNode, "inject_retry_signal node must exist");
  assert.match(
    String(injectRetryNode.raw || ""),
    /action_id="common\.build_retry_signal"/,
    "inject_retry_signal must use build_retry_signal",
  );

  assert.ok(
    hasPath(forward, "propose", "inspect_proposed_features"),
    "propose must have a path to inspect_proposed_features",
  );
  assert.ok(
    hasPath(forward, "inspect_proposed_features", "assess_decompose_auto_approve"),
    "inspect_proposed_features must have a path to assess_decompose_auto_approve",
  );
  assert.ok(
    hasPath(forward, "retry_budget", "inject_retry_signal"),
    "retry_budget must have a path to inject_retry_signal",
  );
  assert.ok(
    hasPath(forward, "inject_retry_signal", "load_goal_decompose_propose_task_prompt"),
    "inject_retry_signal must have a path to the propose task prompt loader",
  );
  assert.match(
    dot,
    /retry_budget -> inject_retry_signal \[condition="decompose_attempts<2" label="revise"\]/,
    "retry branch must route through inject_retry_signal",
  );
  assert.doesNotMatch(
    dot,
    /retry_budget -> propose \[condition="decompose_attempts<2" label="revise"\]/,
    "retry branch must not route directly to propose",
  );
});

test("goal_run preserves automatic handoff from decomposition through deterministic issue materialization", () => {
  const dot = readFileSync(goalRunDotPath, "utf8");
  assert.match(dot, /intake_decompose\s*->\s*append_rationale_feature/);
  assert.match(dot, /append_rationale_feature\s*->\s*issues/);
  assert.match(dot, /issues\s*->\s*count_approved_features/);
  assert.match(dot, /count_approved_features\s*->\s*count_issues/);
  assert.match(dot, /count_issues\s*->\s*decomposition_feature_gate/);
  assert.match(dot, /decomposition_feature_gate -> decomposition_issue_gate \[condition="approved_feature_count!=0"\]/);
  assert.match(dot, /decomposition_issue_gate -> encode_goal_issue_b64 \[condition="issue_count!=0"\]/);
  assert.match(dot, /decomposition_feature_gate -> keep_open \[condition="approved_feature_count=0"\]/);
  assert.match(dot, /decomposition_issue_gate -> keep_open \[condition="issue_count=0"\]/);
  assert.match(dot, /persist_decomposition_packet\s*->\s*normalize_issue_index/);
  assert.match(dot, /normalize_issue_index\s*->\s*zip_feature_map/);
  assert.match(dot, /zip_feature_map\s*->\s*resolve_deps/);
  assert.match(dot, /resolve_deps\s*->\s*label_issues/);
  assert.match(dot, /label_issues\s*->\s*apply_feature_blockers/);
  assert.match(dot, /persist_decomposition_packet[\s\S]*action_id="goal\.persist_decomposition_packet"/);
});

test("goal_run routes hard goals to planning-only graph until planning_state=approved", () => {
  const dot = readFileSync(goalRunDotPath, "utf8");
  const hardPlanDot = readFileSync("docs/contracts/workflow-ir/capability-goal-decomposition/goal_hard_plan.dot", "utf8");

  assert.match(dot, /hard_planning_gate\s*\[shape="diamond" label="Hard planning approved\?"\]/);
  assert.match(dot, /easy_execution_gate\s*->\s*hard_planning_gate\s*\[condition="goal_execution_path=hard"\]/);
  assert.match(dot, /hard_planning_gate\s*->\s*hard_plan\s*\[condition="planning_state!=approved"\]/);
  assert.match(dot, /hard_planning_gate\s*->\s*materialize_hard_plan\s*\[condition="planning_state=approved"\]/);
  assert.match(dot, /hard_plan\s*->\s*hard_planning_hold_done/);
  assert.match(dot, /hard_planning_hold_done\s*->\s*done/);
  assert.match(dot, /materialize_hard_plan\s*->\s*approved_hard_plan_resume/);
  assert.match(dot, /approved_hard_plan_resume\s*->\s*encode_goal_issue_b64/);
  assert.match(dot, /approved_hard_plan_resume\s*\[type="tool"/);
  assert.match(dot, /approved_hard_plan_resume[\s\S]*outputs="approved,decompose_attempt_number,decompose_parse_status,decompose_parse_source"/);
  assert.match(dot, /materialize_hard_plan[\s\S]*action_id="goal\.materialize_approved_plan"/);

  assert.match(hardPlanDot, /typed_action_transport_mode = "enforced"/);
  assert.match(hardPlanDot, /encode_goal_issue_b64[\s\S]*action_id="common\.encode_base64"/);
  assert.match(hardPlanDot, /encode_factory_request_goal_graph_b64[\s\S]*action_value="\$\{factory_request_goal_graph\}"/);
  assert.match(hardPlanDot, /persist_hard_plan_packet[\s\S]*action_id="goal\.persist_hard_plan_artifact"/);
  assert.match(hardPlanDot, /persist_hard_plan_packet[\s\S]*action_factory_request_goal_graph_b64="\$\{factory_request_goal_graph_b64\}"/);
  assert.match(hardPlanDot, /export_keys="goal_issue,goal_context,approved_features,factory_request_goal_graph,review_notes,approved/);
  assert.match(hardPlanDot, /validate_hard_plan_packet[\s\S]*action_id="goal\.validate_planning_artifact"/);
  assert.match(hardPlanDot, /attach_hard_plan_artifact[\s\S]*action_id="goal\.attach_planning_artifacts"/);
  assert.match(hardPlanDot, /mark_hard_plan_pending_review[\s\S]*action_id="goal\.mark_planned"/);
});

test("goal_execute resolves canonical execution-path metadata before building execution plan", () => {
  const dot = readFileSync(waveExecuteDotPath, "utf8");
  assert.match(dot, /resolve_execution_path\s*\[type="tool"/);
  assert.match(dot, /resolve_execution_path[\s\S]*(?:action_id="software\.resolve_goal_execution_path"[\s\S]*action_repo="\$\{repo\}"[\s\S]*action_goal_issue_number="\$\{goal_issue_number\}"[\s\S]*action_goal_execution_paths="\$\{goal_execution_paths\}"[\s\S]*action_factory_id="\$\{factory_id\}"|goal execution-path resolve --repo-root '\$\{repo\}' --goal-issue-number '\$\{goal_issue_number\}' --goal-execution-paths '\$\{goal_execution_paths\}' --factory-id '\$\{factory_id\}')/);
  assert.match(dot, /outputs="goal_execution_path,goal_routing_state,goal_execution_path_version,classification_version,goal_execution_path_packet_id,goal_execution_path_packet_path"/);
  assert.match(dot, /seed_state -> resolve_execution_path -> build_execution_plan/);
  const executionPlanNode = parseDotNodes(dot).get("build_execution_plan");
  assert.ok(executionPlanNode, "build_execution_plan must exist");
  for (const [key, value] of Object.entries({
    action_id: "software.build_goal_execution_plan",
    action_repo: "${gh_repo}",
    action_goal_number: "${goal_issue_number}",
    action_completed_issues: "${completed_issues}",
    action_direct_execution: "${goal_execution_mode}",
    action_direct_execution_path: "${goal_execution_path}",
    action_goal_routing_state: "${goal_routing_state}",
    action_goal_execution_path_version: "${goal_execution_path_version}",
    action_goal_execution_path_packet_id: "${goal_execution_path_packet_id}",
  })) assert.ok(executionPlanNode.raw.includes(`${key}="${value}"`), `build_execution_plan requires ${key}`);

  const goalRunDot = readFileSync(goalRunDotPath, "utf8");
  assert.match(goalRunDot, /resolve_hard_goal_state\s*\[type="tool"/);
  assert.match(goalRunDot, /outputs="hard_goal,hard_goal_state,hard_goal_state_reason,hard_plan_packet_present,hard_plan_packet_id,hard_plan_packet_path,hard_plan_comment_marker,hard_plan_comment_id,hard_plan_comment_url,hard_plan_artifact_count,hard_plan_artifact_refs,ready_label_present,awaiting_human_label_present"/);
  assert.match(goalRunDot, /resolve_hard_goal_state[\s\S]*action_id="goal\.inspect_hard_state"/);
  assert.match(goalRunDot, /admission_check[\s\S]*action_id="goal\.inspect_run_admission"/);
  assert.match(goalRunDot, /start -> resolve_execution_path -> resolve_hard_goal_state -> admission_check -> admission_gate/);
});

test("goal_run exports decomposition outputs needed for fallback continuity", () => {
  const dot = readFileSync(goalRunDotPath, "utf8");
  assert.match(
    dot,
    /export_keys="goal_issue,goal_context,approved_features,external_bug_report,external_bug_errors,external_bug_present,external_bug_intake_activated,review_notes,approved,decompose_attempts,decompose_parse_status,decompose_parse_error,decompose_proposed_excerpt,decompose_parse_source"/,
  );
});

test("goal_run retry diagnostics include deterministic parse source metadata", () => {
  const dot = readFileSync(goalRunDotPath, "utf8");
  assert.match(dot, /keep_open[\s\S]*action_decompose_parse_source="\$\{decompose_parse_source\}"/);
});

test("decompose normalization nodes contain no inline python heredoc", () => {
  const dot = readFileSync(dotPath, "utf8");
  const normalizeNode = dot.match(/normalize_approved\s*\[[\s\S]*?\]/)?.[0] || "";
  const incrementNode = dot.match(/inc_attempts\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.doesNotMatch(normalizeNode, /python3\s+-\s*<<'PY'/);
  assert.doesNotMatch(incrementNode, /python3\s+-\s*<<'PY'/);
  assert.doesNotMatch(dot, /python3\s+-\s*<<'PY'/);
});

test("fallback instrumentation audit: fallback helpers are wired to fallback-defect emission nodes", () => {
  const audits = [
    {
      graphPath: dotPath,
      fallbackHelpers: [
        {
          helperName: "goal.fallback_feature_pair",
          nodeId: "fallback",
          token: "action_id=\"goal.fallback_feature_pair\"",
          requiredSignalNodes: [],
        },
        {
          helperName: "goal.normalize_approved_features",
          nodeId: "normalize_features",
          token: "action_id=\"goal.normalize_approved_features\"",
          requiredSignalNodes: ["normalize_features"],
          requiredSignalTokens: [],
        },
      ],
    },
    {
      graphPath: waveIssueExecuteDotPath,
      fallbackHelpers: [
        {
          helperName: "force-merge-report-approved",
          nodeId: "report_approved",
          token: "action_id=\"coding.build_approved_result\"",
          requiredSignalNodes: [],
          requiredSignalTokens: [],
        },
      ],
    },
    {
      graphPath: waveExecuteDotPath,
      fallbackHelpers: [
        {
          helperName: "merge-conflict-llm-resolution",
          nodeId: "set_resolution_source_llm",
          token: "printf 'llm'",
          requiredSignalNodes: [],
          requiredSignalTokens: [
            "resolution_gate -> emit_resolution_failure",
            "emit_resolution_failure -> set_goal_merge_failed",
          ],
        },
      ],
    },
  ];

  const rows = [];
  const failures = [];

  for (const audit of audits) {
    const dot = readFileSync(audit.graphPath, "utf8");
    const nodes = parseDotNodes(dot);
    const edges = parseDotEdges(dot);
    const { forward, reverse } = buildAdjacency(edges);

    for (const helper of audit.fallbackHelpers) {
      const helperNode = nodes.get(helper.nodeId);
      const helperPrompt = String(helperNode?.raw || helperNode?.prompt || "");
      const helperPresent = helperPrompt.includes(helper.token);
      const missing = [];

      if (!helperNode) {
        missing.push(`missing helper node: ${helper.nodeId}`);
      } else if (!helperPresent) {
        missing.push(`helper token not found in node prompt: ${helper.token}`);
      }

      let branchLinked = false;
      if (helperPresent && helperNode) {
        for (const signalNodeId of helper.requiredSignalNodes || []) {
          const signalNode = nodes.get(signalNodeId);
          if (!signalNode) {
            missing.push(`missing signal node: ${signalNodeId}`);
            continue;
          }
          if (hasBranchLink({ helperNodeId: helper.nodeId, signalNodeId, forward, reverse })) {
            branchLinked = true;
          }
        }
      }

      if ((helper.requiredSignalNodes || []).length > 0 && !branchLinked) {
        missing.push(`no branch link found from helper node ${helper.nodeId} to any required signal nodes`);
      }

      for (const token of helper.requiredSignalTokens || []) {
        if (!dot.includes(token)) {
          missing.push(`missing required signal token: ${token}`);
        }
      }

      rows.push({
        graph: audit.graphPath,
        node: helper.nodeId,
        helper: helper.helperName,
        status: missing.length === 0 ? "instrumented" : "missing",
      });

      if (missing.length > 0) {
        failures.push([
          `graph=${audit.graphPath}`,
          `node=${helper.nodeId}`,
          `helper=${helper.helperName}`,
          ...missing,
        ].join(" | "));
      }
    }
  }

  const header = "graph | node_id | fallback_helper | instrumentation";
  const table = rows
    .map((row) => `${row.graph} | ${row.node} | ${row.helper} | ${row.status}`)
    .join("\n");

  // visible CI audit evidence
  console.error(`[fallback-audit] scanned=${rows.length}\n${header}\n${table}`);

  assert.equal(
    failures.length,
    0,
    `fallback instrumentation audit failures:\n${failures.join("\n")}`,
  );
});

test("decompose propose prompt handles investigative goal patterns explicitly", () => {
  const prompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/propose.md", "utf8");
  // The propose prompt must instruct the LLM to decompose investigative goals
  // into (1) root-cause + fix feature and (2) regression gate feature
  assert.match(prompt, /Investigative and diagnostic goals/);
  assert.match(
    prompt,
    /Do NOT return an empty array for a goal whose body describes an investigation/,
  );
});

test("decompose prompts enforce UI\/refinement metadata contract", () => {
  const proposePrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/propose.md", "utf8");
  const reviewPrompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/review.md", "utf8");

  assert.match(proposePrompt, /UI\/refinement decomposition contract/);
  assert.match(proposePrompt, /visual_risk_class/);
  assert.match(proposePrompt, /hotspot_files/);
  assert.match(proposePrompt, /scope_limit_minutes/);
  assert.match(proposePrompt, /refinement_strategy/);
  assert.match(proposePrompt, /scenario_sources/);
  assert.match(proposePrompt, /AGENTS\.md/);
  assert.match(proposePrompt, /AGENT-LEARNINGS\.md/);
  assert.match(proposePrompt, /scenario_root/);
  assert.match(proposePrompt, /visual_refinement_risk/);

  assert.match(reviewPrompt, /UI\/refinement review contract/);
  assert.match(reviewPrompt, /domain=`ui-refinement`/);
  assert.match(reviewPrompt, /scenario_root/);
  assert.match(reviewPrompt, /visual_refinement_risk/);
  assert.match(reviewPrompt, /set approved=false/);
});

test("decompose review prompt does not reject investigative goals for missing product surface", () => {
  const prompt = readFileSync("packages/factory-prompts/prompts/goal_decomposer/review.md", "utf8");
  // The review prompt must acknowledge that investigative goals have a valid feature shape
  assert.match(prompt, /Investigative and diagnostic goals/);
  assert.match(prompt, /root-cause identification and fix implementation/);
  assert.match(prompt, /regression gate/);
});

test("goal_intake_decompose shares one explicit goal-scoped goal_decomposer session", () => {
  const dot = readFileSync(dotPath, "utf8");
  for (const nodeName of ["analyze", "propose", "review"]) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.match(node, /session_id="goal-decomposer-\$\{issue_number\}"/);
  }
});
