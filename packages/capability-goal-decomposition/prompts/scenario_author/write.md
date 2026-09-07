Load the globally installed scenario writing skill by reading ~/.claude/skills/scenario-writer/SKILL.md, then follow it precisely. If the scenario-format reference is unavailable, proceed anyway.

Write a concrete, durable AstroChicken scenario that captures a known high-value product or factory judgment pattern.
Do not write minutia, tiny edge-case scenarios, or exhaustive regression catalogs.
The scenario should be valuable enough that a future judge would plausibly reuse it across multiple related changes.

Hard format requirements for scenario_md:
- Start with YAML frontmatter containing all required fields.
- Include all six required level-2 headings.
- Include at least one '- [ ]' checkbox assertion.
- The id field must be kebab-case and must match the returned scenario_slug.

Return JSON with fields scenario_domain, scenario_slug, and scenario_md (full SCENARIO.md content). Return JSON only.
