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

Factory-request bucket contract (required when goal_context.goal_request_type = "factory_request"):
- Every feature MUST include `factory_request_bucket` with one of:
  - `reusable_capability_gaps`
  - `reusable_policy_profile_gaps`
  - `factory_instance_wiring`
  - `domain_specific_residues`
- Every feature MUST include `factory_request_bucket_text` as a JSON array of concise bullet strings summarizing the concrete work that belongs in that bucket.
- For factory_request plans, include at least one feature in `reusable_capability_gaps` and at least one feature in `reusable_policy_profile_gaps` before any pure instance-wiring-only plan is considered complete.
- Keep bucket names exact; downstream normalization is deterministic and expects these exact values.

Factory-request goal-graph contract (required when goal_context.goal_request_type = "factory_request"):
- Return a top-level `factory_request_goal_graph` object alongside the feature array.
- `factory_request_goal_graph` MUST include:
  - `schema_version` (set to `factory_request_goal_graph/v1`)
  - `goals` (array of nodes with `goal_id`, `goal_kind`, `title`, `issue_set_id`)
  - `goal_edges` (array of edges with `from_goal_id`, `to_goal_id`)
  - `goal_issue_sets` (array with `issue_set_id`, `title`, `goal_ids`, and optional `feature_ids`)
- `goal_kind` MUST be one of `prerequisite` or `final_instantiation`.
- Include exactly one `final_instantiation` goal.
- Every prerequisite goal MUST have at least one directed path to the final-instantiation goal.
- Every edge MUST reference known `goal_id` values and the graph MUST be acyclic.

CRITICAL OUTPUT CONTRACT:
- For `standard` goals, return a non-empty JSON array.
- For `factory_request` goals, return a JSON object with non-empty `approved_features` array and `factory_request_goal_graph` object.
- Never return [] for goals that require implementation work.

UI/refinement decomposition contract (required when goal text indicates UI, visual, interaction, animation, copy refinement, or domain=`ui-refinement`):
- Use current AGENTS.md and AGENT-LEARNINGS.md guidance as first-class design policy inputs before proposing UI/refinement features.
- Resolve and cite the pinned `scenario_root` from goal context/factory config and keep `scenario_sources` anchored to that root.
- Every UI/refinement feature MUST include these fields: `visual_risk_class`, `hotspot_files`, `scope_limit_minutes`, `refinement_strategy`, `scenario_sources`.
- `hotspot_files` must call out serialized hotspot ownership when relevant (e.g. `App.tsx`, `ConstellationView.tsx`, `apiMiddleware.ts`) so parallel work avoids conflict-heavy surfaces.
- `scope_limit_minutes` must be a positive integer cap, not prose.
- Include a reviewer-visible `visual_refinement_risk` paragraph describing the one scenario set or design principle that justifies the change and the expected failure mode if wrong.
- When this contract applies, omit-none behavior is fail-closed: do not mark a feature ready without all required UI/refinement metadata.

Shape:
[
  {
    "id": "F-1",
    "name": "Feature name",
    "summary": "Detailed summary including specific files to modify, functions to add/change, and concrete implementation approach",
    "scope": "In/out of scope notes",
    "acceptance_criteria": ["Concrete, testable criteria with specific expected behavior"],
    "factory_request_bucket": "reusable_capability_gaps | reusable_policy_profile_gaps | factory_instance_wiring | domain_specific_residues (required for factory_request)",
    "factory_request_bucket_text": ["JSON bullet strings describing concrete work for the selected bucket (required for factory_request)"],
    "domain": "area-of-product",
    "slug": "kebab-case-slug",
    "dependencies": ["optional dependencies"],
    "risks": ["known risks or unknowns"],
    "human_blocker": {
      "kind": "missing_credentials|owner_decision|external_input",
      "title_hint": "short human-facing request title",
      "exact_request": "exact credential, decision, or external input needed",
      "why_blocked": "why the factory cannot proceed autonomously",
      "unblock_condition": "what must be true for work to resume",
      "owner_hint": "likely human owner (optional)"
    },
    "control_plane_blocker": {
      "kind": "upstream_bug|release_floor",
      "blockerRef": "#issue-number or release/version identifier",
      "unblockCondition": "specific, observable state change (e.g. 'issue #999 is closed', 'v2.3.0 published to npm')",
      "status": "blocked"
    }
  }
]

Blocker field rules:
- `human_blocker` and `control_plane_blocker` are OPTIONAL. Omit them entirely when not applicable.
- Only emit `human_blocker` when the feature genuinely requires input outside autonomous authority: missing credential/account access, an owner-only decision, or external input that cannot be derived from repo, docs, GitHub state, or current config.
- Never emit `human_blocker` for ambiguity, naming choices, architecture tradeoffs, or repo-solvable uncertainty. Read more code and decide instead.
- Only emit `control_plane_blocker` when a feature is blocked by an upstream bug or release floor — not for inter-feature dependencies (use `dependencies` for those).
- `control_plane_blocker.unblockCondition` MUST be a specific, observable state change the supervisor can evaluate each tick. Without a concrete condition, the blocker becomes permanent.

Return JSON only.
