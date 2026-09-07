Primary objective: propose the smallest set of real product increments that would materially satisfy the goal if they shipped and covers EVERY deliverable extracted above.

MANDATORY: review relevant current code before proposing features. Use read/bash over apps/, factories/, scripts/, tests, and package manifests to avoid re-specifying already-implemented work.

MANDATORY FIRST STEP — deliverable extraction: Before proposing features, read the goal body carefully and extract every concrete deliverable, phase, command, asset, or end-to-end behavior the goal describes. List them as a numbered checklist in your reasoning. A goal that describes multiple phases or distinct acceptance items requires features that cover ALL of them.

Investigative and diagnostic goals have a standard deliverable shape:
1. identify the root cause and implement the fix
2. add the regression gate that would have caught the defect before deployment

Do NOT return an empty array for a goal whose body describes an investigation. Extract those investigation deliverables as concrete implementation features.

Return a JSON array of 1-15 feature objects (HARD MAXIMUM: 15). Each feature must be a substantial, self-contained unit of work that directly ships part of the goal's promised product surface. Use as many features as needed to preserve distinct deliverables — one feature per concrete deliverable is the target. Never exceed 15.

Feature design rules:
- Prefer real shipped deliverables over enabling scaffolding.
- Do not replace the goal with decomposition continuity work, fallback scaffolding, or meta-factory support work unless the goal is explicitly about that machinery.
- Reject feature shapes whose main output is decomposition continuity, fallback logic, pipeline hygiene, or future-work setup unless the goal explicitly asks for that.
- Each feature should be independently valuable.
- If a goal asks for multiple concrete asset types or phases, preserve those deliverables in the feature plan rather than collapsing them into generic bootstrap work.
- Preserve concrete asset types and named deliverables instead of collapsing them into vague bootstrap work.
- Meta-factory improvement goals must still map each named target to a concrete shippable deliverable.
- COVERAGE CHECK: every deliverable extracted in the first step must map to at least one feature.

Each feature should include enough detail that a coding agent can start implementing immediately without needing to explore the codebase first. Include specific file paths, function names, module boundaries, and concrete implementation steps when you can identify them from your code exploration.

CRITICAL OUTPUT CONTRACT: return a non-empty JSON array. If you are uncertain, return one coarse feature capturing the full goal scope, but never return [].

Shape:
[
  {
    "id": "F-1",
    "name": "Feature name",
    "summary": "Detailed summary including specific files to modify, functions to add/change, and concrete implementation approach",
    "scope": "In/out of scope notes",
    "acceptance_criteria": ["Concrete, testable criteria with specific expected behavior"],
    "domain": "area-of-product",
    "slug": "kebab-case-slug",
    "dependencies": ["optional dependencies"],
    "risks": ["known risks or unknowns"]
  }
]

Return JSON only.
