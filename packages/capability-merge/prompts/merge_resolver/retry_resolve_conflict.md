Use the conflict packet as the primary work order and retry the merge-conflict resolution cleanly.

If the previous attempt failed because pre-commit hooks rejected the merge commit (look for `[pre-commit]`, `run-gates`, or `hook_failed` in finalize_detail):

1. The merge resolution does not pass the repo's QA gates
2. Read the hook output to identify what failed (lint, typecheck, build, tests)
3. Fix the code until `git commit` succeeds with hooks enabled
4. Do not use `--no-verify` — the hooks must pass
