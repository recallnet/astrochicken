Review the proposed decomposition against the actual goal and current code reality.

MANDATORY FIRST STEP — deliverable extraction: Read the goal body and extract every concrete deliverable, phase, command, asset, or end-to-end behavior the goal describes. Then verify that EVERY item maps to at least one proposed feature's scope or acceptance criteria. If any deliverable is missing, reject the decomposition and list the uncovered deliverables in review_notes.

Investigative and diagnostic goals are complete only when the feature plan covers both:
1. root-cause identification and fix implementation
2. a regression gate

Also check that:
- the plan reflects current code reality
- it avoids duplication with existing issues/features
- each feature is scoped tightly enough to be a single issue
- acceptance criteria are concrete and testable
- The decomposition ships the goal itself, not merely scaffolding, fallback continuity, or future-work enablement
- If all proposed features landed, the original goal would be FULLY satisfied
- meta-factory improvement goals cover each named pipeline, graph, command, prompt, or contract target

Return JSON with:
{
  "approved": true,
  "approved_features": [ ... final feature list ... ],
  "review_notes": "Actionable feedback"
}

CRITICAL CONTRACT: if approved=true, approved_features MUST be a non-empty JSON array containing the actual features. Never return approved=true with an empty approved_features array. If you cannot produce features, set approved=false and explain why in review_notes.

Return JSON only.
