---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-22"
status: "active"
summary: "Hatch Handler Types Reference."
tags: [docs, factory-design, reference, skill, skills]
written: "2026-03-06"
---
# Hatch Handler Types Reference

Every node in a DOT graph has a `type` attribute that selects a handler. This reference covers
all available handler types, their attributes, and when to use them.

## Control flow handlers

### start
Entry point. Exactly one per graph. Pass-through.
```dot
start [shape=Mdiamond]
```

### exit (done)
Exit point. Exactly one per graph. Pass-through. Convention: name it `done`.
```dot
done [shape=Msquare]
```

### conditional (diamond gate)
Decision node. Routes to different edges based on context conditions.
```dot
gate [shape=diamond label="Decision question?"]
gate -> path_a [condition="key=value"]
gate -> path_b [condition="key!=value"]
```
No attributes needed on the node itself — conditions are on the edges.

## Execution handlers

### tool
Runs a shell command. Deterministic, single-shot. The workhorse of factory ops.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Shell command (supports `${variable}` substitution) |
| `governance` | if mutations | `"reversible"` or `"irreversible"` |
| `output_key` | yes* | Context key for stdout |
| `output_format` | no | `"json"` to parse stdout as JSON |
| `outputs` | no | Comma-separated keys extracted from JSON output |
| `workdir` | no | Override working directory |
| `trust_domain` | yes | Trust domain identifier |
| `trust_role` | yes | Trust role identifier |

*Every tool node must have `output_key` or `outputs` unless the command is a no-op (`:` or `true`).

**Governance rules:**
- Commands that create, modify, or delete anything: `governance="irreversible"`
- Commands that only read: `governance="reversible"`
- Lint enforces this via mutation heuristics

```dot
fetch_data [type="tool" governance="reversible"
            label="Fetch project state"
            output_key="project_state"
            output_format="json"
            outputs="open_count,closed_count"
            prompt="hatch-ops project state --repo '${gh_repo}'"
            trust_domain="factory.local" trust_role="factory.local.tool"]
```

### assert
Runs a shell command and checks the exit code. Fails the pipeline if assertion doesn't hold.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Shell command to test |
| `expect` | no | `"success"` (default, exit 0) or `"failure"` (non-zero) |
| `fail_message` | no | Custom error message on assertion failure |

```dot
check_clean [type="assert"
             label="Verify working tree clean"
             prompt="git status --porcelain | wc -l | grep -q '^0$'"
             fail_message="Working tree has uncommitted changes"]
```

### codergen
Single-shot LLM call with read-only tools. For analysis, judgment, and text generation.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | LLM instruction |
| `output_key` | yes | Context key for LLM response |
| `output_format` | no | `"json"` to parse response as JSON |
| `outputs` | no | Keys extracted from JSON |
| `llm_model` | no | Override model (otherwise from stylesheet) |
| `llm_provider` | no | Override provider |
| `reasoning_effort` | no | `"low"`, `"medium"`, `"high"` |
| `timeout` | no | Max execution time (e.g., `"2m"`, `"10m"`) |
| `session_id` | no | Share LLM session across nodes |
| `class` | no | CSS class for stylesheet model selection |
| `scenarios` | no | Scenario identifiers (for judge nodes) |
| `judge` | no | `"true"` to mark as judge node |
| `objective_id` | no | Judgment objective identifier |

```dot
analyze [label="Analyze codebase"
         output_key="analysis"
         output_format="json"
         outputs="summary,risks,recommendations"
         reasoning_effort="medium"
         timeout="5m"
         prompt="Analyze the codebase structure and return JSON."]
```

### stack.manager_loop
Full agentic LLM session with coding tools (read, edit, bash). The LLM controls
the tool loop until it decides it's done.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Task instruction |
| `llm_model` | no | Override model |
| `llm_provider` | no | Override provider |
| `workdir` | no | Working directory for tools |
| `timeout` | no | Max wall-clock time |

Use for complex multi-step operations where the LLM needs to explore, decide, and act.
Reasoning effort is always "high."

```dot
supervisor_review [type="stack.manager_loop"
                   label="Supervisor hygiene review"
                   workdir="${repo}"
                   timeout="15m"
                   prompt="Load skills/supervisor/SKILL.md and process action items.\n\n${state_snapshot}"]
```

### agent.worktree
Coding agent in an isolated git worktree. Persistent session across retries.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Build instruction |
| `repo` | yes | Absolute path to git repo (supports `${variable}`) |
| `branch` | yes | Branch name for worktree |
| `base` | no | Base branch (default: `"main"`) |
| `timeout` | no | Max time (default: `"4h"`) |
| `skip_prompt_if_commits_exist` | no | Skip re-prompt if branch has commits (default: `"true"`) |
| `session_id` | no | Persistent session ID |
| `cleanup_on_success` | no | Remove worktree after success (default: `"false"`) |

Exports to parent context: `commits_created`, `files_changed`, `current_branch`, `git_log`.

```dot
build [type="agent.worktree"
       label="Implement feature"
       repo="${repo}"
       branch="${branch}"
       timeout="60m"
       skip_prompt_if_commits_exist="false"
       session_id="${agent_session_id}"
       prompt="Implement issue #${issue_number}: ${issue_title}\n\n${issue_body}"]
```

### agent.kw
Lightweight knowledge worker agent. Full tools, no worktree isolation.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Task instruction |
| `session_id` | no | Persistent session ID |
| `llm_model` | no | Override model |
| `workdir` | no | Working directory |

Like `stack.manager_loop` but with persistent session support. Good for analysis tasks
that don't need git isolation.

### wait.human
Pauses pipeline for human input. Prompts on stdout, reads from stdin.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `prompt` | yes | Question to ask the human |

Returns `Completed` if human approves (y/yes), `Failed` if denied.

## Composition handlers

### pipeline
Invokes another DOT file as a child pipeline.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `pipeline` | yes | Path to child DOT file (**repo-root-relative**) |
| `inherit_context` | no | `"true"` to pass parent context to child |
| `export_keys` | no | Comma-separated keys to copy back from child |

**Critical:** Paths must be relative to the repo root, not to the parent graph's directory.

```dot
execute_item [type="pipeline"
              label="Execute work item"
              pipeline="factories/my-factory/graphs/work_item.dot"
              inherit_context="true"
              export_keys="result,status"]
```

### fan_out.dynamic / fan_in.dynamic
Parallel batch processing. Reads a JSON array, runs a child pipeline per item.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `source_key` | yes | Context key containing JSON array |
| `template` | yes | Path to child DOT template (**repo-root-relative**) |
| `item_key` | no | Context key name per child (default: `"item"`) |
| `max_concurrency` | no | Max parallel runs (0 = unlimited) |
| `export_keys` | no | Keys to export from each child |

`fan_in.dynamic` is a pass-through marker — it must immediately follow the fan_out node.

```dot
fan_out [type="fan_out.dynamic"
         label="Process items"
         source_key="items"
         item_key="current_item"
         template="factories/my-factory/graphs/process_item.dot"
         max_concurrency="3"
         export_keys="item_result"]

fan_in [type="fan_in.dynamic"
        label="Collect results"
        output_key="all_results"]

fan_out -> fan_in
```

### parallel / parallel.fan_in
Static parallel execution. Less commonly used — prefer `fan_out.dynamic` for most cases.
