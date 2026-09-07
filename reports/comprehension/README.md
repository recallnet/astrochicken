# Comprehension Catch-up Artifacts

`hatch-ops release comprehension-catchup` writes deterministic orientation artifacts here.

## Command

```bash
hatch-ops release comprehension-catchup \
  --repo recallnet/astrochicken \
  --lookback-days 14 \
  --limit 5 \
  --out-dir reports/comprehension
```

## File naming

Each run writes two files:

- `catchup-<timestamp>-<repo>.json`
- `catchup-<timestamp>-<repo>.md`

Where:
- `<timestamp>` is generated from `generated_at` (ISO UTC, filename-safe)
- `<repo>` is the repo slug with `/` replaced by `-` (for example `recallnet-astrochicken`)

## JSON schema (v1)

Top-level fields:

- `generated_at` (ISO timestamp)
- `repo` (`owner/repo`)
- `catchup_window`
  - `since_iso`
  - `now_iso`
  - `lookback_days`
- `entries` (ranked conceptual shifts)
  - `issue_number`
  - `title`
  - `url`
  - `updated_at`
  - `metrics`
    - `goals_closed`
    - `issues_closed`
    - `commits_landed`
  - `score` (`goals_closed * 4 + issues_closed * 2 + commits_landed`)
  - `conceptual_shift`
  - `why_it_matters`
  - `entry_points` (array)
  - `watch_items` (array)
- `top_entry_points` (deduped, weighted by ranked entries)

## Markdown

The companion Markdown file renders:

- catch-up window metadata
- top entry points summary
- ranked conceptual shifts with metrics, conceptual context, and watch items

If no `release-report` issues exist in the lookback window, the command still succeeds and writes empty artifacts (`entries: []`).
