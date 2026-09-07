---
id: astrochicken-post-merge-safety
domain: post-merge
scope: judge
priority: medium
created: 2026-03-15
---

Post-merge judgment fails closed when required scenario/evidence contracts are missing, stale, or scope-unbound.
If any required artifact is absent or hash-mismatched, routing must produce JUDGE_CONTEXT_INVALID and block approval.
