---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Canonical heading template for the daily analysis renderer output."
tags: [analysis, daily, headings, template]
written: "2026-03-07"
---
# Daily analysis report section template

This file is the canonical heading contract for the daily report.

## Machine-readable heading list

```text
H1|# Daily Analysis Report — <YYYY-MM-DD>|label=report_title
H2|## Executive summary|label=executive_summary
H2|## Metrics snapshot|label=metrics_snapshot
H2|## Detailed findings by domain|label=detailed_findings
H3|### <domain-name>|label=domain_heading
H2|## Anomalies and alerts|label=anomalies_alerts
H2|## Opportunities|label=opportunities
H2|## Self-improvement|label=self_improvement
H3|### Learnings|label=self_improvement_learnings
H3|### Questions|label=self_improvement_questions
H3|### Improvement suggestions|label=self_improvement_suggestions
H3|### Predictions|label=self_improvement_predictions
H2|## Meta|label=meta
```

## Notes

- Heading levels and capitalization are part of the contract.
- Domain names are dynamic values under the fixed `## Detailed findings by domain` section.
- Any renderer/test changes to headings must update this file in the same change.
