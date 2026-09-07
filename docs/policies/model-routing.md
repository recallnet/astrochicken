---
doc_type: "reference"
owner: "factory-platform"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Node-aware model routing resolver contract, precedence, and provenance fields."
tags: [docs, hatch, model-routing, policy]
written: "2026-03-18"
---
# Model Routing Policy Resolver

`apps/hatch/src/factory/model-policy.ts` exposes two related resolver APIs:

- `resolveEffectiveModelPolicyForPipeline(args)`
- `resolveModelPolicyForNode(context)`

Use `resolveModelPolicyForNode` when consumers need node-level routing decisions
with provenance (for review, enforcement traces, or operator introspection).

## Deterministic precedence

Routing precedence is deterministic and strict:

1. Policy defaults (`shared.default_provider`, `shared.default_model`)
2. Environment overrides (`shared.override_env_vars.provider`,
   `shared.override_env_vars.model`)
3. Node overrides (`nodeAttrs.llm_provider`, `nodeAttrs.llm_model`)

Later layers win over earlier layers.

## Node-aware contract

`resolveModelPolicyForNode(context: ModelPolicyContext)` returns
`ResolvedModelRouting | undefined`.

Key fields:

- `effectiveProvider` / `effectiveModel`: final selection after precedence
  resolution.
- `selectedVia`: the selected route cause (`policy_default`, `env_override`,
  `node_override`).
- `winningLayer`: explicit winning precedence layer (same enum as
  `selectedVia`).
- `appliedOverrides`: ordered provenance entries showing each layer/key/value
  applied (`policy_default`, optional env overrides, optional node overrides).
- `policySource`: policy pack metadata (`configPath`, `policyPackDir`,
  `policyVersion`) carried through from pipeline policy resolution.

`resolveModelPolicyForNode` validates the final selection against
`provider_order` and `allowed_models` using the same deterministic validation
rules as pipeline-level policy resolution.

## Interpreting provenance

- `selectedVia=policy_default` means no env or node override won.
- `selectedVia=env_override` means env provided at least one winning routing
  value and no node override replaced it.
- `selectedVia=node_override` means node attrs overrode env and policy
  defaults. This is the highest-precedence layer.

`winningLayer` is intended to make this precedence explicit for telemetry/CLI
surfaces without requiring consumers to recompute precedence.
