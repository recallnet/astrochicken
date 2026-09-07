---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Runbook for recomputing daily analysis artifacts with hatch-ops analysis daily-report."
tags: [analysis, daily, hatch, ops, runbook]
written: "2026-03-07"
---
# Daily Analysis Runbook

Use `hatch-ops analysis daily-report` to recompute the daily insights slice on demand.

## Command

```bash
hatch-ops analysis daily-report \
  --date 2026-03-06 \
  --repo recallnet/astrochicken
```

Required flags:
- `--date` (report date, `YYYY-MM-DD`)
- `--repo` (`owner/repo`)

Optional flags:
- `--output-dir` (default: `reports/daily`)
- `--langfuse-retries` (default: `2`)
- `--log-level` (default: `info`)

## Analysis window semantics

The command computes the **previous-day** 24-hour slice for the supplied report date.

Example:
- `--date 2026-03-06`
- analysis window = `2026-03-05T00:00:00.000Z` → `2026-03-06T00:00:00.000Z`

This window is written into both output artifacts.

## Output artifacts

For `--date 2026-03-06` and default output dir:
- `reports/daily/2026-03-06.md`
- `reports/daily/2026-03-06.json`

Artifact meaning:
- `.md`: human-readable report (executive summary, metrics, domains, anomalies, opportunities, self-improvement, meta)
- `.json`: machine-readable structured payload (`domains`, `anomalies`, `opportunities`, `self_improvement`, `sources`, `missing_sources`, `metrics_snapshot`, `meta`)

## Missing-source reporting

Missing data does **not** fail report generation. Coverage gaps are emitted explicitly:

- JSON: `missing_sources` object (`missing_langfuse`, `missing_github`, `missing_git`, `missing_hatch_runs`, `missing_supervisor_state`)
- Markdown: Meta section includes the same boolean coverage flags

This enables downstream consumers to distinguish "no activity" from "source unavailable".

## Read-only contract

`analysis daily-report` is read-only. It only reads collectors/snapshots and writes local report artifacts. It must not mutate GitHub state or `.hatch/runs` state.

## Related operator lifecycle docs

- [Host lifecycle for same-machine multi-factory runtime](../host-lifecycle.md)
