---
doc_type: "architecture"
owner: "factory-platform"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Deterministic LLM routing precedence and node-level introspection via hatch-ops factory model-policy."
tags: [docs, hatch, llm-routing, policy, provenance]
written: "2026-03-19"
---

# LLM Routing Policy

## Deterministic precedence

Node routing resolves in this strict order:

1. **Policy defaults** from `policy-pack/<version>/model-policy.json`
   (`shared.default_provider`, `shared.default_model`)
2. **Environment overrides** using
   `shared.override_env_vars.provider` / `shared.override_env_vars.model`
3. **Node overrides** from DOT attrs (`llm_provider`, `llm_model`)
4. **Handler fallback chain** from `buildModelAttemptChain`
   (provider order, then `safe_fallback_model` when configured)

Later layers override earlier layers. Runtime selection always fail-closes
through model-policy validation (`provider_order`, `allowed_models`).

## Owned resolution surfaces

- Pipeline/factory policy resolver:
  `apps/hatch/src/factory/model-policy.ts`
- Node summary resolver (attempt chain + provenance):
  `apps/hatch/src/pipeline/llm-routing-policy.ts`
- Handler attempt chain logic (canonical fallback behavior):
  `apps/hatch/src/pipeline/handler/model-routing.ts`

## Operator introspection command

Use `hatch-ops factory model-policy` for deterministic, operator-grade routing
explanations.

### Factory-level summary

```bash
hatch-ops factory model-policy --factory-root factories/mothership
```

### Node-level introspection (effective winner + attempt chain)

```bash
hatch-ops factory model-policy \
  --factory-root factories/mothership \
  --show-node-policy \
  --graph-file factories/mothership/graphs/factory_supervisor_tick.dot \
  --node-id supervisor_review
```

### JSON output (automation/tests)

```bash
hatch-ops factory model-policy \
  --factory-root factories/mothership \
  --show-node-policy \
  --graph-file factories/mothership/graphs/factory_supervisor_tick.dot \
  --node-id supervisor_review \
  --json
```

JSON includes:

- `selected_via`, `winner_source`, `effective_provider`, `effective_model`
- `overrides` (policy/env/node provenance entries)
- `node_policy` (serialized node routing summary)
- `attempt_chain` with ordered attempts, winner flag, and precedence comments

## Policy pack references

For mothership, inspect:

- `factories/mothership/factory.config.json` (`policyPack.version` + overrides)
- `factories/mothership/policy-pack/v1/model-policy.json`
