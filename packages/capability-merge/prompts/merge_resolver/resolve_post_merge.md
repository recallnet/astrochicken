This is a post-merge failure. The deterministic rebase succeeded but the subsequent merge commit was rejected. Read the merge stderr carefully — it tells you exactly what failed.

## Two failure modes

### 1. Git-level failure (conflict markers, untracked files, dirty state)
If the stderr shows git errors (conflict markers, MERGE_HEAD, untracked file collisions), follow the conflict resolution workflow in SKILL.md.

### 2. Pre-merge QA failure (lint, type-check, test, build)
If the stderr shows a **pre-merge-commit hook failure** (husky, QA gate, lint, type-check, test, or build error), the merge itself succeeded but the commit was blocked by a quality gate. The repo is in a merge-pending state with all changes staged.

**This is the most common failure mode.** The code merged cleanly but violates a project quality rule. You MUST fix the violation, not work around it.

Steps for QA failures:
1. **Read the stderr** to identify the exact failing check and its error message.
2. **Understand the violation** — common ones include:
   - `oversized-source-file`: a file exceeds the line limit (usually 1200 lines). Fix: extract functions/classes to a new file, update imports, re-export from the original.
   - `unexpected-top-level-directory`: files placed in wrong package structure. Fix: move the files to the correct directory per the project's structure policy.
   - `unexpected-source-file`: file doesn't belong in this package. Fix: move it to the right package.
   - Type errors (`tsc`): merged code has type mismatches. Fix: update types, add missing imports.
   - Test failures: merged code breaks existing tests. Fix: update the tests or the code.
   - Lint errors: style violations. Fix: run the linter's auto-fix or manually correct.
3. **Fix the code** — edit the files to resolve the violation. Do NOT use `git checkout --ours` or `--theirs` as a shortcut. Do NOT skip or bypass the QA gate.
4. **Stage your fixes**: `git add <fixed-files>`
5. **Complete the merge commit**: `git commit --no-edit` (this re-runs the pre-merge-commit hook with your fixes applied)
6. **If QA fails again**, read the new error, fix it, amend: `git add . && git commit --amend --no-edit`
7. **Verify**: `git status` should show a clean worktree on the merge branch with no pending merge.

**Do not give up after one attempt.** QA failures are fixable code problems. Read the error, fix the code, retry. You have up to 60 minutes.

## Critical rules

- NEVER resolve by dropping code from either side of the merge.
- NEVER use `git checkout --ours` or `git checkout --theirs` — these discard intended changes.
- NEVER bypass the pre-merge hook with `--no-verify`.
- After fixing, the merged result must contain ALL intended changes from the branch AND pass all QA gates.
- If you cannot fix a violation after genuine effort, explain exactly what failed and why in your output — do not silently give up.
