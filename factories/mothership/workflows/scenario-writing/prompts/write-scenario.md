Load the globally installed scenario writing skill by reading ~/.claude/skills/scenario-writer/SKILL.md, then follow it precisely. If the scenario-format reference is unavailable, proceed anyway.

Write a concrete, durable AstroChicken scenario that captures a known high-value product or factory judgment pattern.
Do not write minutia, tiny edge-case scenarios, or exhaustive regression catalogs.
The scenario should be valuable enough that a future judge would plausibly reuse it across multiple related changes.

Hard format requirements for scenario_md:
- Include ALL six sections with exact level-2 headings:
  - ## Context
  - ## Preconditions
  - ## Trigger
  - ## Expected Behavior
  - ## Assertions
  - ## Edge Cases
- Include at least one '- [ ]' checkbox assertion.
Scenario brief JSON:
${scenario_brief}

Return JSON with fields scenario_domain, scenario_slug, and scenario_md (full SCENARIO.md content). Return JSON only.
