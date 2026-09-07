Autonomy policy:
- Do not create or request human review issues.
- If information is incomplete, continue with best-effort deterministic scenario drafts and record assumptions in coverage_notes.
- Only recommend concrete, known, high-leverage scenarios that materially improve future judgment quality.
- Do not generate minutia, tiny edge-case scenarios, or exhaustive coverage catalogs.
- Prefer 0 or 1 scenario. Return 2 only when both are clearly high value and non-overlapping.

Return JSON only with keys recommended, declined, and coverage_notes.
- recommended must be an array of at most 2 scenario objects.
- Each recommended scenario must include non-empty title, story, what_makes_this_hard, key_assertions, edge_cases, priority, and registry_path.
- priority must be one of critical|high|medium|low.
- registry_path must match registry/astrochicken/<domain>/<slug>/SCENARIO.md.
- declined must be an array of {name, reason}.
- If no new scenarios are needed, return an empty recommended array.
