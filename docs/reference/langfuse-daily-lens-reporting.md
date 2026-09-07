---
doc_type: "reference"
owner: "hatch-observability"
review_policy: "periodic-7"
reviewed: "2026-03-22"
status: "active"
summary: "Daily Lens reporting contract: Langfuse API usage, rolling-window report assembly, daemon-native scheduling, and operator verification steps."
tags: [daemon, daily-lens, langfuse, reporting, scheduling]
written: "2026-03-15"
---
# Langfuse Daily Lens Reporting

This document describes the implemented Daily Lens reporting path for
`astrochicken`: how Langfuse is queried, what data is collected, how the report
is compiled, and how the daemon schedules it.

## Implemented API Usage

The Langfuse collector now uses the current public API surface on the configured
base URL.

Auth:

- `Basic base64(LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY)`

Runtime endpoint used by the collector:

- `GET /api/public/traces`
  - query: `fromTimestamp`, `toTimestamp`, `limit`, `page`
  - purpose: rolling-window trace collection for the Daily Lens data bundle

Supporting endpoints verified during design validation:

- `GET /api/public/observations`
  - useful for deeper model/prompt/node drilldown
- `GET /api/public/sessions`
  - useful for session-level rollups
- `GET /api/public/scores`
  - available, but currently low-signal for this project because quality is
    mostly present on trace metadata

## Information Collected

The implemented collector normalizes Langfuse trace rows into:

- `id`, `timestamp`, `name`
- `skill`, `model`, `graph_id`, `phase`, `factory_id`
- `tokens_total`, `cost_usd`, `duration_ms`
- `event_kind`
- `judgeContextScopeIdentity`

It also derives:

- total trace count
- total token count
- total reported cost
- grouped rollups by skill, model, abstraction level, graph, and phase
- sampled trace ids and scope identities for deterministic evidence

The broader Daily Lens bundle still combines Langfuse with:

- GitHub issue and PR state
- Git history
- Hatch run artifacts
- supervisor status

## Report Assembly

The scheduled report pipeline is:

1. The daemon evaluates configured cron jobs from `factory.config.json`.
2. When the `daily-lens` job is due, it computes a trailing 24-hour window
   ending at the scheduled slot.
3. The daemon dispatches `factories/mothership/graphs/daily_lens_publish.dot`
   through `hatch run ... --live`.
4. The graph prepares a deterministic bundle on disk, runs the Daily Lens
   analysis under `agent.kw`, then finalizes the dated artifacts:
   - `reports/lens/YYYY-MM-DD.json`
   - `reports/lens/YYYY-MM-DD.md`
   - `reports/lens/insights-latest.json`
5. The finalizer checks for an existing GitHub issue titled
   `Daily Lens Report — YYYY-MM-DD`.
6. If no matching issue exists, it creates one in the configured repo using the
   rendered markdown artifact as the issue body.
7. If Slack delivery is enabled, it sends a compact message containing:
   - the issue link
   - the top 1-2 normalized findings (`observation`, with `title` fallback)
   - the top suggested experiment from meta-reflection

## Daemon Scheduling Contract

Factory config now supports daemon-native scheduled jobs under `schedules.jobs`.

Current first job:

```json
{
  "id": "daily-lens",
  "type": "graph",
  "graph": "factories/mothership/graphs/daily_lens_publish.dot",
  "cron": "45 8 * * *",
  "time_zone": "America/Denver",
  "catch_up": true,
  "report_window_hours": 24,
  "repo": "recallnet/astrochicken",
  "output_dir": "reports/lens",
  "notify_slack": true,
  "issue_labels": ["daily-lens", "report"]
}
```

Behavior:

- schedule is evaluated inside the daemon loop, not by OS cron
- one run per scheduled slot
- if the daemon misses `08:45 America/Denver`, it catches up on the next healthy
  loop and still uses the missed slot as the window end
- state is persisted at:
  - `~/.hatch-hosts/<factory-id>/tmp/scheduled-jobs-state.json`

The `daily-lens` job above is wired in
`factories/mothership/factory.config.json` under `schedules.jobs`.

## Deterministic Operator Verification (Launchd)

Use this sequence before the first scheduled run and when troubleshooting.

1. Confirm launchd daemon is active:
   - `launchctl list | grep factory-daemon`
2. Confirm required Daily Lens env vars are present in daemon-visible env files:
   - `LANGFUSE_PUBLIC_KEY`
   - `LANGFUSE_SECRET_KEY`
   - `MOTHERSHIP_SLACK_WEBHOOK_URL` (or `FACTORY_SLACK_WEBHOOK_URL`)
   - source locations loaded by daemon:
     - `<repo>/.env`
     - `~/.hatch-hosts/.env.d/<owner>/<repo>.env`
   - the daemon logs each loaded file via `env_loaded path=...` in
     `~/.hatch-hosts/<factory-id>/logs/daemon.log`
3. Snapshot schedule state before 08:45 Denver:
   - `hatch-ops factory scheduled-jobs-status --factory-id mothership --json`
4. After 08:45 Denver, verify slot execution state:
   - `hatch-ops factory scheduled-jobs-status --factory-id mothership --json`
   - expect `jobs[].last_status="ok"` for `daily-lens` and
     `jobs[].last_issue_url` set when issue publish succeeded
5. If status is blocked/failed, inspect failure category from persisted state:
   - file: `~/.hatch-hosts/<factory-id>/tmp/scheduled-jobs-state.json`
   - `last_error_code` values include deterministic categories such as:
     - `missing_langfuse_credentials`
     - `missing_slack_webhook`
     - `slack_http_*`

## Expected Output Shape

### GitHub issue

`runAnalysisPublishLens(...)` publishes a dated issue with this contract:

- title format: `Daily Lens Report — YYYY-MM-DD`
- labels: `daily-lens`, `report` (plus optional extras)
- body source: rendered markdown artifact from `reports/lens/YYYY-MM-DD.md`
- issue semantics: create if missing, update existing open issue, reopen+update
  existing closed issue for same date

Expected operator-usable sections in body:

- summary of the covered report window (24h trailing window)
- top findings and evidence-backed observations
- trend/quality notes and instrumentation gaps
- experiment or follow-up suggestions from meta-reflection

### Slack payload

When `notify_slack=true`, scheduled publish sends a compact summary containing:

- report date and repo context
- GitHub issue link
- top findings (1-2 highlights)
- top suggested experiment/follow-up from meta-reflection

## Daily Lens action registry v2 (follow-up candidate contract)

Follow-up candidate generation now reads canonical `action_registry` entries
from the normalized v2 report shape.

Required per-entry fields:

- `id` (stable action id)
- `type`
- `title`
- `why_now`
- `success_metric`
- `evidence_links` (array)
- `dependency_hints` (array)

Small example:

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

Mapping into candidate issue body:

- `why_now` and `success_metric` are rendered as dedicated sections
- `evidence_links` are rendered as evidence bullets
- `dependency_hints` are rendered as dependency bullets

Migration note:

- `action_registry` is preferred and validated deterministically when present.
- Legacy `suggestions` remains as a temporary fallback for in-flight reports.

## Daily Lens contract v2 normalization (finding + trend discipline)

`analysis lens` and `analysis lens-finalize` now normalize the report payload to
`daily_lens_contract.v2` before rendering and follow-up candidate processing.

Normalized finding shape (canonical):

```json
{
  "finding_id": "finding_4ef4d295b89f7d8a",
  "observation": "Review-stage retries increased from 4 to 11.",
  "inference": "Timeout budget likely underestimates long-context reviews.",
  "action": "Increase review timeout and add retry-budget regression coverage.",
  "candidate_type": "task",
  "candidate_work_item_type": "task",
  "impact": "higher queue churn",
  "priority": "high",
  "confidence": "medium",
  "trend_key": "review_retry_spike",
  "trend_type": "window_comparison",
  "window": {
    "start": "2026-03-15T14:45:00.000Z",
    "end": "2026-03-16T14:45:00.000Z",
    "comparison_start": "2026-03-14T14:45:00.000Z",
    "comparison_end": "2026-03-15T14:45:00.000Z"
  },
  "evidence_links": ["langfuse.trace:abc"]
}
```

Trend downgrade rule:

- If a trend/finding lacks a valid comparison window
  (`start`, `end`, `comparison_start`, `comparison_end`), normalization marks it
  as `trend_type: "first_observation"` and emits a deterministic
  `trend_rationale`.
- This avoids implied motion claims from single-window snapshots.

Example first-observation trend entry:

```json
{
  "trend_key": "review_retry_spike",
  "label": "Review retry spike",
  "bucket": "degrading",
  "trend_type": "first_observation",
  "first_observation": true,
  "trend_rationale": "Trend review_retry_spike has no comparison window; treating as first observation."
}
```

## Operational Meaning

What is meaningful today:

- trace volume and active graph mix
- quality score distribution and failure classes
- factory/node hot spots
- model/provider usage where present
- whether telemetry coverage is missing or partial

What remains partial:

- cost is only as good as Langfuse cost metadata; current project data often
  reports zero cost
- prompt-level reporting is still sparse where prompt identity is not attached
  to the emitted event
- deeper observation-level rollups are available from the API but are not yet
  part of the default scheduled report

## Manual Usage

You can run the publication path directly:

```bash
hatch-ops analysis publish-lens \
  --date 2026-03-15 \
  --repo recallnet/astrochicken \
  --factory-id mothership \
  --window-start 2026-03-14T14:45:00.000Z \
  --window-end 2026-03-15T14:45:00.000Z \
  --notify-slack
```

This remains the manual compatibility path. The daemon-native scheduled job now
dispatches the Hatch graph `factories/mothership/graphs/daily_lens_publish.dot`
instead of calling `analysis publish-lens` directly.
