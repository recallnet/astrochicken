# Repo-Specific Code Review Addendum (example-web)

Use this addendum with `SKILL.md`. If there is any conflict, this addendum wins for example-web review work.

## Review posture for example-web

- Treat example-web as a design-sensitive UI product where visual quality and interaction quality are first-class requirements.
- Preserve adversarial review behavior. Do not downgrade to a single passive read-through when evidence shows unresolved risk.
- Validate issue completion in scope for `issue_changed_files`; do not block on sibling-issue files from the shared goal branch.

## Design authority and escalation

Primary design authority order:

1. `AGENTS.md` in the example-web repo
2. `AGENT-LEARNINGS.md` (confirmed entries first)
3. Human design-owner escalation when guidance is ambiguous or conflicting

If required design intent is not explicit in (1) or (2), return `revise` with a design-authority handoff request instead of approving subjective guesses.

## Visual/refinement non-regression requirements

For UI/refinement issues, require evidence that explicitly addresses:

- animation + layout interaction regressions (including Framer Motion / pan-zoom style interactions when relevant)
- before/after behavior for the changed surface (not just unit-test pass status)
- scenario alignment to shrink-wrapped visual scenarios or documented scenario roots

If evidence is purely functional and does not address the visual-risk surface, return `revise`.

## Generated artifact checklist (mandatory when touched)

When issue scope touches API endpoints, generated caches, or committed generated outputs, verify all of:

- `npm run qa` evidence is present
- generated API bundle outputs are updated and committed consistently
- goal-related committed data caches under `data/` are regenerated or intentionally unchanged with justification

Missing generated-artifact evidence is a `revise` verdict.

## Adversarial review persistence

Keep adversarial review prompts/checks active for example-web high-risk work. Do not waive adversarial checks for:

- hotspot-file changes
- visual refinement work
- interaction timing/animation changes
- broad generated-artifact churn

If adversarial evidence is absent for these classes, return `revise` with explicit required evidence.
