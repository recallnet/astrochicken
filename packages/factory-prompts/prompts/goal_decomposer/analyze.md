Analyze the goal intake and produce a concise goal context for downstream decomposition.

Keep the goal_context concise (2-3KB). Summarize the goal, list key existing features/issues as a short list, identify gaps, and reflect the platform/factory intent that should shape decomposition. Do NOT include raw issue dumps or full inventories.

goal_context must include an external_bug summary object with external_bug_intake_activated, external_bug_present, source_factory, source_repo, affected_version, and control_plane_intent (when present), plus any external_bug_errors so downstream triage can request deterministic intake fixes only for activated external bug intake.

Factory-request classification contract:
- Include `goal_request_type` in goal_context.
- Set `goal_request_type` to `factory_request` when the goal asks to stand up a new managed factory, introduces a novel managed-factory client shape, or otherwise requires reusable factory capability planning before instance wiring.
- Otherwise set `goal_request_type` to `standard`.

If `goal_request_type=factory_request`, include this exact bucket contract in goal_context so propose/review can follow it deterministically:
- `factory_request_bucket_contract.required_buckets` = [
  "reusable_capability_gaps",
  "reusable_policy_profile_gaps",
  "factory_instance_wiring",
  "domain_specific_residues"
]
- `factory_request_bucket_contract.bucket_tag` = "factory_request_bucket"
- `factory_request_bucket_contract.bucket_text_field` = "factory_request_bucket_text"
- `factory_request_bucket_contract.validation_note` explaining reusable buckets must be classified before bespoke wiring.

Return JSON only. Do not wrap in markdown fences.
