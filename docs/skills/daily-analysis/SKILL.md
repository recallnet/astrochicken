---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-22"
status: "active"
summary: "Skill contract for daily analysis reports, evidence requirements, and self-improvement tracking."
tags: [analysis, daily, learnings, reporting, skill]
written: "2026-03-07"
name: "daily-analysis"
description: "Use this skill when producing or validating the daily analysis report and its self-improvement artifacts."
---
# Daily Analysis Skill

Use this skill to produce a daily report that is decision-ready, evidence-backed, and self-improving.

## Required investigation domains

Every report must explicitly investigate these domains:

1. **Cost reasonableness**
   - Are observed costs proportional to outcomes?
   - Which traces/runs are the main cost drivers?
2. **Failure patterns (visible + hidden)**
   - Visible failures: explicit failed runs, retries, review rejections.
   - Hidden failures: repeated churn, no shipped outcomes despite activity, stalled loops.
3. **Blockers**
   - What is blocking flow right now?
   - Which blockers are structural vs transient?
4. **Outcome quality**
   - Did work ship with evidence and clear acceptance closure?
   - Are review/QA signals aligned with shipped changes?
5. **Opportunities**
   - What concrete improvements would increase throughput/reliability tomorrow?
6. **System health**
   - Is the factory behaving deterministically?
   - Are required data sources available and trustworthy?

If any domain lacks enough data, do **not** guess. Report the gap explicitly (source missing, stale, or ambiguous) and add a concrete follow-up question.

## Canonical report structure

The approved heading set is defined in:

- `docs/skills/daily-analysis/templates/report-sections.md`

Treat that template as the **single source of truth** for report heading order and heading levels. Renderer output, docs, and tests must stay synchronized to this template.

Required top-level sections:
- Executive Summary
- Metrics Snapshot
- Detailed Findings by Domain
- Anomalies & Alerts
- Opportunities
- Self-Improvement
- Meta

## Evidence contract (non-optional)

Every non-trivial claim must cite at least one concrete evidence reference. Preferred evidence includes:

- trace IDs (`trace_id` / Langfuse IDs)
- issue and PR numbers (`#123`)
- Hatch run IDs / supervisor tick IDs
- cost and duration metrics (`cost_usd`, `duration_ms`)
- commit SHAs when relevant

Evidence should be attached per finding, anomaly, and opportunity. If evidence is absent, the finding must be labeled as data-insufficient.

## Self-improvement and prediction tracking

The report must maintain a running learning loop:

- New suggestions/predictions are appended to `reports/analysis-learnings.json` with `status=pending`.
- If a report includes a literal, case-sensitive marker `suggestion:<id>`, matching pending entries are transitioned to `adopted`.
- Adoption must record evidence refs (at minimum report path and report date).
- Optional `impact_notes` can be attached when adoption impact is known.
- Pending entries are surfaced in the Self-Improvement section as open hypotheses/actions.

### Marker rules

- Marker format is exact: `suggestion:<id>`
- Case-sensitive (for example, `Suggestion:<id>` does not count)
- Free-form prose without this marker does not transition status

## Learnings artifacts

- `reports/analysis-learnings.md` — cumulative human-readable learning log
- `reports/analysis-learnings.json` — machine-readable suggestion/prediction registry

Both artifacts should be updated in the same workflow to keep narrative and structured history aligned.
