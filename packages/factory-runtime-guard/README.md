# @hatch/factory-runtime-guard

Git mutation guard for factory runtime operations. Prevents accidental writes to the wrong repository checkout by enforcing repo role policies, canonical checkout detection, and mutation policy contracts.

## Key Modules

| Module | Purpose |
|--------|---------|
| `git-mutation-guard` | Core guard — intercepts git operations and enforces repo role + mutation policies |
| `mutation-policy-contract` | Defines and validates mutation policies per handler type (tool, agent.worktree, etc.) |
| `factory-repo-roles` | Normalizes repo slugs, builds repo role contexts, resolves guard options from config/env |
| `canonical-worktree` | Classifies paths as canonical checkout, approved disposable worktree, or unknown |
| `cli-helpers` | Shared CLI utilities (trim, parseJson, gh/ghJson wrappers) with backend adapter support |
| `io` | Low-level I/O helpers |

## How It Works

The guard wraps git subprocess calls and checks:

1. **Is this the canonical checkout?** Only approved operations are allowed on the canonical checkout (e.g., the main repo at `~/Projects/example-org/example-trading`).
2. **Is this an approved disposable worktree?** Wave/merge/proposal worktrees under `.hatch-worktrees/` are allowed broader mutations.
3. **Does the mutation policy allow this operation?** Each handler type (tool, agent.worktree, stack.manager_loop) has a defined mutation policy that controls what git operations it can perform.

## Testing

```bash
node --test packages/factory-runtime-guard/test/*.mjs
```

Tests cover: repo role normalization (SSH/HTTPS URL parsing, env var resolution), canonical worktree classification, mutation policy validation, and git mutation guard role boundaries.
