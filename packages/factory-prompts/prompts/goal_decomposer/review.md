CRITICAL OUTPUT CONTRACT — your response MUST be a single JSON object (not an array) with these exact keys:
{
  "approved": true or false,
  "approved_features": [ ... the features array ... ],
  "review_notes": "actionable feedback or empty string"
}
Do NOT return a raw array. Do NOT omit the wrapper object. The pipeline will silently lose all features if you return anything other than this exact shape.

---

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

UI/refinement review contract (required when goal text indicates UI, visual, interaction, animation, copy refinement, or any feature uses domain=`ui-refinement`):
- Verify the decomposition explicitly cites AGENTS.md + AGENT-LEARNINGS.md design guidance before claiming completion.
- Verify each UI/refinement feature includes required metadata keys: `visual_risk_class`, `hotspot_files`, `scope_limit_minutes`, `refinement_strategy`, `scenario_sources`.
- Reject plans where `scope_limit_minutes` is missing/non-positive or `hotspot_files` is empty.
- Require `scenario_sources` to reference the pinned `scenario_root` from goal_context/factory config; reject when scenario linkage is generic or missing.
- Require a reviewer-visible `visual_refinement_risk` paragraph that states the governing design principle/scenario set and expected regression mode.
- If any required UI/refinement evidence is missing, set approved=false and list missing fields in review_notes.

Factory-request review contract (required when goal_context.goal_request_type = "factory_request"):
- Every approved feature must include `factory_request_bucket` set to one of exactly:
  - `reusable_capability_gaps`
  - `reusable_policy_profile_gaps`
  - `factory_instance_wiring`
  - `domain_specific_residues`
- Every approved feature must include `factory_request_bucket_text` as a JSON array of concise bullet strings.
- Reject the plan when either reusable bucket (`reusable_capability_gaps` or `reusable_policy_profile_gaps`) is missing or empty.
- Reject plans that jump directly to `factory_instance_wiring` without reusable-gap classification.
- Require `factory_request_goal_graph` with:
  - `schema_version=factory_request_goal_graph/v1`
  - `goals` entries containing `goal_id`, `goal_kind`, `title`, `issue_set_id`
  - exactly one `goal_kind=final_instantiation`
  - explicit `goal_edges` that only reference known `goal_id`s
  - `goal_issue_sets` entries keyed by `issue_set_id`.
- Reject any graph with cycles, missing final-instantiation goal, or prerequisite goals that are not ordered to the final-instantiation goal.

Return JSON with:
{
  "approved": true,
  "approved_features": [ ... final feature list ... ],
  "factory_request_goal_graph": { ... required for factory_request ... },
  "review_notes": "Actionable feedback"
}

CRITICAL CONTRACT:
- if approved=true, approved_features MUST be a non-empty JSON array containing the actual features.
- if goal_context.goal_request_type=factory_request and approved=true, factory_request_goal_graph MUST be present and valid.
- Never return approved=true with an empty approved_features array. If you cannot produce features, set approved=false and explain why in review_notes.

Return JSON only.
