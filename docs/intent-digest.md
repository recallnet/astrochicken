---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Canonicalization and digest stability rules for Hatch intent metadata."
tags: [docs, intent, reference]
written: "2026-02-25"
---
# Intent Digest Canonicalization

Hatch attaches a resolved intent metadata object to node outcomes for handlers that execute prompts or commands. The `digest` field is a stable SHA-256 hash of the canonicalized intent descriptor.

## Intent descriptor shape

```ts
interface IntentDescriptor {
  handlerType: string;
  kind: "prompt" | "command" | "assert" | "pipeline" | "human" | "noop";
  data: Record<string, unknown>;
}
```

Intent metadata extends the descriptor with runtime identifiers:

```ts
interface IntentMetadata extends IntentDescriptor {
  nodeId: string;
  digest: string;
  intentRef?: string;
  intentProfile?: string;
  intentPatches?: string[];
}
```

The `nodeId` and intent binding fields are stored alongside the descriptor in `IntentMetadata`, but **are not included** in the digest calculation.

## Canonicalization rules

When computing the digest, Hatch canonicalizes the intent descriptor as follows:

1. **Omit `undefined` values** in all objects.
2. **Normalize line endings** in strings to `\n` (CRLF and CR become LF).
3. **Sort object keys** lexicographically at every level.
4. Serialize the normalized object with `JSON.stringify`.
5. Compute `sha256` over the canonical JSON string and prefix with `sha256:`.

These rules ensure that the digest is stable across runs when the effective intent is unchanged.

## Handler mappings

Resolved intent metadata is emitted for the following handlers:

| Handler type | kind | data fields |
| --- | --- | --- |
| `codergen` | `prompt` | `prompt`, `model`, `provider`, `reasoningEffort` |
| `stack.manager_loop` | `prompt` | `prompt`, `model`, `provider`, `workDir`, `thinkingLevel` |
| `agent.worktree` | `prompt` | `prompt`, `model`, `provider`, `repo`, `branch`, `base` |
| `agent.worktree` (recovery) | `noop` | `repo`, `branch`, `base`, `recovery`, `commitsAhead` |
| `agent.kw` | `prompt` | `prompt`, `model`, `provider`, `sessionId`, `workDir` |
| `tool` | `command` | `command`, `stdin`, `workDir` |
| `assert` | `assert` | `command`, `stdin`, `workDir`, `expect`, `failMessage` |
| `wait.human` | `human` | `question`, `context` |
| `pipeline` | `pipeline` | `pipeline`, `inheritContext`, `exportKeys`, `input` |

Handlers not listed above do not currently emit intent metadata.
