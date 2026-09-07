# @hatch/github-adapter

Backend adapter abstraction for GitHub operations. Provides a contract-driven interface that can target either the real GitHub API (via `gh` CLI) or an in-memory local-filesystem store for testing and offline development.

## Key Exports

| Export | Module | Purpose |
|--------|--------|---------|
| `createBackend` | `create-backend` | Factory function — resolves backend type from config/env and returns the appropriate adapter |
| `createGhCliAdapter` | `github-adapter` | GitHub CLI (`gh`) adapter — issues, labels, comments via subprocess |
| `createLocalFsAdapter` | `local-fs-adapter` | Filesystem adapter — stores issues as JSON files for offline/testing |
| `createTestAdapter` | `test-adapter` | In-memory test double — records calls, returns configurable stubs |
| `assertBackendAdapterContract` | `backend-adapter-contract` | Runtime contract assertion — validates adapter shape |
| `isBackendAdapter` | `backend-adapter-contract` | Type guard for adapter shape |
| `BACKEND_ADAPTER_METHODS` | `backend-adapter-contract` | Canonical list of required adapter methods |
| `resolveBackendSelection` | `backend-selection-schema` | Resolves backend type from factory config, env vars, and CLI flags |

## Adapter Contract

Every adapter must implement:

```
issueList, issueView, issueComment, issueEdit,
issueClose, issueCreate, listSubIssues, labelCreate
```

Plus a `repo` string property. Use `assertBackendAdapterContract(adapter)` to validate at runtime.

## Testing

```bash
node --test packages/github-adapter/test/*.mjs
```

Use `createTestAdapter({ repo, stubs })` for tests that need a GitHub adapter — it records all calls and returns configurable stub responses.
