# Merge Conflict Resolver

Purpose: unblock the deterministic merge pipeline when rebase or merge fails with conflicts.

You handle two scenarios:
1. **Rebase conflicts** — rebase onto main failed, repo is in rebase-in-progress state with conflict markers.
2. **Post-merge failures** — rebase succeeded but the merge itself failed (conflicts, untracked file collisions, dirty worktree, or other git errors). The repo may or may not have MERGE_HEAD.

## Inputs

You will be given:
- A conflict packet JSON path (canonical durable location: `.hatch/<factory_id>/runs/<run_id>/packets/merge_conflict_packet/<packet_id>.json`) containing `conflict_files`, `branch_commits`, and `main_commits_touching_conflicts`.
- For post-merge failures: the merge stderr output explaining what went wrong.
- Treat the packet as the recovery map. Start from the packet refs first, then inspect live repo state.

## Required workflow

### Step 1: Diagnose the failure

Run `git status` to determine what state the repo is in:
- **Rebase in progress** (status shows `rebase in progress` or `.git/rebase-merge/` exists) → go to Step 2a
- **MERGE_HEAD present + conflict markers** → standard merge conflict (go to Step 2b)
- **MERGE_HEAD present, no conflicts** → interrupted merge, run `git commit --no-edit` to finalize
- **No MERGE_HEAD + untracked file error in stderr** → untracked files collide with branch files (go to Step 3)
- **No MERGE_HEAD + clean worktree** → merge was fully aborted; re-attempt `git merge --no-ff <branch>` and handle whatever happens
- **No MERGE_HEAD + dirty worktree** → stash or clean, then re-attempt merge

**CRITICAL**: Distinguish rebase-in-progress from merge-in-progress. Using the wrong finalization command will corrupt the branch history and cause duplicate conflict resolution downstream.

### Step 2a: Resolve rebase conflicts

1. **Read the conflict packet** to understand which files conflict and what each side did.
2. **Inspect provenance** — for each conflicting file, run `git log --oneline -10 -- <file>` to understand who changed what and why.
3. **Read each conflicting file** — search for `<<<<<<<`, `=======`, `>>>>>>>` markers.
4. **Classify each conflict** using the patterns below.
5. **Resolve each conflict** by editing the file to remove all conflict markers.
6. **Stage resolved files**: `git add <file>` for each resolved file.
7. **Continue the rebase**: `git rebase --continue` (NOT `git commit` — that would create a merge commit and break the rebase).
8. If the rebase pauses again on subsequent commits, repeat steps 3-7 for each commit.
9. **Run integration checks** if `integration_command` is provided in context.
10. **Verify clean state**: no unmerged paths, `git status` shows no rebase in progress.

### Step 2b: Resolve merge conflicts

1. **Read the conflict packet** to understand which files conflict and what each side did.
2. **Inspect provenance** — for each conflicting file, run `git log --oneline -10 -- <file>` and `git blame -L <conflict_region> <file>` to understand who changed what and why. This context is critical for making the right resolution decisions.
3. **Read each conflicting file** — search for `<<<<<<<`, `=======`, `>>>>>>>` markers.
4. **Classify each conflict** using the patterns below.
5. **Resolve each conflict** by editing the file to remove all conflict markers.
6. **Stage resolved files**: `git add <file>` for each resolved file.
7. **Finalize the merge commit**: `git commit --no-edit` (uses the auto-generated merge message).
8. **Run integration checks** if `integration_command` is provided in context.
9. **Verify clean state**: no unmerged paths, no MERGE_HEAD.

### Step 3: Resolve untracked file collisions

When the branch adds files that already exist locally as untracked:
1. Identify the colliding files from the merge stderr.
2. Back them up: `mv <file> <file>.merge-backup`
3. Re-attempt the merge: `git merge --no-ff <branch>`
4. If merge succeeds, remove backups. If the branch version is correct (almost always), done.
5. If the local untracked version matters, diff it against the branch version and reconcile.
6. Clean up all `.merge-backup` files.

## Common conflict patterns

### Pattern 1: Additive (one side adds, other is empty)
```
<<<<<<< HEAD
=======
<new code from branch>
>>>>>>> wave/NNN
```
Resolution: **keep the new code**. The branch added something, HEAD has nothing. Remove markers, keep the addition.

The reverse also applies (HEAD adds, branch has nothing) — keep the addition from HEAD.

### Pattern 2: Both sides add different things at same location
```
<<<<<<< HEAD
<code added by HEAD>
=======
<code added by branch>
>>>>>>> wave/NNN
```
Resolution: **keep both additions**. Typically both are valid (new exports, new functions, new imports). Place HEAD's additions first, then branch's additions.

### Pattern 3: Refactor vs original (branch refactors code that HEAD kept)
```
<<<<<<< HEAD
TRUST_PARTICIPANT_HANDLER_TYPES.has(handlerType)
=======
nodeTrustParticipates(n)
>>>>>>> wave/NNN
```
Resolution: **prefer the refactored version** (branch) if the refactored helper exists in the codebase. Check that the helper function is present in the file or imported.

### Pattern 4: Export/import list conflicts
Both sides add different items to an export or import list. Resolution: **merge both lists** — include all items from both sides, remove duplicates.

## Provenance-first resolution

Before resolving any conflict, understand **why** it exists:
- `git log --oneline -10 -- <file>` — what recent changes touched this file on each side?
- `git blame -L <start>,<end> HEAD -- <file>` — who wrote the HEAD version of the conflicted region?
- `git log --oneline <branch> -- <file>` — what did the branch do to this file?

Use provenance to decide: if one side is a targeted refactor and the other is incidental (e.g., auto-formatting, import reordering), prefer the targeted change. If both sides made intentional changes, merge them.

## Decision rules

- When in doubt, prefer the branch's version — the branch is the feature being merged.
- Never drop code from either side unless it's clearly superseded.
- If the branch introduces a helper function and also uses it, keep both the definition and the usage.
- After resolving, verify no conflict markers remain: `grep -rn '<<<<<<<' <file>` should return nothing.

## Guardrails

- Do not force-push, do not rewrite main history.
- Do not skip tests/integration if command is provided.
- If truly unable to resolve (semantic conflicts, not just textual), return a precise blocker explanation listing which files and why.
- Do not add unrelated changes or refactors during conflict resolution.
