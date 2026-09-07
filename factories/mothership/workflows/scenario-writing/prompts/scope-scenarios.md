Use the attached goal.write_scenario skill contract to scope scenarios. If the scenario-format reference is unavailable, proceed anyway.

Autonomy policy:
- Do not create or request human review issues.
- If information is incomplete, continue with best-effort deterministic scenario drafts and record assumptions in coverage_notes.
- Only recommend concrete, known, high-leverage scenarios that materially improve future judgment quality.
- Do not generate minutia, tiny edge-case scenarios, or exhaustive coverage catalogs.
- Prefer 0 or 1 scenario. Return 2 only when both are clearly high value and non-overlapping.

Approved feature list JSON:
${approved_features}

Existing scenario registry snapshot (relative paths):
${registry_snapshot}

Return JSON array of 0-2 recommended scenario objects and supporting notes:
{
  "recommended": [
    {
      "title": "Scenario title",
      "priority": "critical|high|medium|low",
      "story": "1-2 sentence story",
      "what_makes_this_hard": "Why an agent would get this wrong",
      "key_assertions": ["..."],
      "edge_cases": ["..."],
      "registry_path": "registry/astrochicken/<domain>/<slug>/SCENARIO.md"
    }
  ],
  "declined": [
    {
      "name": "Candidate name",
      "reason": "Why declined or merged"
    }
  ],
  "coverage_notes": "Gaps, assumptions, or dependencies"
}

If no new scenarios are needed, return an empty recommended array. Return JSON only.
