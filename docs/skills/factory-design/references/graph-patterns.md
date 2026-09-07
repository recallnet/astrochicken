---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Common Graph Patterns Reference."
tags: [docs, factory-design, reference, skill, skills]
written: "2026-03-06"
---
# Common Graph Patterns Reference

Reusable patterns for structuring factory graphs.

## 1. Diamond gate (conditional routing)

The most common pattern. A tool node computes a value, a diamond gate routes based on it.

```dot
check_status [type="tool" governance="reversible"
              label="Check work status"
              output_key="work_status"
              prompt="node ops/cli.mjs work run --op check-status --id '${work_id}'"
              trust_domain="f.l" trust_role="f.l.tool"]

status_gate [shape=diamond label="Work status?"]

check_status -> status_gate
status_gate -> process [condition="work_status=ready"]
status_gate -> wait [condition="work_status=pending"]
status_gate -> done [condition="work_status=complete"]
```

**Best practices:**
- Cover all possible values with outgoing edges
- Include a fallback edge for unexpected values (`condition="status!=ready && status!=pending"`)
- Label the diamond node with a question

## 2. Retry loop with bounded attempts

Build → Review → Retry pattern with a counter to prevent infinite loops.

```dot
// Retry counter increment (deterministic)
increment_retry [type="tool" governance="reversible"
                 label="Increment retry counter"
                 output_key="retry_count"
                 prompt="node ops/cli.mjs common run --op increment --value '${retry_count}' --max '3'"
                 trust_domain="f.l" trust_role="f.l.tool"]

build [type="agent.worktree"
       label="Build feature"
       // ... attributes ...
       prompt="...${review_notes}..."]

review [label="Review implementation"
        output_key="review_result"
        output_format="json"
        outputs="verdict,review_notes"
        prompt="Review the implementation..."]

review_gate [shape=diamond label="Review verdict?"]
retry_gate [shape=diamond label="Retries remaining?"]

build -> review -> review_gate
review_gate -> done [condition="verdict=approve"]
review_gate -> increment_retry [condition="verdict=revise"]
increment_retry -> retry_gate
retry_gate -> build [condition="retry_count<3"]
retry_gate -> give_up [condition="retry_count>=3"]
```

**Key points:**
- The counter is a deterministic tool node (never let the LLM count retries)
- Review notes flow back to the builder via `${review_notes}`
- Give-up path handles exhausted retries (file a bug, quarantine, etc.)

## 3. Fan-out batch processing

Process a list of items in parallel with configurable concurrency.

```dot
enumerate [type="tool" governance="reversible"
           label="List work items"
           output_key="items"
           prompt="node ops/cli.mjs work run --op list --state 'ready'"
           trust_domain="f.l" trust_role="f.l.tool"]

fan_out_items [type="fan_out.dynamic"
               label="Process items in parallel"
               source_key="items"
               item_key="current_item"
               template="graphs/process_item.dot"
               max_concurrency="3"
               export_keys="item_result"
               trust_domain="f.l" trust_role="f.l.fan_out"]

fan_in_items [type="fan_in.dynamic"
              label="Collect results"
              output_key="all_results"
              trust_domain="f.l" trust_role="f.l.fan_in"]

enumerate -> fan_out_items -> fan_in_items -> post_process
```

**Key points:**
- `source_key` must contain a JSON array in the context
- Each child pipeline receives `${current_item}` (the item_key)
- `fan_in` must immediately follow `fan_out`
- `max_concurrency="0"` means unlimited parallel
- Child pipelines are fully isolated (unless `inherit_context="true"` on template)

## 4. Shared LLM session across nodes

Multiple codergen nodes sharing context to avoid redundant codebase exploration.

```dot
analyze [label="Analyze project"
         session_id="project_analysis"
         output_key="analysis"
         output_format="json"
         outputs="summary,risks"
         prompt="Analyze the project structure..."]

propose [label="Propose changes"
         session_id="project_analysis"
         output_key="proposal"
         output_format="json"
         outputs="changes,rationale"
         prompt="Based on your analysis, propose changes..."]

review [label="Review proposal"
        session_id="project_analysis"
        output_key="review_result"
        output_format="json"
        outputs="approved,review_notes"
        prompt="Review the proposed changes for completeness..."]

analyze -> propose -> review
```

**Key points:**
- Same `session_id` means the LLM keeps conversational context
- Avoids re-exploring the codebase in each node
- Good for multi-step analysis pipelines
- Session is in-memory per run (not persisted across runs)

## 5. Deterministic skill loading

Load a skill document via tool node, inject into LLM prompt via variable.

```dot
load_skill [type="tool" governance="reversible"
            label="Load review skill"
            output_key="skill_doc"
            prompt="cat skills/code_review/SKILL.md"
            trust_domain="f.l" trust_role="f.l.tool"]

review [label="Review code"
        output_key="review_result"
        output_format="json"
        outputs="verdict,notes"
        prompt="Follow these instructions:\n${skill_doc}\n\nReview the code..."]

load_skill -> review
```

**Why not let the LLM read the file itself?**
The codergen handler's output extraction returns empty string when the LLM's last message
is a tool call. If the prompt says "use read to load file X," the LLM might end with
a tool call instead of text output. Loading deterministically via tool node and injecting
via `${variable}` is reliable.

## 6. Bug fast-route

Check for critical issues before doing normal work. If bugs exist, fix them first.

```dot
check_bugs [type="tool" governance="reversible"
            label="Check for open bugs"
            output_key="bug_check"
            output_format="json"
            outputs="has_bugs,bug_count"
            prompt="node ops/cli.mjs bugs run --op check --repo '${gh_repo}'"
            trust_domain="f.l" trust_role="f.l.tool"]

bug_gate [shape=diamond label="Open bugs?"]

fix_bugs [type="stack.manager_loop"
          label="Fix critical bugs"
          timeout="15m"
          prompt="Fix the following bugs...\n${bug_batch}"]

check_bugs -> bug_gate
bug_gate -> fix_bugs [condition="has_bugs=true"]
bug_gate -> normal_work [condition="has_bugs!=true"]
fix_bugs -> normal_work
```

**Key points:**
- Bugs get priority over new work
- Fix path rejoins the normal flow after bugs are handled
- Bounded timeout on bug fixing to prevent stalling

## 7. Lease-gated execution

Distributed concurrency control via external lease system.

```dot
acquire_lease [type="tool" governance="irreversible"
               label="Acquire execution lease"
               output_format="json"
               outputs="lease_acquired,lease_token,lease_expires"
               prompt="node ops/cli.mjs lease run --op acquire --name 'wave_dispatch'"
               trust_domain="f.l" trust_role="f.l.tool"]

lease_gate [shape=diamond label="Lease acquired?"]

release_lease [type="tool" governance="irreversible"
               label="Release execution lease"
               output_key="__release_result"
               prompt="node ops/cli.mjs lease run --op release --token '${lease_token}'"
               trust_domain="f.l" trust_role="f.l.tool"]

acquire_lease -> lease_gate
lease_gate -> do_work [condition="lease_acquired=true"]
lease_gate -> done [condition="lease_acquired!=true"]
do_work -> release_lease -> done
```

**Key points:**
- Always release the lease on all terminal paths (success AND failure)
- Lease prevents multiple factory instances from doing the same work
- If lease not acquired, skip gracefully (next tick will try again)

## 8. Snapshot / revert for safe iteration

Protect prior work on a shared branch when trying risky operations.

```dot
snapshot [type="tool" governance="reversible"
          label="Snapshot HEAD before build"
          output_key="snapshot_sha"
          prompt="git -C '${worktree_dir}' rev-parse HEAD"
          trust_domain="f.l" trust_role="f.l.tool"]

build [type="agent.worktree" ...]

review [label="Review" ...]

review_gate [shape=diamond label="Approved?"]

revert [type="tool" governance="irreversible"
        label="Revert to snapshot"
        output_key="__revert_result"
        prompt="git -C '${worktree_dir}' reset --hard '${snapshot_sha}'"
        trust_domain="f.l" trust_role="f.l.tool"]

snapshot -> build -> review -> review_gate
review_gate -> next_item [condition="verdict=approve"]
review_gate -> revert [condition="verdict!=approve && retries_exhausted=true"]
revert -> next_item
```

**Key points:**
- Snapshot captures HEAD before each risky operation
- On terminal failure, revert to snapshot to protect other work on the branch
- Only revert when retries are exhausted (give the builder a chance to fix)

## 9. Post-execution health check

After the main production line, check for problems before closing.

```dot
// After fan_in collects all results
detect_stalled [type="tool" governance="reversible"
                label="Detect stalled work"
                output_key="stalled_check"
                output_format="json"
                outputs="has_stalled,stalled_items"
                prompt="node ops/cli.mjs health run --op check-stalled --repo '${gh_repo}'"
                trust_domain="f.l" trust_role="f.l.tool"]

health_gate [shape=diamond label="Stalled work?"]

diagnose [type="tool" governance="irreversible"
          label="Diagnose and report stalled work"
          output_key="__diagnosis"
          prompt="node ops/cli.mjs health run --op diagnose --items '${stalled_items}'"
          trust_domain="f.l" trust_role="f.l.tool"]

fan_in -> detect_stalled -> health_gate
health_gate -> diagnose [condition="has_stalled=true"]
health_gate -> done [condition="has_stalled!=true"]
diagnose -> done
```
