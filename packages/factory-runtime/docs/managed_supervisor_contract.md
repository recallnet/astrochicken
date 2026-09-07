# Managed Supervisor Shell Contract

The shared shell graph lives at:

- `packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs`

It owns deterministic tick lifecycle orchestration for managed factories.

## Responsibilities owned by shell

1. Manifest/context validation (`managed-load-context`)
2. Durable snapshot load (`supervisor state-snapshot`)
3. Control-state gate (`managed-control-gate`)
4. Upstream blocker gate (`upstream-bug-gate`)
5. Action-item gate (`managed-action-item-gate`)
6. Intake selection (`managed-intake-selector`, resolved from `target_repo` + manifest selector)
7. Domain invocation (`pipeline="${domain_graph}"`)
8. Failure classification (`managed-failure-classifier`)
9. Lifecycle classification (`managed-health-classifier`)
10. Lifecycle persistence (`managed-persist-state`)
11. Structured telemetry summary (`managed-emit-run-summary`)

## Shell → Domain inputs

Domain graph executes with inherited context. Required shell-provided inputs:

- `factory_id`
- `kind_id`
- `instance_id`
- `target_repo`
- `control_plane_repo`
- `trust_domain`
- `trust_role`
- `destinations_json`
- `intake_json` (shell-selected payload; includes `issue_selector`, `has_issue`, and `issue` fields)
- selected issue fields (`has_issue`, `selected_issue_number`, `selected_issue_title`, `selected_issue_body`)
- `kind_context_json`

## Domain → Shell outputs

Domain graph must produce:

- `domain_result` (JSON object string)

Shell uses this plus classifier outputs to decide lifecycle state and summary.

## Domain contract validation command

Validate a candidate managed domain graph with:

```bash
hatch-ops supervisor managed-domain-contract --dot-path <path-to-domain.dot>
```

Validator behavior (`packages/factory-ops/src/commands/supervisor-managed-domain-contract.mjs`):

- fails closed if `domain_result` is missing
- fails if shell-owned outputs are emitted (`lifecycle_state`, `managed_run_summary`, etc.)
- fails on forbidden shell-side effects in prompts (for example: `managed-persist-state`, `managed-health-classifier`, `managed-emit-run-summary`, `emit-bug`, upstream/control gates)
- fails when `${...}` references undeclared keys that are neither shell-provided context keys nor graph-produced keys


## Forbidden side effects in domain graph

Domain graph **must not**:

- write external factory control-state directly
- emit managed supervisor lifecycle telemetry envelope
- perform lifecycle transition classification
- bypass shell blocker/control gates
- escalate incidents through `hatch-ops supervisor emit-bug`

Those behaviors are shell-owned to keep fleet semantics stable.

## Lifecycle persistence contract

Shell writes lifecycle snapshots through:

- `hatch-ops supervisor managed-persist-state`

The command persists `lifecycle_state_snapshot` in external control-state (`.hatch/factories/<factory-id>/control-state.json`) via `writeExternalFactoryLifecycleState()`.

When `instance_id` is provided, the same lifecycle summary is mirrored to:

- `.hatch/fleet/mirrors/<factory-id>/<instance-id>/snapshot.json`

Mirror writes are atomic (`tmp + rename`) and include mirror metadata (`mirror_path`, `mirror_version`, `mirror_updated_at`, `mirror_error`) in the `managed-persist-state` JSON response.

Persisted lifecycle states:

- `active`
- `idle`
- `blocked_platform`
- `blocked_local`
- `degraded`
- `paused`
- `draining`

Snapshot fields:

- `schema_version` (`managed-factory-snapshot/v1`)
- `lifecycle_state`
- `lifecycle_reason`
- `lifecycle_failure_classification`
- `lifecycle_failure_reason`
- `lifecycle_updated_at`
- `lifecycle_updated_by`
- `blockers`
  - `upstream.has_open_upstream_bugs`
  - `upstream.open_upstream_bug_count`
  - `upstream.open_upstream_bug_numbers`
  - `action_items.has_action_items`
  - `action_items.action_item_count`
- `unresolved_actions`
- `queue_depth`
- `oldest_work_age_seconds`
- `latest_incidents` (`incident_fingerprint`/`severity` entries)

## Brainstorm consumer

Brainstorm composes this shell by making its tick entrypoint pipeline the shared shell graph and providing:

- `kind_path` (`factories/brainstorm/kind.json`)
- `instance_path` (`factories/brainstorm/instance.template.json`)
- `kind_id` (`brainstorm`)
- `instance_id` (factory id fallback in entrypoint wiring)
- runtime context (`trust_domain`, `trust_role`, repo identity)

The kind manifest points domain execution at `factories/brainstorm/workflows/dispatch-control/domain_brainstorm.workflow-source.mjs`.
