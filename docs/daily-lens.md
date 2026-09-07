---
doc_type: "vision"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "V0 plan for the Daily Lens — an AI-powered factory self-improvement analysis command."
tags: [analysis, lens, meta-loop, self-improvement]
written: "2026-03-13"
---
# Daily Lens: Factory Self-Improvement Loop (V0)

This is the canonical Daily Lens plan doc. It supersedes the removed
`docs/daily-lens-plan.md` path, which was dropped to comply with docs policy.

## Problem

The factory produces rich telemetry (Langfuse traces, GitHub state, run artifacts, alignment summaries, agent learnings) but nobody systematically analyzes this data for self-improvement insights. The existing `hatch-ops analysis daily-report` provides operational status (what happened?) but doesn't answer the strategic question: **what should we change?**

## Approach

A new command — `hatch-ops analysis lens` — that collects all available factory data, makes two sequential AI calls (analysis + meta-reflection), writes structured outputs, and optionally posts to Slack.

**Not a factory** (yet). We don't know what analysis patterns are valuable. A flexible AI call discovers that; a factory formalizes it later.

## What Exists Today (Reuse)

| Piece                                                                      | Status              | Location                                                      |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| Data collector composition                                                | Built               | `packages/factory-ops/src/lib/analysis/collectors.mjs`        |
| GitHub collector                                                          | Built               | `packages/github-adapter/src/daily-lens-github-state.mjs`     |
| Langfuse collectors                                                       | Built               | `packages/factory-telemetry/src/daily-lens-langfuse*.mjs`     |
| `collectDailyInsightData()` — parallel aggregation                         | Built               | Same file, L137                                               |
| Report renderer (JSON → Markdown)                                          | Built               | `packages/factory-ops/src/lib/analysis/renderer.mjs`          |
| Self-improvement suggestion registry                                       | Scaffolded          | `reports/analysis-learnings.json`                             |
| Learning log helpers                                                       | Built               | `packages/factory-ops/src/lib/analysis/learning-log.mjs`      |
| AGENT-LEARNINGS.md (optional learning log read from the analyzed repo)      | Optional input      | Root of the analyzed repo, when present                       |
| Slack webhook posting + retry                                              | Built               | `packages/factory-ops/src/commands/release-post-to-slack.ts` |
| Example Web InsightsPanel UI (demo data only)                                  | Built               | `example-org/example-web` repo                                      |

## Architecture

```
┌──────────────────────────────────────────────┐
│  hatch-ops analysis lens --date YYYY-MM-DD   │
├──────────────────────────────────────────────┤
│                                              │
│  1. COLLECT (deterministic, parallel)        │
│     ├─ collectDailyInsightData() [existing]  │
│     ├─ AGENT-LEARNINGS.md (last 7 days)      │
│     ├─ Past lens outputs (last 3 days)       │
│     └─ analysis-learnings.json (pending)     │
│                                              │
│  2. ANALYZE (AI call #1)                     │
│     ├─ Multi-elevation prompt                │
│     ├─ AI chooses focus based on data        │
│     └─ Structured JSON output                │
│                                              │
│  3. META-REFLECT (AI call #2)                │
│     ├─ Feed analysis output back             │
│     ├─ "What data would you have wanted?"    │
│     ├─ "What analysis couldn't you do?"      │
│     ├─ "What questions for next time?"       │
│     └─ "What experiments to try?"            │
│                                              │
│  4. WRITE (deterministic)                    │
│     ├─ reports/lens/YYYY-MM-DD.json          │
│     ├─ reports/lens/YYYY-MM-DD.md            │
│     ├─ reports/lens/insights-latest.json     │
│     └─ Update analysis-learnings.json        │
│                                              │
│  5. NOTIFY (optional --notify-slack)         │
│     └─ Compact Slack message with top        │
│        findings + meta-reflection highlight  │
│                                              │
└──────────────────────────────────────────────┘
```

## Multi-Elevation Framework

The prompt defines 5 analysis elevations. The AI decides where to focus based on data richness — no fixed template forcing analysis at every level every day.

| Elevation            | What it covers                                                | Example insight                                         |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| 0 — Component        | Specific skills, prompts, handlers                            | "code_review first-attempt pass rate dropped to 0.4"    |
| 1 — Pipeline Stage   | Decompose, execute, review, merge phases                      | "Review stage retries cluster around timeout errors"    |
| 2 — Factory Instance | Mothership supervisor tick health, goal flow, wave throughput | "Goals stall at decomposition for >30 min on average"   |
| 3 — Factory Model    | Architectural patterns, state machine design, guard policies  | "Wave dispatch model creates unnecessary serialization" |
| 4 — Meta-Loop        | Self-improvement process itself, past lens effectiveness      | "Elevation 0 insights have been most actionable so far" |

## Output Schema

```json
{
  "date": "2026-03-14",
  "window": { "start": "...", "end": "..." },
  "focus_choices": {
    "prioritized_elevations": ["component", "pipeline_stage"],
    "deprioritized_elevations": ["factory_model"],
    "reasoning": "..."
  },
  "executive_summary": {
    "headline": "...",
    "subheadline": "...",
    "summary": "...",
    "what_changed_today": "...",
    "primary_recommendation": "...",
    "finding_count": 3,
    "action_count": 2
  },
  "key_metrics": [{
    "name": "Shipped work",
    "value": "4 issues · 2 merges",
    "trend": "up",
    "assessment": "good",
    "note": "up from prior window"
  }],
  "findings": [{
    "elevation": "component",
    "title": "...",
    "confidence": "high|medium|low",
    "evidence": [...],
    "recommendation": "...",
    "suggested_action": {
      "type": "skill_change|config_change|architecture_change|process_change",
      "target": "...",
      "detail": "..."
    }
  }],
  "trends": {
    "improving": [...],
    "degrading": [...],
    "stable": [...]
  },
  "action_registry": [{
    "id": "lens-2026-03-14-001",
    "type": "task",
    "title": "...",
    "summary": "...",
    "why_now": "...",
    "success_metric": "...",
    "recommendation": "...",
    "evidence_links": [...],
    "dependency_hints": [...],
    "execution_owner": "supervisor_on_main|wave_builder"
  }],
  "meta_reflection": {
    "data_quality_notes": "...",
    "blind_spots": "...",
    "prompt_effectiveness": "...",
    "missing_data": ["..."],
    "suggested_experiments": ["..."],
    "questions_for_next_time": ["..."]
  },
  "shaping_insights": [{
    "id": "...",
    "category": "pipeline|testing|shaping|patterns",
    "recommendation": "...",
    "evidence": "...",
    "affectedGoals": [...],
    "actionLabel": "..."
  }]
}
```

## Files to Create

```
packages/factory-ops/src/commands/analysis/lens.mjs           -- Command + orchestration
packages/factory-ops/src/lib/analysis/lens-collector.mjs       -- Extended data collector
packages/factory-ops/src/lib/analysis/lens-prompt-builder.mjs  -- Prompt assembly
packages/factory-ops/src/lib/analysis/lens-slack-blocks.mjs    -- Slack Block Kit payload
packages/factory-ops/src/lib/analysis/llm-call.mjs             -- Raw Anthropic API wrapper
docs/skills/daily-lens/SKILL.md                                -- Skill contract
docs/skills/daily-lens/templates/lens-prompt.md                -- Analysis prompt template
docs/skills/daily-lens/templates/meta-reflection-prompt.md     -- Meta-reflection prompt
docs/skills/daily-lens/templates/report-sections.md            -- Heading contract
```

## Files to Modify

```
packages/factory-ops/src/cli/index.mjs                        -- Register AnalysisLensCommand
```

## Implementation Details

### LLM Call Wrapper (`llm-call.mjs`)

Raw `fetch` wrapper with provider selection from environment — no SDK dependency.
Supports OpenRouter, Anthropic, and OpenAI using the same `fetchFn` DI pattern as
`collectLangfuse()` and `postReleaseToSlack()`. The scheduler blocks publication
unless at least one of `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or
`OPENAI_API_KEY` is available. Returns structured JSON output for both analysis
and meta-reflection calls.

### Extended Collector (`lens-collector.mjs`)

Calls `collectDailyInsightData()` for the 5 standard sources, then additionally reads:

- **AGENT-LEARNINGS.md**: Split on `### YYYY-MM-DD` headings, filter to last 7 days
- **Past lens outputs**: `reports/lens/{date-1..date-3}.json` (skip missing)
- **Pending suggestions**: `getPendingSuggestions()` from `learning-log.mjs`
- **LLM inventory**: `factories/{factoryId}/inventory/llm-role-session-baseline.json`
- **Goal-decomposition timeout inventory** (mothership): `factories/mothership/inventory/goal-decomposition-timeouts.json`

### Prompt Templates (in `docs/skills/daily-lens/templates/`)

Stored as markdown files, loaded at runtime, interpolated with data. Editable without code changes and subject to docs governance gates.

**Analysis prompt**: Role definition, elevation taxonomy, output schema, evidence requirements, instructions to flag what was skipped and why.

**Meta-reflection prompt**: Four questions asking the AI to critique its own analysis and propose improvements to the lens process itself.

### Command (`lens.mjs`)

Clipanion command at `static paths = [["analysis", "lens"]]`. Follows `daily-report.mjs` patterns for CLI options, DI test harness, and error handling.

CLI options: `--date`, `--repo`, `--factory-id` (default: mothership), `--output-dir` (default: reports/lens), `--notify-slack`, `--model` (default: claude-sonnet-4-6), `--log-level`.

Fail-open on LLM errors: writes collected data with error annotation rather than throwing.

### Example Web Integration

Writes `reports/lens/insights-latest.json` containing the `shaping_insights` array, formatted to match the example-web repo's `Insight` TypeScript type. The example-web repo can serve this file directly to populate the InsightsPanel with live data (replacing `DEMO_INSIGHTS`).

## Report quality contract

The GitHub issue body is the primary operator surface, so the report should read
like a concise internal brief:

- headline + subheadline
- short executive summary
- KPI table near the top
- findings written in plain English with consequence and response
- a small number of candidate issues, each concrete and evidence-backed
- appendices/details collapsed so raw collector noise does not dominate the body

Daily Lens is intentionally fail-soft. Collector degradation, weak candidate
issues, or partial prompt noncompliance should produce a degraded report and
skip low-quality follow-ups; they should not halt the factory tick.

## Automation Timeline

1. **Week 1**: Manual — run by hand, read the output, discuss
2. **Week 2**: Daemon-native scheduled publication at `08:45 America/Denver`
   over the trailing 24 hours
3. **Week 3+**: Iterate based on what we learn from meta-reflections

Current shipped publication path:

- graph-native runtime at `factories/mothership/graphs/daily_lens_publish.dot`
- deterministic setup/finalize commands:
  - `hatch-ops analysis lens-prepare`
  - `hatch-ops analysis lens-finalize`
- daemon-native scheduler wired in
  `factories/mothership/factory.config.json` under `schedules.jobs`
- GitHub issue publication with `daily-lens` / `report` labels
- post-publication candidate issue generation from `action_registry` (v2 canonical):
  - required action entry fields: `type`, `title`, `why_now`, `success_metric`, `evidence_links`, `dependency_hints` (with stable `id`)
  - candidate title format: `Daily Lens Candidate — YYYY-MM-DD — <action-id>`
  - labels: `daily-lens`, `daily-lens-candidate`, plus trace label `daily-lens-<action-id>`
  - candidate body maps v2 fields directly (`why_now`, `success_metric`, evidence links, dependency hints) and includes provenance metadata (`origin_report_number`, `origin_report_date`, `lens_suggestion_id`, `lens_run_id`)
  - each candidate is linked as a sub-issue of the daily report issue
  - candidates are intentionally non-executable until an operator reviews/prunes and promotes the parent report (do not add `goal`/`ready` to candidates)
  - migration note: legacy `suggestions` remains supported as a temporary fallback during rollout; `action_registry` is preferred and enforced when present
- Slack delivery using the existing factory webhook contract

## Scheduled Daily Lens Validation Runbook

### First automated run checklist (08:45 America/Denver)

1. Ensure daemon is running under launchd.
2. Verify Daily Lens credentials are available to daemon-loaded env files:
   - `LANGFUSE_PUBLIC_KEY`
   - `LANGFUSE_SECRET_KEY`
   - one of `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`
   - `MOTHERSHIP_SLACK_WEBHOOK_URL` (or `FACTORY_SLACK_WEBHOOK_URL`)
3. Before the run window, capture status snapshots:
   - `hatch-ops factory status --factory-id mothership --json`
   - `hatch-ops factory tick-status --factory-id mothership`
   - `hatch-ops factory scheduled-jobs-status --factory-id mothership --json`
4. After 08:45 Denver, validate the scheduled job ledger:
   - `hatch-ops factory scheduled-jobs-status --factory-id mothership --json`
   - confirm `daily-lens` shows `last_status: "ok"`
   - confirm `last_issue_url` is present
5. Open the published issue and verify:
   - title format `Daily Lens Report — YYYY-MM-DD`
   - labels include `daily-lens` and `report`
   - body includes top findings and experiment context
6. Verify Slack summary delivery:
   - message contains the issue link
   - message includes high-level findings (top 1-2)

### Daily operator checks

- `hatch-ops factory scheduled-jobs-status --factory-id mothership`
  - confirm next slot and most recent status
- confirm new/updated Daily Lens issue exists for the date
- confirm Slack summary posted with issue link
- record any instrumentation gaps from the report in follow-up tracking

### Failure triage

If scheduled publish is not green:

- inspect `~/.hatch-hosts/<factory-id>/tmp/scheduled-jobs-state.json`
  for `last_error_code` and `last_error`
- inspect daemon logs:
  - `~/.hatch-hosts/<factory-id>/logs/daemon.log`
  - `~/.hatch-hosts/<factory-id>/logs/tick-*.log`
- expected deterministic failure categories include:
  - `missing_langfuse_credentials`
  - `missing_analysis_runtime`
  - `missing_slack_webhook`
  - `slack_http_*`

Reference docs:

- [Langfuse Daily Lens Reporting](./reference/langfuse-daily-lens-reporting.md)

Example v2 action registry snippet:

```json
{
  "action_registry": [
    {
      "id": "lens-2026-03-16-001",
      "type": "task",
      "title": "Add lease-chaos regression coverage",
      "summary": "Add deterministic lease-chaos regression coverage",
      "why_now": "Lease churn recurred across the latest comparison window.",
      "success_metric": "Regression suite passes for three consecutive daily windows.",
      "evidence_links": ["langfuse.trace:123"],
      "dependency_hints": ["Coordinate with retry-budget telemetry update"]
    }
  ]
}
```

## Relationship to Existing Systems

- **Daily Analysis** (`hatch-ops analysis daily-report`): Operational report (what happened?). The lens is strategic (what should we change?). Complementary — the lens can consume the daily analysis as an input.
- **Phase 3 Roadmap** (Self-Improvement meta-loop): The lens is a lightweight precursor. When we see stable patterns, we formalize into the Phase 3 factory with safety ratchets and automatic proposal application.
- **Example Web Insights**: The lens produces the data; example-web visualizes it. Loose coupling via file-based `Insight` contract.
