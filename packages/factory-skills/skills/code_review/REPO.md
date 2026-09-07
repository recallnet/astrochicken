# Repo-Specific Code Review Addendum (astrochicken)

Use this addendum with `SKILL.md`. If there is any conflict, this addendum wins for this repo.

## Semantic review scope

- Review issue completion for `#${issue_number}` in the context of parent goal `#${goal_issue_number}` and wave `${milestone_title}`.
- Treat this as semantic implementation review, not deterministic QA validation.

## Evidence + branch discipline

1. **Artifact-first**: `${review_evidence_path}` is required. If missing/malformed, return `revise` + `EVIDENCE_MISSING`.
2. **Shared wave branch rule**: use `issue_changed_files` to judge this issue’s scope; ignore sibling-issue files in `changed_files`.
3. **Local repo confirmation**: inspect files directly under `${worktree_dir}` on `${branch}` before final verdict.

## GitHub context expectations

If issue/goal intent is unclear, inspect GitHub source-of-truth via:

- `gh issue view ${issue_number} --repo ${gh_repo} --json number,title,body,labels,milestone`
- `gh issue view ${goal_issue_number} --repo ${gh_repo} --json number,title,body,labels,milestone`

Do not guess missing context when `gh` can resolve it.

## QA boundary

- Code review is not QA execution.
- Do not block on `qa.status` / `qa.command` by default.
- Only request additional QA/test execution if the issue explicitly requires it.

## Revision feedback quality bar

`review_notes` must be issue-scoped and actionable:

- name concrete files/functions/tests
- explain defect or incompleteness
- state the exact change required for approval
