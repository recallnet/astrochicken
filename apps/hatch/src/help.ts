import {
	ACTION_IDENTIFIERS_V1,
	AGENT_IDS_V1,
	AGENT_ROLES_V1,
	DEFAULT_AGENT_IDENTITY_FALLBACK_V1,
	GOVERNANCE_DECISIONS_V1,
	GOVERNANCE_KINDS_V1,
	TOOL_IDENTIFIERS_V1,
} from "./pipeline/governance.js";
import { FACTORY_MODES } from "./factory/mode.js";
import { IDENTITY_MODES, IDENTITY_RULE_CODES, IRREVERSIBLE_HANDLER_TYPES_V1 } from "./pipeline/identity.js";

const identityModesLabel = IDENTITY_MODES.join(", ");
const trustParticipantHandlerTypesLabel = IRREVERSIBLE_HANDLER_TYPES_V1.join(", ");
const toolIdsLabel = TOOL_IDENTIFIERS_V1.join(", ");
const actionIdsLabel = ACTION_IDENTIFIERS_V1.join(", ");
const agentIdsLabel = AGENT_IDS_V1.join(", ");
const agentRolesLabel = AGENT_ROLES_V1.join(", ");
const governanceKindsLabel = GOVERNANCE_KINDS_V1.join(", ");
const governanceDecisionsLabel = GOVERNANCE_DECISIONS_V1.join(", ");
const factoryModesLabel = FACTORY_MODES.join(", ");

export function printHelpTopic(topic: string): void {
	const content = helpTopics[topic];
	if (!content) {
		console.error(`Unknown help topic: "${topic}"\n`);
		console.error("Available topics:");
		for (const t of Object.keys(helpTopics).sort()) {
			console.error(`  hatch help ${t}`);
		}
		process.exit(1);
	}
	console.log(content.trim());
}

const helpNodes = `
NODE TYPES

Hatch pipelines are directed graphs where each node runs a handler.
The handler is determined by the node's shape or type attribute.

Quick reference:

  Shape/Type           Handler              Purpose
  ─────────────────────────────────────────────────────────────
  shape=Mdiamond       start                Entry point (exactly one required)
  shape=Msquare        exit                 Terminal node (at least one required)
  shape=box (default)  codergen             LLM task — sends prompt, returns text
  type="tool"          tool                 Runs a shell command
  shape=diamond        conditional          Branches on context conditions
  shape=hexagon        wait.human           Pauses for human approval
  shape=component      parallel             Fan-out (runs branches concurrently)
  shape=tripleoctagon  parallel.fan_in      Fan-in (joins parallel branches)
  shape=house          stack.manager_loop   Supervisor loop (LLM manages sub-tasks)
  shape=octagon        assert               Deterministic gate (shell check)
  type="pipeline"      pipeline             Run another .dot file as child
  type="fan_out.dynamic" fan_out.dynamic    Fan-out over JSON array
  type="fan_in.dynamic"  fan_in.dynamic     Collect fan-out results
  type="agent.worktree"  agent.worktree     Git worktree + coding agent
  type="agent.kw"        agent.kw           Persistent knowledge worker

You can also set type="..." explicitly to override shape-based detection.

────────────────────────────────────────────────────────────────

START NODE (shape=Mdiamond)

  Entry point. Every pipeline needs exactly one. Does nothing on its
  own — execution flows to its outgoing edge immediately.

    start [shape=Mdiamond]

EXIT NODE (shape=Msquare)

  Terminal node. Pipeline stops when it reaches an exit node.
  You need at least one. You can have multiple for different
  end states (e.g., done vs failed).

    done  [shape=Msquare]
    error [shape=Msquare label="Failed"]

LLM NODE / CODERGEN (shape=box, or default)

  Sends a prompt to an LLM and returns the response as output.
  This is the default handler — any node without a shape is an LLM node.

    analyze [label="Analyze code"
             prompt="Review this code for bugs and suggest fixes."]

  Key attributes:
    prompt              The instruction sent to the LLM
    llm_model           Override model (e.g., "claude-sonnet-4-6", "gpt-4.1")
    llm_provider        Override provider (e.g., "anthropic", "codex")
    reasoning_effort    "low", "medium", or "high" (default: "high")
    thread_id           Conversation thread for multi-turn context
    fidelity            Thread compaction: full, truncate, compact, summary:*

  The previous node's output is passed as input context to the LLM.

TOOL NODE (type="tool")

  Runs a shell command. The prompt attribute contains the command.
  If a previous node produced output, it's piped to stdin.

    list_files [type="tool" label="List files"
                prompt="find . -name '*.go' | head -20"]

  Key attributes:
    prompt              The shell command to execute (via sh -c)
    workdir             Working directory (default: graph workdir or ".")

  Tip: Use $VAR for shell environment variables.
       Use \${var} for hatch pipeline context variables.
       Hatch expands \${var} BEFORE the shell sees the command.

CONDITIONAL NODE (shape=diamond)

  Routes execution based on context conditions on outgoing edges.
  Must have at least 2 outgoing edges. The node itself is a pass-through —
  all the logic is in the edge conditions.

    check [shape=diamond label="Success?"]

    check -> done  [condition="outcome=success" label="yes"]
    check -> retry [condition="outcome!=success" label="retry"]

  See: hatch help edges

HUMAN GATE (shape=hexagon)

  Pauses execution and asks for human input. In CLI mode, prompts
  on the terminal. In server mode, sends a question via the API.

    review [shape=hexagon label="Approve deployment?"
            prompt="The pipeline wants to deploy. Approve?"]

PARALLEL NODE (shape=component)

  Fan-out: runs all outgoing branches concurrently.
  Must be paired with a fan-in node downstream.

    fan_out [shape=component label="Run in parallel"]

    fan_out -> branch_a
    fan_out -> branch_b
    fan_out -> branch_c

FAN-IN NODE (shape=tripleoctagon)

  Joins parallel branches. Waits for all incoming branches to complete,
  then merges their outputs and continues.

    join [shape=tripleoctagon label="Collect results"]

MANAGER LOOP (shape=house)

  A supervisor that uses an LLM to manage sub-tasks. The LLM can
  delegate work, review results, and decide when the task is complete.

    supervisor [shape=house label="Project Manager"
                prompt="Manage the implementation of this feature."]

ASSERT NODE (shape=octagon)

  Deterministic gate — runs a shell command and checks exit code.
  No LLM involved. Use for build checks, test passes, file existence.

    check [shape=octagon label="Tests pass?"
           prompt="npm test"
           expect="success"
           fail_message="Tests failed"]

  Attributes:
    prompt              Shell command to run
    expect              "success" (exit 0 = pass) or "fail" (exit non-0 = pass)
    fail_message        Human-readable message on assertion failure

  expect="fail" is for negative checks:
    no_secrets [shape=octagon
                prompt="grep -rn 'API_KEY=' src/"
                expect="fail"
                fail_message="Found hardcoded API keys in source"]

PIPELINE NODE (type="pipeline")

  Runs another .dot file as a child pipeline. Enables composition
  of complex workflows from reusable sub-pipelines.

    run_triage [type="pipeline"
                label="Run triage"
                pipeline="graphs/triage.dot"
                inherit_context="true"
                export_keys="triage_results,excluded"
                timeout="30m"]

  Attributes:
    pipeline            Path to .dot file (supports \${var} expansion)
    inherit_context     "true" to clone parent context to child (default: false)
    export_keys         Comma-separated context keys to copy back from child

  Composite handler contract (shared with fan_out.dynamic):
    - Child failure causes parent failure (reason="child_failed")
    - Child timeout normalizes to reason="child_timeout"
    - External abort normalizes to reason="child_aborted"
    - inherit_context="true" clones parent context for child isolation
    - export_keys write back only after child success; failures skip writeback

  The child pipeline's exit node output becomes this node's output.
  No shape mapping — must use type="pipeline" explicitly.

DYNAMIC FAN-OUT (type="fan_out.dynamic")

  Reads a JSON array from context and runs a child pipeline per item.
  Use with output_key on a preceding node to populate the source array.

    fan_out [type="fan_out.dynamic"
             source_key="priority_features"
             item_key="current_feature"
             template="graphs/feature-dev.dot"
             max_concurrency="3"]

  Attributes:
    source_key          Context key containing JSON array
    item_key            Context key set to current item in each child (default: "item")
    template            Path to .dot file to run per item
    max_concurrency     Max parallel child pipelines (default: unlimited)

  Composite handler contract (shared with pipeline):
    - Child failure causes parent failure (reason="child_failed")
    - Child timeout normalizes to reason="child_timeout"
    - External abort normalizes to reason="child_aborted"
    - Each child gets a cloned parent context with item_key set per item
    - export_keys write back only for successful children

  Results are collected as a JSON array.

  Pair with fan_in.dynamic for graph readability:
    fan_in [type="fan_in.dynamic" label="Collect"]

WORKTREE AGENT (type="agent.worktree")

  Creates a git worktree and runs a pi coding agent in it.
  The agent gets its own branch, its own working directory, its own
  process. Multiple agents can work on the same repo concurrently.

    impl [type="agent.worktree"
          label="Implement feature"
          repo="/path/to/repo"
          branch="hatch/\${feature}"
          base="main"
          prompt="Read issue #\${issue}. Implement all changes."
          timeout="2h"
          cleanup_on_success="false"]

  Attributes:
    repo                Absolute path to git repository (required)
    branch              Branch name for worktree (required, supports \${var})
    base                Base branch to create from (default: "main")
    prompt              Task prompt for the agent
    await               Block until agent completes (default: "true")
    timeout             Max wall-clock time (default: "4h")
    cleanup_on_success  Remove worktree after completion (default: "false")
    agent_model         Override model for the spawned agent
    agent_provider      Override provider

  After execution, sets context:
    <branch>_commits     Number of commits ahead of base
    <branch>_worktree    Worktree directory path
    <branch>_dirty       "true" if working tree has uncommitted changes

  Worktree directory:
    Placed at <repo_parent>/.hatch-worktrees/<branch>
    Keeps project directory clean. All hatch worktrees in one location.

  Idempotent / Recovery:
    If worktree already exists with commits, the handler detects this
    as a recovery case and either skips (if clean) or re-prompts
    (if dirty). Same branch in multiple nodes = follow-up messages
    to the same agent session.

  Follow-up pattern:
    dev  [type="agent.worktree" repo="..." branch="feat-1" prompt="Implement X"]
    fix  [type="agent.worktree" repo="..." branch="feat-1" prompt="Fix: \${feedback}"]
    When branch matches an existing worktree, the handler reuses the
    persistent session and sends the new prompt as a follow-up.

KNOWLEDGE WORKER (type="agent.kw")

  Persistent pi agent session. Unlike worktree agents, KW agents
  run in the current workdir and persist their session for re-prompting
  across multiple nodes.

    researcher [type="agent.kw"
                label="Research"
                session_id="research"
                prompt="Research the current auth landscape"]

  Attributes:
    session_id        Persistent session identifier (default: node ID)
    prompt            Task prompt
`;


const helpEdges = `
EDGES, CONDITIONS, AND ROUTING

Edges connect nodes and define execution flow. When a node finishes,
the engine selects the next node using the outgoing edges.

BASIC SYNTAX

  Single edge:     A -> B
  Chained edges:   A -> B -> C -> D
  With attributes: A -> B [label="next" condition="outcome=success"]

EDGE ATTRIBUTES

  label             Display label (also used for preferred_label matching)
  condition         Routing expression (see below)
  weight            Numeric priority for tiebreaking (higher wins)
  loop_restart      "true" to mark intentional self-loops
  fidelity          Override thread fidelity for this transition
  thread_id         Override thread ID for this transition

────────────────────────────────────────────────────────────────

CONDITIONS

Conditions determine which edge to take when a node has multiple
outgoing edges. They compare against the pipeline context.

  Syntax:
    key=value             Exact match
    key!=value            Not equal
    key>value             Greater than (numeric)
    key<value             Less than (numeric)
    key>=value            Greater or equal (numeric)
    key<=value            Less or equal (numeric)
    key=value && k2=v2    AND conjunction (all must match)

  Dot-path access into JSON context values:
    items.length>0        Access nested JSON fields
    result.status=done    Works with output_key stored values

  Examples:
    condition="outcome=success"
    condition="outcome!=success"
    condition="outcome=success && stage=review"
    condition="priority_issues.length>0"

  Edges without conditions are unconditional (always match).

BUILT-IN CONTEXT VARIABLES

  After every node executes, these are set automatically:

    outcome           "success" if the node completed, "fail" if it failed
    last_stage        The ID of the node that just ran
    preferred_label   Set by LLM nodes when they suggest a path

  Handlers can also set custom context variables via ContextUpdates.

────────────────────────────────────────────────────────────────

EDGE SELECTION ALGORITHM

When a node finishes and has multiple outgoing edges, the engine
picks the next node in 5 steps:

  1. CONDITION FILTER
     Keep edges whose condition matches the current context.
     If none match, fall back to unconditional edges.
     If still none, the pipeline errors.

  2. PREFERRED LABEL
     If the handler set a preferred_label, prefer edges whose
     label matches it.

  3. SUGGESTED NEXT NODES
     If the handler suggested specific next nodes, prefer edges
     targeting those nodes.

  4. WEIGHT
     Among remaining edges, highest weight wins.

  5. LEXICAL TIEBREAK
     If still tied, the edge targeting the alphabetically first
     node ID wins (deterministic).

COMMON PATTERNS

  Success/fail branching:

    task -> check
    check -> done  [condition="outcome=success" label="done"]
    check -> retry [condition="outcome!=success" label="retry"]

  Retry loop:

    retry -> task [loop_restart="true"]

  Weighted fallback:

    router -> preferred_path [weight="10"]
    router -> fallback_path  [weight="1"]

  Complexity class routing (estimator -> low/medium/high):

    estimate [type="tool"
              output_format="json"
              output_key="complexity_estimate"
              outputs="complexity_class,signals,reason"
              prompt="hatch complexity estimate --input '\${complexity_input_json}'"]

    route -> low_path    [condition="complexity_class=low" label="low"]
    route -> medium_path [condition="complexity_class=medium" label="medium"]
    route -> high_path   [condition="complexity_class=high" label="high"]

  Contract: estimator JSON includes complexity_class, signals, reason,
  otel_dimension_key. Each signals.<key> entry carries
  { value, reason, score, _unknown }.
  Keep full payload in output_key and promote complexity_class
  via outputs= for deterministic edge routing.
`;

const helpContext = `
CONTEXT VARIABLES AND DATA FLOW

The pipeline context is a key-value store shared across all nodes.
It carries state through the pipeline and drives conditional routing.

────────────────────────────────────────────────────────────────

VARIABLE EXPANSION

Use \${var} in prompts, workdir, and edge attributes to reference
context variables. Hatch expands these before execution.

  task [prompt="Summarize this: \${previous_output}"]
  save [type="tool" prompt="echo '\${result}' > output.txt"]

Only the \${...} syntax is expanded by hatch. Plain $VAR is left
alone and will be interpreted by the shell in tool nodes.

  # This uses a shell env var (hatch doesn't touch it):
  fetch [type="tool" prompt="gh issue view $ISSUE --json title"]

  # This uses a hatch context var (expanded before shell runs):
  report [type="tool" prompt="echo '\${summary}' > report.md"]

────────────────────────────────────────────────────────────────

DATA FLOW BETWEEN NODES

Each node receives the previous node's output as input:

  1. Node A runs and produces output text
  2. The engine passes A's output as input to Node B
  3. For LLM nodes: the input is included as context
  4. For tool nodes: the input is piped to stdin

This means a pipeline like:

  fetch_data -> analyze -> write_report

...automatically flows data: fetch_data's stdout becomes analyze's
LLM context, and analyze's response becomes write_report's stdin.

────────────────────────────────────────────────────────────────

BUILT-IN VARIABLES

Set automatically by the engine after every node:

  outcome           "success" or "fail"
  last_stage        ID of the node that just finished
  preferred_label   Label suggested by the handler (if any)

CUSTOM VARIABLES

Handlers can set custom context variables via ContextUpdates in
their Outcome. These are merged into the context after execution
and are available to all subsequent nodes.

────────────────────────────────────────────────────────────────

THREAD CONTEXT (MULTI-TURN)

For nodes that need to remember previous conversations, use
thread_id. All nodes sharing a thread_id maintain a persistent
conversation history.

  step1 [thread_id="main" prompt="Analyze this codebase."]
  step2 [thread_id="main" prompt="Now suggest improvements."]

The fidelity attribute controls how long threads are compacted:

  full              Keep everything (default)
  truncate          Drop oldest messages, keep recent
  compact           Keep first message + recent messages
  summary:low       LLM summarizes old messages (brief)
  summary:medium    LLM summarizes old messages (moderate)
  summary:high      LLM summarizes old messages (detailed)

See: hatch help attributes
`;

const helpAttributes = `
ATTRIBUTE REFERENCE

All attributes that can be set on graphs, nodes, and edges.

════════════════════════════════════════════════════════════════
GRAPH ATTRIBUTES
════════════════════════════════════════════════════════════════

Set on the digraph block:

  digraph my_pipeline {
      label = "My Pipeline"
      workdir = "/path/to/project"
      ...
  }

  label                     Pipeline display name
  goal                      Pipeline-level goal (requires a goal_gate node)
  workdir                   Default working directory for tool nodes
  default_max_retry         Global retry limit (default: 50)
  retry_target              Node to jump to on retry
  fallback_retry_target     Fallback if retry_target fails
  default_fidelity          Default thread fidelity mode
  model_stylesheet          CSS-like model configuration (see: hatch help stylesheets)
  intent_ref                Default intent ID for nodes
  intent_profile            Default intent profile name
  intent_patches            Comma-separated patches to apply (must be allowlisted)
  identity_mode             Identity validation mode for trust participants
                            (${identityModesLabel}; default: legacy)

════════════════════════════════════════════════════════════════
NODE ATTRIBUTES
════════════════════════════════════════════════════════════════

Set in square brackets after the node ID:

  my_node [label="..." prompt="..." llm_model="..."]

  ── Identity ──
  label                     Display name (defaults to node ID)
  shape                     Determines handler type (see: hatch help nodes)
  type                      Explicit handler override (takes precedence over shape)
  class                     Comma-separated class names for stylesheet matching

  ── Prompts ──
  prompt                    LLM instruction or shell command (for tool nodes)

  ── LLM Configuration ──
  llm_model                 Model override (e.g., "claude-sonnet-4-6")
  llm_provider              Provider override (e.g., "anthropic", "codex", "openai")
  reasoning_effort          "low", "medium", or "high" (default: "high")

  ── Conversation Threads ──
  thread_id                 Thread name for multi-turn conversation memory
  fidelity                  Compaction mode: full, truncate, compact,
                            summary:low, summary:medium, summary:high

  ── Scenarios ──
  scenarios                 Load scenarios from factory-config scenarios.root
                            Comma-separated paths: "scope", "scope/domain",
                            or "scope/domain/scenario-id"
                            Injects scenario metadata + context into the prompt

  ── Intent ──
  intent_ref                Override intent ID for this node
  intent_profile            Intent profile override (defaults to graph or "default")
  intent_patches            Comma-separated patch IDs (must be allowlisted)

  ── Governance / Identity (trust participants only) ──
  scope                     ${trustParticipantHandlerTypesLabel}
  tool_id                   Stable tool identifier (${toolIdsLabel})
  action_id                 Stable action identifier (${actionIdsLabel})
  agent_id                  Stable agent identity id for trust telemetry/contracts
                            Allowed values: ${agentIdsLabel}
                            Fallback model: explicit valid agent_id → trust-participant map → ${DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId}
  agent_role                Stable agent identity role for trust telemetry/contracts
                            Allowed values: ${agentRolesLabel}
                            Fallback model: explicit valid agent_role → trust-participant map → ${DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole}
  governance                Required for trust participants (${governanceKindsLabel})
  governance_decision       Optional override (${governanceDecisionsLabel})

  ── Output ──
  output_key                Store node output in this context key
  output_format             "json" to validate output parses as JSON
  output_must_contain       Comma-separated strings that must appear in output
  output_must_not_contain   Comma-separated strings that must NOT appear in output
  outputs                   Comma-separated keys to extract from JSON output
                            (stores each field in context for downstream nodes)
  complexity convention     Use hatch complexity estimate for deterministic
                            complexity_class=low|medium|high routing.
                            Keep full estimator JSON in output_key and promote
                            outputs="complexity_class,signals,reason".
                            Payload contract: complexity_class, signals, reason,
                            otel_dimension_key (hatch.complexity.class).
                            Each signals.<key> is {value, reason, score,
                            _unknown}.
                            Playbook: docs/reference/complexity-floor-estimator.md

  ── Decision / Judge Alignment ──
  judge                     "true" marks node as decision-artifact eligible
                            and enables judge output schema enforcement
  reviewer                  "true" enables reviewer output schema enforcement
                            (review_verdict + review_reason_codes + review_notes)
  decision                  "true" marks node as decision-artifact eligible
  escalation                "true" marks node as decision-artifact eligible
  violation                 "true" marks node as decision-artifact eligible
  decision_record           "true" marks node as decision-artifact eligible
  judge_rubric              Optional rubric override (default: alignment.<intent_profile>)
  judge_required_evidence   Comma-separated context keys that must be present;
                            missing keys are recorded in missing_evidence and force pass=false
  objective_id              Optional objective identifier for decision artifacts;
                            fallback: intent_ref@intent_profile, else intent.unbound

  ── Assert ──
  expect                    "success" (exit 0 = pass) or "fail" (exit non-0 = pass)
  fail_message              Message on assertion failure (supports \${var})

  ── Pipeline Composition ──
  pipeline                  Path to child .dot file (supports \${var})
  inherit_context           "true" to clone parent context to child
  export_keys               Comma-separated keys to copy back from child

  ── Dynamic Fan-Out ──
  source_key                Context key containing JSON array
  item_key                  Context key set to current item (default: "item")
  template                  Path to .dot file to run per item
  max_concurrency           Max parallel child pipelines (default: unlimited)

  ── Worktree Agent ──
  repo                      Absolute path to git repository (required)
  branch                    Branch name for worktree (required, supports \${var})
  base                      Base branch to create from (default: "main")
  await                     Block until agent completes (default: "true")
  cleanup_on_success        Remove worktree after completion (default: "false")
  agent_model               Override model for the spawned agent
  agent_provider            Override provider for the spawned agent

  ── Knowledge Worker ──
  session_id                Persistent session identifier for re-prompting

  ── Execution ──
  workdir                   Working directory for tool nodes
  timeout                   Duration: "30s", "5m", "2h", "1d"
  max_retries               Retry count for this node
  retry_target              Node to jump to on failure
  fallback_retry_target     Fallback retry destination
  goal_gate                 "true" — must succeed before pipeline can exit
  auto_status               "true" — auto-report status
  allow_partial             "true" — accept partial results

════════════════════════════════════════════════════════════════
EDGE ATTRIBUTES
════════════════════════════════════════════════════════════════

Set in square brackets after the edge:

  A -> B [condition="outcome=success" label="done" weight="10"]

  label                     Display label, also used for preferred_label matching
  condition                 Routing expression (see: hatch help edges)
  weight                    Numeric tiebreak priority (higher wins, default: 0)
  loop_restart              "true" to mark as intentional self-loop
  input_key                 Context key to use as input for the target node
                            (overrides default data flow from previous output)
  fidelity                  Override thread fidelity for this transition
  thread_id                 Override thread ID for this transition
`;

const helpExamples = `
EXAMPLE PIPELINES

════════════════════════════════════════════════════════════════
1. MINIMAL — Shell command, no LLM
════════════════════════════════════════════════════════════════

  digraph simple {
      start [shape=Mdiamond]
      echo  [type="tool" prompt="echo 'Hello from hatch!'"]
      done  [shape=Msquare]

      start -> echo -> done
  }

  This runs a single shell command and exits.
  Save as hello.dot and run: hatch run hello.dot

════════════════════════════════════════════════════════════════
2. LLM + CONDITIONAL — Retry loop
════════════════════════════════════════════════════════════════

  digraph hello {
      label = "Hello World"

      start [shape=Mdiamond]
      greet [label="Generate greeting"
             prompt="Write a friendly one-line greeting."]
      check [shape=diamond label="Good?"]
      done  [shape=Msquare]

      start -> greet -> check
      check -> done  [condition="outcome=success" label="good"]
      check -> greet [condition="outcome!=success" label="retry"]
  }

  The LLM generates a greeting. If it succeeds, we're done.
  If it fails, we retry. The diamond node routes based on
  the outcome context variable set automatically by the engine.

════════════════════════════════════════════════════════════════
3. MULTI-STEP — Tool + LLM + Tool
════════════════════════════════════════════════════════════════

  digraph analyze_repo {
      label = "Analyze Repository"
      workdir = "."

      start [shape=Mdiamond]
      done  [shape=Msquare]

      // Step 1: Gather file listing (tool node)
      scan [type="tool" label="Scan files"
            prompt="find . -name '*.ts' | head -30"]

      // Step 2: LLM analyzes the listing (default box = codergen)
      analyze [label="Analyze structure"
               prompt="Based on this file listing, describe the project
                       structure and identify the main packages."]

      // Step 3: Save the analysis (tool node, stdin = LLM output)
      save [type="tool" label="Save report"
            prompt="cat > analysis.md"]

      start -> scan -> analyze -> save -> done
  }

  Data flows automatically: scan's stdout becomes the LLM's
  input context, and the LLM's response is piped to save's stdin.

════════════════════════════════════════════════════════════════
4. ADVANCED — Stylesheets, threads, provider overrides
════════════════════════════════════════════════════════════════

  digraph advanced {
      label = "Multi-provider pipeline"

      // Use a stylesheet to configure models by class
      model_stylesheet = "
          * { llm_model = \\"claude-sonnet-4-5-20250514\\" }
          .fast { llm_model = \\"claude-haiku-4-5-20251001\\"; reasoning_effort = \\"low\\" }
          .codex { llm_provider = \\"codex\\"; llm_model = \\"gpt-5.3-codex\\" }
          #final_review { llm_model = \\"claude-sonnet-4-5-20250514\\"; reasoning_effort = \\"high\\" }
      "

      start [shape=Mdiamond]
      done  [shape=Msquare]

      // These nodes share a conversation thread
      plan  [label="Plan" class="fast" thread_id="work"
             prompt="Plan the implementation for this feature."]
      build [label="Build" class="codex" thread_id="work"
             prompt="Implement the plan from the previous step."]

      // This node uses the #id selector from the stylesheet
      final_review [label="Review"
                    prompt="Review the implementation for correctness."]

      check [shape=diamond label="Approved?"]

      start -> plan -> build -> final_review -> check
      check -> done  [condition="outcome=success"]
      check -> plan  [condition="outcome!=success" label="revise"]
  }

  The stylesheet sets default models by class (.fast, .codex)
  and overrides a specific node (#final_review). The thread_id
  on plan and build means build can see plan's conversation.

`;

const helpStylesheets = `
MODEL STYLESHEETS

Stylesheets let you configure LLM models and settings across your
pipeline using CSS-like selectors, instead of repeating attributes
on every node.

────────────────────────────────────────────────────────────────

SYNTAX

Set model_stylesheet as a graph attribute:

  digraph my_pipeline {
      model_stylesheet = "
          * { llm_model = \\"gpt-4.1\\"; reasoning_effort = \\"medium\\" }
          .critical { llm_model = \\"claude-sonnet-4-5-20250514\\"; reasoning_effort = \\"high\\" }
          #review { llm_model = \\"o3\\" }
      "
      ...
  }

────────────────────────────────────────────────────────────────

SELECTORS

  *            Universal — matches all nodes
  .classname   Class — matches nodes with class="classname"
  #nodeid      ID — matches the node with that exact ID

Nodes can have multiple classes (comma-separated):

  my_node [class="fast,codegen" prompt="..."]

This node matches both .fast and .codegen selectors.

────────────────────────────────────────────────────────────────

SPECIFICITY

When multiple rules match a node, higher specificity wins:

  * (universal)    = 0  (lowest priority)
  .class           = 1
  #id              = 2  (highest priority)

For equal specificity, later rules override earlier ones.

Explicit node attributes ALWAYS override stylesheet properties:

  1. Node's own attributes (highest priority)
  2. #id stylesheet rules
  3. .class stylesheet rules
  4. * universal stylesheet rules (lowest priority)

────────────────────────────────────────────────────────────────

PROPERTIES

Any node attribute can be set in a stylesheet rule:

  llm_model           Model name
  llm_provider        Provider name
  reasoning_effort    "low", "medium", "high"
  fidelity            Thread compaction mode
  timeout             Duration string

────────────────────────────────────────────────────────────────

EXAMPLE: Multi-provider setup

  model_stylesheet = "
      * {
          llm_provider = \\"anthropic\\";
          llm_model = \\"claude-sonnet-4-5-20250514\\";
      }
      .cheap {
          llm_model = \\"claude-haiku-4-5-20251001\\";
          reasoning_effort = \\"low\\";
      }
      .codex {
          llm_provider = \\"codex\\";
          llm_model = \\"gpt-5.3-codex\\";
      }
      #final_review {
          llm_model = \\"claude-sonnet-4-5-20250514\\";
          reasoning_effort = \\"high\\";
      }
  "

  // Now just assign classes:
  triage  [class="cheap" prompt="Categorize this issue."]
  code    [class="codex" prompt="Write the implementation."]
  review  [prompt="Review for correctness."]  // uses * defaults
`;

type HelpModeApplicability = "standalone" | "managed" | "both";

const modeTokenByApplicability: Record<HelpModeApplicability, string> = {
	standalone: "standalone-only",
	managed: "managed-only",
	both: "mode: both",
};

const modeCommandMatrixRows: Array<{ command: string; mode: HelpModeApplicability; notes: string }> = [
	{ command: "hatch run", mode: "both", notes: "Execute DOT pipelines." },
	{ command: "hatch validate", mode: "both", notes: "Validate DOT contracts." },
	{ command: "hatch factory conformance", mode: "both", notes: "Run shared conformance harness." },
	{ command: "hatch-ops factory status", mode: "both", notes: "Factory health snapshot." },
	{ command: "hatch-ops factory tick-status", mode: "both", notes: "Tick/stage posture." },
	{ command: "hatch-ops factory subscribe", mode: "both", notes: "Semantic wait for next meaningful event." },
	{ command: "hatch-ops factory host-*", mode: "managed", notes: "Host lifecycle + daemon controls." },
	{ command: "hatch help modes", mode: "both", notes: "Mode orientation + detection playbook." },
];

const modeCommandMatrixText = modeCommandMatrixRows
	.map((row) => `  ${row.command.padEnd(34)} ${modeTokenByApplicability[row.mode].padEnd(16)} ${row.notes}`)
	.join("\n");

const helpModes = `
HATCH MODES: STANDALONE VS MANAGED

Hatch supports two canonical factory modes: ${factoryModesLabel}.
If no managed signal is present, Hatch resolves mode to standalone.

Mode intent:
  standalone
    You run Hatch directly against your local repo/context.
    No control-plane/host-assignment lifecycle is required.

  managed
    A control plane coordinates factory instances, host assignment,
    daemon lifecycle, and rollout/resume policy.

MODE DETECTION (FAIL-CLOSED PRECEDENCE)

  1. CLI override: --factory-mode <standalone|managed>
  2. Env override: HATCH_FACTORY_MODE or FACTORY_MODE
  3. Config/instance managed signals (managed, kind_id, instance_id,
     destinations, upstream_repo, control-plane topology)
  4. Fallback: mode.default => standalone

Inspect resolved mode + provenance:
  hatch-ops factory status --json
  # context.factory_mode
  # context.factory_mode_source

MODE COMMAND MATRIX

  Command                            Applicability    Notes
  -------------------------------------------------------------------------------
${modeCommandMatrixText}

LIFECYCLE QUICK START

  Standalone (mode: standalone)
    hatch validate my.dot
    hatch run my.dot

  Managed (managed-only overlays)
    hatch-ops factory host-install --factory-id <id>
    hatch-ops factory host-start --factory-id <id>
    hatch-ops factory host-health --factory-id <id>

WHAT HAPPENS IF I RUN MANAGED-ONLY COMMANDS IN STANDALONE?

Managed-only commands require managed metadata (instance_id, host assignment,
control-plane wiring). In standalone contexts they fail closed with non-zero
status and context/assignment errors instead of mutating ambiguous state.

For docs-first onboarding/runbooks:
  docs/reference/factory-mode-applicability.md
  docs/runbooks/external-factory-operator-onboarding.md
  docs/runbooks/factory-operator-guide.md
  docs/host-lifecycle.md
`;

const helpValidation = `
VALIDATION RULES

Run hatch validate <file.dot> to check your pipeline. These are the
rules it checks:

────────────────────────────────────────────────────────────────

start_node
  Exactly one start node required (shape=Mdiamond or type="start").

  Fix: Add a start node:
    start [shape=Mdiamond]

terminal_node
  At least one exit node required (shape=Msquare or type="exit").

  Fix: Add an exit node:
    done [shape=Msquare]

reachability
  Every node must be reachable from the start node via edges.

  Fix: Either connect the unreachable node or remove it.
  Common cause: typo in an edge target.

edge_targets
  All edges must reference nodes that exist in the graph.

  Fix: Check for typos in node IDs. Edge syntax:
    node_a -> node_b
  Both node_a and node_b must be declared.

conditional_edges
  Diamond/conditional nodes must have at least 2 outgoing edges.
  (Otherwise, why branch?)

  Fix: Add a second outgoing edge with a different condition:
    check -> done  [condition="outcome=success"]
    check -> retry [condition="outcome!=success"]

parallel_fan_in
  If you have a parallel (component) node, you need a
  corresponding fan-in (tripleoctagon) node to join branches.

  Fix: Add a fan-in node:
    join [shape=tripleoctagon]

retry_targets
  retry_target and fallback_retry_target must reference existing nodes.

  Fix: Check for typos in the target node ID.

goal_gate
  If the graph has a goal attribute, at least one node must have
  goal_gate="true". This node must succeed for the pipeline to exit.

  Fix: Either remove the goal attribute or mark a node:
    verify [goal_gate="true" prompt="Verify the goal was met."]

node_types
  Warns about unknown handler types. Known types are:
  start, exit, codergen, tool, conditional, wait.human,
  parallel, parallel.fan_in, stack.manager_loop, assert,
  pipeline, fan_out.dynamic, fan_in.dynamic,
  agent.worktree, agent.kw

  Fix: Check for typos in shape or type attributes.
  See: hatch help nodes

identity_mode
  Graph identity mode controls trust-participant checks.
  Modes: ${identityModesLabel}. Default: legacy.

  legacy
    governance is required for trust participants (${trustParticipantHandlerTypesLabel});
    tool_id/action_id are optional, but validated when present.

  strict
    governance is required and tool_id + action_id are required for trust participants.

  Rule code:
    ${IDENTITY_RULE_CODES.MODE_INVALID}

tool_ids
  Scope: trust participants (${trustParticipantHandlerTypesLabel}).
  tool_id must be one of: ${toolIdsLabel}.

  Rule codes:
    ${IDENTITY_RULE_CODES.TOOL_ID_INVALID}
    ${IDENTITY_RULE_CODES.TOOL_ID_REQUIRED} (strict mode)

action_ids
  Scope: trust participants (${trustParticipantHandlerTypesLabel}).
  action_id must be one of: ${actionIdsLabel}.

  Rule codes:
    ${IDENTITY_RULE_CODES.ACTION_ID_INVALID}
    ${IDENTITY_RULE_CODES.ACTION_ID_REQUIRED} (strict mode)

governance_required
  Scope: trust participants (${trustParticipantHandlerTypesLabel}).
  governance must be one of: ${governanceKindsLabel}.

  Rule code:
    ${IDENTITY_RULE_CODES.GOVERNANCE_REQUIRED}

governance_kind
  Scope: trust participants (${trustParticipantHandlerTypesLabel}).
  governance must be one of: ${governanceKindsLabel}.

  Rule code:
    ${IDENTITY_RULE_CODES.GOVERNANCE_KIND_INVALID}

governance_decision
  Scope: trust participants (${trustParticipantHandlerTypesLabel}).
  governance_decision, when set, must be one of: ${governanceDecisionsLabel}.

  Rule code:
    ${IDENTITY_RULE_CODES.GOVERNANCE_DECISION_INVALID}

duplicate_edges
  No duplicate edges between the same pair of nodes with the same label.

  Fix: Remove the duplicate edge.

self_loops
  Edges from a node to itself require loop_restart="true" to
  confirm they're intentional.

  Fix: Add loop_restart to the edge:
    node -> node [loop_restart="true"]

intent_refs
  intent_ref values must exist in the intent registry. Nodes or graphs
  that set intent_profile or intent_patches must also have an intent_ref.

  Fix: Set intent_ref or correct the intent registry entry.

intent_profiles
  intent_profile must exist for the referenced intent.

  Fix: Use a valid profile name from the intent registry.

intent_patches
  intent_patches must be allowlisted for the referenced intent.

  Fix: Remove the patch or add it to the intent allowlist.

complexity_estimator_provenance (warning, hatch validate)
  If an edge condition references complexity_class (or legacy
  complexity alias) but no upstream estimator emits that key
  (via output_key or outputs), hatch validate emits warning
  [complexity_estimator_provenance].
  Canonical producer wiring:
    estimate [type="tool" prompt="hatch complexity estimate ..."
              output_format="json"
              output_key="complexity_estimate"
              outputs="complexity_class,signals,reason"]
  Playbook: docs/reference/complexity-floor-estimator.md

complexity_routing_context_flow (warning, lint-dot)
  Context-flow lint may also emit context_flow.undefined_reference
  when complexity_class is referenced before any producer exists.

  Typical command sequence:
    hatch validate my.dot
    node scripts/lint-dot.mjs my.dot

  Typical warning shapes:
    warning [complexity_estimator_provenance] edge route -> high ...
    {"severity":"warning","rule_id":"context_flow.undefined_reference", ...}

complexity telemetry convention
  Estimator stage.finish data should include complexity_class,
  complexity_signals, complexity_reason, complexity_otel_key and set
  OTEL dimension hatch.complexity.class for class-level dashboards.
`;

export const helpTopics: Record<string, string> = {
	nodes: helpNodes,
	edges: helpEdges,
	context: helpContext,
	attributes: helpAttributes,
	examples: helpExamples,
	stylesheets: helpStylesheets,
	validation: helpValidation,
	modes: helpModes,
};
