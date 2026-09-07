Analyze the goal intake and produce a concise goal context for downstream decomposition.

Keep the goal_context concise (2-3KB). Summarize the goal, list key existing features/issues as a short list, identify gaps, and reflect the platform/factory intent that should shape decomposition. Do NOT include raw issue dumps or full inventories.

goal_context must include an external_bug summary object with external_bug_intake_activated, external_bug_present, source_factory, source_repo, affected_version, and control_plane_intent (when present), plus any external_bug_errors so downstream triage can request deterministic intake fixes only for activated external bug intake.

Return JSON only. Do not wrap in markdown fences.
