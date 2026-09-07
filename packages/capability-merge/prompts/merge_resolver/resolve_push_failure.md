The merge succeeded but the push to origin failed. Diagnose the cause:

**If the push was rejected (non-fast-forward / remote ahead):** Run git status and recent log inspection, fetch origin/main, rebase or reconcile as needed while preserving the merge work, and leave canonical main plus the merge worktree in a state where the deterministic push-recovery verifier passes and the next retry push can run without manual intervention. Do not stop at "ready to push."

**If the push failed because pre-push hooks rejected it** (look for `[pre-push]`, `run-gates`, or `hook` in the push stderr):

1. The merged code on main does not pass the repo's QA gates
2. Read the hook failure output to identify what failed (lint, typecheck, build, tests)
3. Fix the failing code on the current branch
4. Stage and commit the fix (hooks will run on your commit — they must pass)
5. The pipeline will retry the push automatically

Do not use `--no-verify`. The hooks must pass.
